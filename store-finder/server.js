const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { db, UPLOAD_DIR, DEFAULT_MAP } = require('./db');
const { search } = require('./search');
const ai = require('./ai');
const insights = require('./insights');
const pilot = require('./pilot');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

// ---------- helpers ----------
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString('hex')}`;
}
function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 32);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}
function newSession(storeId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, store_id) VALUES (?, ?)').run(token, storeId);
  return token;
}
function getStoreBySlug(slug) {
  return db.prepare('SELECT * FROM stores WHERE slug = ?').get(slug);
}
function publicStore(store) {
  return { slug: store.slug, name: store.name, map: JSON.parse(store.map_json) };
}
function productRow(p) {
  return {
    id: p.id,
    shelfId: p.shelf_id,
    name: p.name,
    description: p.description,
    keywords: p.keywords,
    level: p.level,
    price: p.price || '',
    box: p.box_json ? JSON.parse(p.box_json) : null,
    photo: p.file ? `/uploads/${p.file}` : null,
    photoId: p.photo_id,
    image: p.image ? `/uploads/${p.image}` : null,
    active: p.active !== 0,
  };
}
const PRODUCTS_QUERY = `SELECT products.*, photos.file FROM products
  LEFT JOIN photos ON photos.id = products.photo_id WHERE products.store_id = ?`;

function requireOwner(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  const session = token && db.prepare('SELECT store_id FROM sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ error: 'צריך להתחבר מחדש' });
  req.store = db.prepare('SELECT * FROM stores WHERE id = ?').get(session.store_id);
  next();
}

function validateMap(map) {
  if (!map || typeof map !== 'object') return 'מפה לא תקינה';
  const { cols, rows, shelves, entrance } = map;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 5 || rows < 5 || cols > 120 || rows > 120) return 'גודל מפה לא תקין';
  if (!Array.isArray(shelves) || shelves.length > 2000) return 'רשימת מדפים לא תקינה';
  const ids = new Set();
  for (const s of shelves) {
    if (typeof s.id !== 'string' || !s.id || ids.has(s.id)) return 'מזהה מדף לא תקין';
    ids.add(s.id);
    if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 60) return 'שם מדף לא תקין';
    for (const k of ['x', 'y', 'w', 'h']) if (!Number.isInteger(s[k]) || s[k] < 0) return 'מידות מדף לא תקינות';
    if (s.w < 1 || s.h < 1 || s.x + s.w > cols || s.y + s.h > rows) return `המדף "${s.name}" יוצא מגבולות המפה`;
  }
  if (!entrance || !Number.isInteger(entrance.x) || !Number.isInteger(entrance.y) ||
      entrance.x < 0 || entrance.y < 0 || entrance.x >= cols || entrance.y >= rows) return 'מיקום כניסה לא תקין';
  return null;
}

function cleanProduct(body) {
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const keywords = Array.isArray(body.keywords) ? body.keywords.join(', ') : body.keywords;
  return { name: str(body.name, 120), description: str(body.description, 500), keywords: str(keywords, 1000), level: str(body.level, 60), price: str(body.price, 30) };
}

function shelfExists(store, shelfId) {
  return JSON.parse(store.map_json).shelves.some((s) => s.id === shelfId);
}

// ---------- owner: account ----------
app.post('/api/stores', (req, res) => {
  const name = String(req.body.name || '').trim();
  const slug = String(req.body.slug || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!name || name.length > 80) return res.status(400).json({ error: 'צריך שם חנות' });
  if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'כתובת החנות: 3-40 תווים, אותיות באנגלית, ספרות ומקף' });
  if (password.length < 6) return res.status(400).json({ error: 'סיסמה של 6 תווים לפחות' });
  if (getStoreBySlug(slug)) return res.status(409).json({ error: 'הכתובת הזו כבר תפוסה' });
  const { lastInsertRowid } = db.prepare('INSERT INTO stores (slug, name, password_hash, map_json) VALUES (?, ?, ?, ?)')
    .run(slug, name, hashPassword(password), JSON.stringify(DEFAULT_MAP));
  res.json({ token: newSession(Number(lastInsertRowid)) });
});

app.post('/api/login', (req, res) => {
  const store = getStoreBySlug(String(req.body.slug || '').trim().toLowerCase());
  if (!store || !checkPassword(String(req.body.password || ''), store.password_hash)) {
    return res.status(401).json({ error: 'כתובת חנות או סיסמה שגויים' });
  }
  res.json({ token: newSession(store.id) });
});

app.post('/api/logout', requireOwner, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.get('authorization').replace(/^Bearer /, ''));
  res.json({ ok: true });
});

app.get('/api/me', requireOwner, (req, res) => {
  res.json({ ...publicStore(req.store), aiEnabled: ai.aiEnabled() });
});

app.put('/api/store/map', requireOwner, (req, res) => {
  const error = validateMap(req.body);
  if (error) return res.status(400).json({ error });
  const { cols, rows, entrance } = req.body;
  const shelves = req.body.shelves.map(({ id, name, x, y, w, h }) => ({ id, name: name.trim(), x, y, w, h }));
  db.prepare('UPDATE stores SET map_json = ? WHERE id = ?')
    .run(JSON.stringify({ cols, rows, entrance: { x: entrance.x, y: entrance.y }, shelves }), req.store.id);
  // Products on shelves that were removed from the map no longer have a location.
  const ids = shelves.map((s) => s.id);
  const removed = db.prepare(`DELETE FROM products WHERE store_id = ? AND shelf_id NOT IN (SELECT value FROM json_each(?))`)
    .run(req.store.id, JSON.stringify(ids)).changes;
  res.json({ ok: true, removedProducts: removed });
});

// ---------- owner: photos & products ----------
app.post('/api/photos', requireOwner, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'צריך תמונה (JPG/PNG/WEBP עד 8MB)' });
  const shelfId = String(req.body.shelfId || '');
  const shelf = JSON.parse(req.store.map_json).shelves.find((s) => s.id === shelfId);
  if (!shelf) return res.status(400).json({ error: 'בחר מדף מהמפה' });

  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[req.file.mimetype];
  const file = `${req.store.id}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), req.file.buffer);
  const photoId = Number(db.prepare('INSERT INTO photos (store_id, shelf_id, file) VALUES (?, ?, ?)')
    .run(req.store.id, shelfId, file).lastInsertRowid);

  if (!ai.aiEnabled()) {
    return res.json({ photo: { id: photoId, url: `/uploads/${file}` }, products: [], aiError: 'זיהוי אוטומטי כבוי (אין מפתח GEMINI_API_KEY או ANTHROPIC_API_KEY) — הוסף מוצרים ידנית' });
  }
  try {
    const detected = await ai.detectProducts(req.file.buffer, req.file.mimetype, shelf.name);
    const insert = db.prepare(`INSERT INTO products (store_id, shelf_id, photo_id, name, description, keywords, level, box_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const p of detected) {
      const c = cleanProduct(p);
      if (c.name) insert.run(req.store.id, shelfId, photoId, c.name, c.description, c.keywords, c.level, JSON.stringify(p.box));
    }
    const products = db.prepare(`${PRODUCTS_QUERY} AND products.photo_id = ? ORDER BY products.id`).all(req.store.id, photoId);
    res.json({ photo: { id: photoId, url: `/uploads/${file}` }, products: products.map(productRow) });
  } catch (err) {
    console.error('detectProducts failed:', err);
    res.json({ photo: { id: photoId, url: `/uploads/${file}` }, products: [], aiError: `הזיהוי האוטומטי נכשל: ${err.message}` });
  }
});

app.get('/api/products', requireOwner, (req, res) => {
  res.json(db.prepare(`${PRODUCTS_QUERY} ORDER BY products.id DESC`).all(req.store.id).map(productRow));
});

app.post('/api/products', requireOwner, (req, res) => {
  const p = cleanProduct(req.body);
  if (!p.name) return res.status(400).json({ error: 'צריך שם מוצר' });
  if (!shelfExists(req.store, req.body.shelfId)) return res.status(400).json({ error: 'בחר מדף' });
  const photoId = req.body.photoId && db.prepare('SELECT id FROM photos WHERE id = ? AND store_id = ?').get(req.body.photoId, req.store.id)?.id;
  const { lastInsertRowid } = db.prepare(`INSERT INTO products (store_id, shelf_id, photo_id, name, description, keywords, level, price, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.store.id, req.body.shelfId, photoId || null, p.name, p.description, p.keywords, p.level, p.price, req.body.active === false ? 0 : 1);
  res.json(productRow(db.prepare(`${PRODUCTS_QUERY} AND products.id = ?`).get(req.store.id, lastInsertRowid)));
});

// Bulk import from a catalog file (parsed to rows in the browser). `shelf` is matched by name,
// or by aisle number ("4" matches "מעבר 4 · פחים").
app.post('/api/products/import', requireOwner, (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 5000) : [];
  const shelves = JSON.parse(req.store.map_json).shelves;
  const findShelf = (v) => {
    const t = String(v ?? '').trim();
    if (!t) return null;
    return shelves.find((s) => s.name === t) || shelves.find((s) => s.name.startsWith(t)) ||
      (/^\d+$/.test(t) ? shelves.find((s) => new RegExp(`(^|\\D)${t}(\\D|$)`).test(s.name)) : null);
  };
  const insert = db.prepare(`INSERT INTO products (store_id, shelf_id, name, description, keywords, level, price)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const skipped = [];
  let added = 0;
  rows.forEach((r, i) => {
    const p = cleanProduct(r);
    const shelf = findShelf(r.shelf);
    if (!p.name) return skipped.push({ row: i + 2, reason: 'חסר שם מוצר' });
    if (!shelf) return skipped.push({ row: i + 2, reason: `לא נמצא מדף "${r.shelf ?? ''}"` });
    insert.run(req.store.id, shelf.id, p.name, p.description, p.keywords, p.level, p.price);
    added++;
  });
  res.json({ added, skipped: skipped.slice(0, 50), skippedCount: skipped.length });
});

app.put('/api/products/:id', requireOwner, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ? AND store_id = ?').get(req.params.id, req.store.id);
  if (!existing) return res.status(404).json({ error: 'מוצר לא נמצא' });
  const p = cleanProduct({ ...existing, ...req.body });
  if (!p.name) return res.status(400).json({ error: 'צריך שם מוצר' });
  const shelfId = req.body.shelfId ?? existing.shelf_id;
  if (!shelfExists(req.store, shelfId)) return res.status(400).json({ error: 'בחר מדף' });
  const active = req.body.active === undefined ? existing.active : (req.body.active === false || req.body.active === 'false' ? 0 : 1);
  db.prepare('UPDATE products SET name = ?, description = ?, keywords = ?, level = ?, price = ?, shelf_id = ?, active = ? WHERE id = ?')
    .run(p.name, p.description, p.keywords, p.level, p.price, shelfId, active, existing.id);
  res.json(productRow(db.prepare(`${PRODUCTS_QUERY} AND products.id = ?`).get(req.store.id, existing.id)));
});

app.delete('/api/products/:id', requireOwner, (req, res) => {
  const existing = db.prepare('SELECT image FROM products WHERE id = ? AND store_id = ?').get(req.params.id, req.store.id);
  db.prepare('DELETE FROM products WHERE id = ? AND store_id = ?').run(req.params.id, req.store.id);
  if (existing?.image) fs.rm(path.join(UPLOAD_DIR, existing.image), { force: true }, () => {});
  res.json({ ok: true });
});

// The product's own photo (as opposed to the shelf photo it was found in), chosen by the manager.
app.post('/api/products/:id/image', requireOwner, upload.single('image'), (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ? AND store_id = ?').get(req.params.id, req.store.id);
  if (!existing) return res.status(404).json({ error: 'מוצר לא נמצא' });
  if (!req.file) return res.status(400).json({ error: 'צריך תמונה (JPG/PNG/WEBP עד 8MB)' });
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[req.file.mimetype];
  const file = `${req.store.id}-p${existing.id}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), req.file.buffer);
  db.prepare('UPDATE products SET image = ? WHERE id = ?').run(file, existing.id);
  if (existing.image) fs.rm(path.join(UPLOAD_DIR, existing.image), { force: true }, () => {});
  res.json(productRow(db.prepare(`${PRODUCTS_QUERY} AND products.id = ?`).get(req.store.id, existing.id)));
});

app.delete('/api/products/:id/image', requireOwner, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ? AND store_id = ?').get(req.params.id, req.store.id);
  if (!existing) return res.status(404).json({ error: 'מוצר לא נמצא' });
  db.prepare('UPDATE products SET image = NULL WHERE id = ?').run(existing.id);
  if (existing.image) fs.rm(path.join(UPLOAD_DIR, existing.image), { force: true }, () => {});
  res.json(productRow(db.prepare(`${PRODUCTS_QUERY} AND products.id = ?`).get(req.store.id, existing.id)));
});

app.get('/api/insights', requireOwner, (req, res) => {
  const rows = db.prepare(`SELECT query, result_count, created_at FROM searches
    WHERE store_id = ? AND created_at >= datetime('now', '-400 days')`).all(req.store.id);
  res.json(insights.analyze(rows));
});

// Things that need a staff member now: a shopper asking for help, a product that was not on its shelf,
// and requests for products the store does not carry.
const ALERT_TYPES = ['help', 'not_there', 'empty', 'request'];
app.get('/api/alerts', requireOwner, (req, res) => {
  const rows = db.prepare(`SELECT events.*, products.name AS product_name FROM events
    LEFT JOIN products ON products.id = events.product_id
    WHERE events.store_id = ? AND events.type IN (SELECT value FROM json_each(?))
      AND (events.resolved_at IS NULL OR events.resolved_at >= datetime('now', '-1 day'))
    ORDER BY events.resolved_at IS NOT NULL, events.id DESC LIMIT 200`).all(req.store.id, JSON.stringify(ALERT_TYPES));
  res.json(rows.map((e) => ({
    id: e.id, type: e.type, productId: e.product_id, productName: e.product_name, shelfId: e.shelf_id,
    query: e.query, phone: e.note, createdAt: e.created_at, resolvedAt: e.resolved_at,
  })));
});

app.post('/api/alerts/:id/resolve', requireOwner, (req, res) => {
  const changes = db.prepare("UPDATE events SET resolved_at = datetime('now') WHERE id = ? AND store_id = ? AND resolved_at IS NULL")
    .run(req.params.id, req.store.id).changes;
  res.json({ ok: true, changes });
});

app.get('/api/pilot-report', requireOwner, (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const since = `-${days + 1} days`;
  const searches = db.prepare(`SELECT query, result_count, visitor, created_at FROM searches
    WHERE store_id = ? AND created_at >= datetime('now', ?)`).all(req.store.id, since);
  const events = db.prepare(`SELECT type, visitor, product_id, query, note, created_at, resolved_at FROM events
    WHERE store_id = ? AND created_at >= datetime('now', ?)`).all(req.store.id, since);
  const productNames = new Map(db.prepare('SELECT id, name FROM products WHERE store_id = ?').all(req.store.id).map((p) => [p.id, p.name]));
  res.json({ store: req.store.name, products: productNames.size, ...pilot.report(searches, events, { days, productNames }) });
});

// ---------- public (customers) ----------
// Anonymous per-phone id (random, kept in the browser) so the pilot can count shoppers, not just searches.
function cleanVisitor(v) {
  return /^[a-z0-9]{8,32}$/i.test(String(v || '')) ? String(v) : '';
}

// Simple per-IP limit so a public form cannot flood the staff alert screen.
const eventHits = new Map();
function rateLimited(ip, max = 30, windowMs = 60000) {
  const now = Date.now();
  const hits = (eventHits.get(ip) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  eventHits.set(ip, hits);
  if (eventHits.size > 5000) for (const [k, v] of eventHits) if (now - v[v.length - 1] > windowMs) eventHits.delete(k);
  return hits.length > max;
}

const EVENT_TYPES = ['view', 'found', ...ALERT_TYPES];
app.post('/api/public/:slug/events', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'החנות לא נמצאה' });
  if (rateLimited(req.ip)) return res.status(429).json({ error: 'יותר מדי פניות, נסו שוב בעוד דקה' });
  const { type } = req.body;
  if (!EVENT_TYPES.includes(type)) return res.status(400).json({ error: 'סוג פנייה לא מוכר' });
  const product = req.body.productId != null
    ? db.prepare('SELECT id, shelf_id FROM products WHERE id = ? AND store_id = ?').get(req.body.productId, store.id) : null;
  if (['view', 'found', 'not_there', 'empty'].includes(type) && !product) return res.status(400).json({ error: 'המוצר לא נמצא' });
  const shelfId = product?.shelf_id || (shelfExists(store, req.body.shelfId) ? req.body.shelfId : null);
  const query = String(req.body.query || '').trim().slice(0, 100);
  if (type === 'request' && !query) return res.status(400).json({ error: 'מה חיפשתם?' });
  const phone = String(req.body.phone || '').replace(/[^\d+]/g, '').slice(0, 15);
  if (phone && !/^\+?\d{9,14}$/.test(phone)) return res.status(400).json({ error: 'מספר טלפון לא תקין' });
  db.prepare('INSERT INTO events (store_id, visitor, type, product_id, shelf_id, query, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(store.id, cleanVisitor(req.body.visitor), type, product?.id ?? null, shelfId, query, phone);
  res.json({ ok: true });
});

function storeUrl(req, slug) {
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/s/${slug}`;
}

app.get('/api/public/:slug', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'החנות לא נמצאה' });
  res.json(publicStore(store));
});

app.get('/api/public/:slug/search', async (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'החנות לא נמצאה' });
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (!q) return res.json({ results: [] });

  const products = db.prepare(`${PRODUCTS_QUERY} AND products.active = 1`).all(store.id);
  let results = search(q, products);
  let expanded = false;
  if (!results.length && products.length && ai.aiEnabled()) {
    try {
      const best = new Map();
      for (const term of await ai.expandQuery(q)) {
        for (const r of search(term, products)) {
          if ((best.get(r.product.id)?.score ?? 0) < r.score) best.set(r.product.id, r);
        }
      }
      results = [...best.values()].sort((a, b) => b.score - a.score).slice(0, 10);
      expanded = results.length > 0;
    } catch (err) {
      console.error('expandQuery failed:', err.message);
    }
  }
  db.prepare('INSERT INTO searches (store_id, query, result_count, visitor) VALUES (?, ?, ?, ?)')
    .run(store.id, q, results.length, cleanVisitor(req.query.v));
  res.json({ expanded, results: results.map((r) => productRow(r.product)) });
});

app.get('/api/public/:slug/products/:id', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  const p = store && db.prepare(`${PRODUCTS_QUERY} AND products.id = ? AND products.active = 1`).get(store.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'המוצר לא נמצא' });
  res.json(productRow(p));
});

// Entrance QR (no params) or an aisle sticker (?at=<shelfId>) that tells the app where the shopper stands.
app.get('/api/public/:slug/qr.svg', async (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).end();
  const at = String(req.query.at || '');
  if (at && !shelfExists(store, at)) return res.status(404).end();
  const url = storeUrl(req, store.slug) + (at ? `?at=${encodeURIComponent(at)}` : '');
  res.type('image/svg+xml').send(await QRCode.toString(url, { type: 'svg', margin: 1, width: 320 }));
});

app.get('/s/:slug', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'customer.html')));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'שגיאת שרת' });
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`Store Finder running on http://localhost:${port}`);
    if (!ai.aiEnabled()) console.log('No GEMINI_API_KEY / ANTHROPIC_API_KEY — AI product detection is disabled (manual entry still works).');
    else console.log(`AI product detection: ${ai.provider()}`);
  });
}

module.exports = app;

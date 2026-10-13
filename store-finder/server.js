const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { db, UPLOAD_DIR, DEFAULT_MAP } = require('./db');
const { search } = require('./search');
const synonyms = require('./synonyms');
const ai = require('./ai');
const insights = require('./insights');
const pilot = require('./pilot');

const app = express();
// Behind a hosting proxy (Railway, Render, Cloudflare) every request comes from the proxy; trust one hop
// so rate limits see each shopper's own address.
const behindProxy = process.env.TRUST_PROXY ?? (Object.keys(process.env).some((k) => k.startsWith('RAILWAY_')) ? '1' : '0');
app.set('trust proxy', Number(behindProxy) || false);
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' });
  next();
});
app.get('/healthz', (_req, res) => res.json({ ok: true }));
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
  return { slug: store.slug, name: store.name, map: JSON.parse(store.map_json), photoSearch: ai.aiEnabled() };
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
    promo: p.promo || '',
    active: p.active !== 0,
  };
}
const PRODUCTS_QUERY = `SELECT products.*, photos.file FROM products
  LEFT JOIN photos ON photos.id = products.photo_id WHERE products.store_id = ?`;

const SESSION_DAYS = 30;
function requireOwner(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  const session = token && db.prepare(`SELECT store_id FROM sessions WHERE token = ? AND created_at >= datetime('now', ?)`)
    .get(token, `-${SESSION_DAYS} days`);
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
  return { name: str(body.name, 120), description: str(body.description, 500), keywords: str(keywords, 1000), level: str(body.level, 60), price: str(body.price, 30), promo: str(body.promo, 60) };
}

function shelfExists(store, shelfId) {
  return JSON.parse(store.map_json).shelves.some((s) => s.id === shelfId);
}

// ---------- owner: account ----------
// On a public server, set REGISTRATION_CODE so only people you give the code to can open a store.
app.get('/api/config', (_req, res) => res.json({ registrationCode: Boolean(process.env.REGISTRATION_CODE) }));

app.post('/api/stores', (req, res) => {
  if (rateLimited(`register:${req.ip}`, 5, 10 * 60000)) return res.status(429).json({ error: 'יותר מדי ניסיונות, נסו שוב בעוד כמה דקות' });
  if (process.env.REGISTRATION_CODE && String(req.body.code || '') !== process.env.REGISTRATION_CODE) {
    return res.status(403).json({ error: 'קוד הרשמה שגוי' });
  }
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
  if (rateLimited(`login:${req.ip}`, 10, 5 * 60000)) return res.status(429).json({ error: 'יותר מדי ניסיונות כניסה, נסו שוב בעוד 5 דקות' });
  db.prepare(`DELETE FROM sessions WHERE created_at < datetime('now', ?)`).run(`-${SESSION_DAYS} days`);
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

// Store name and password, changed by the manager.
app.put('/api/store/settings', requireOwner, (req, res) => {
  const name = req.body.name === undefined ? req.store.name : String(req.body.name).trim();
  if (!name || name.length > 80) return res.status(400).json({ error: 'צריך שם חנות' });
  if (req.body.newPassword !== undefined) {
    if (!checkPassword(String(req.body.currentPassword || ''), req.store.password_hash)) return res.status(403).json({ error: 'הסיסמה הנוכחית שגויה' });
    if (String(req.body.newPassword).length < 6) return res.status(400).json({ error: 'סיסמה של 6 תווים לפחות' });
    db.prepare('UPDATE stores SET password_hash = ? WHERE id = ?').run(hashPassword(String(req.body.newPassword)), req.store.id);
    // Sign out every other device that knew the old password.
    db.prepare('DELETE FROM sessions WHERE store_id = ? AND token != ?').run(req.store.id, (req.get('authorization') || '').replace(/^Bearer /, ''));
  }
  db.prepare('UPDATE stores SET name = ? WHERE id = ?').run(name, req.store.id);
  res.json({ ok: true, name });
});

// The whole catalog as a CSV file that opens in Excel (and imports back in the products tab).
app.get('/api/products/export.csv', requireOwner, (req, res) => {
  const shelves = JSON.parse(req.store.map_json).shelves;
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = db.prepare('SELECT * FROM products WHERE store_id = ? ORDER BY shelf_id, name').all(req.store.id).map((p) =>
    [p.name, shelves.find((s) => s.id === p.shelf_id)?.name ?? '', p.level, p.price, p.promo, p.keywords, p.description, p.active ? 'כן' : 'לא'].map(cell).join(','));
  res.type('text/csv; charset=utf-8').attachment(`${req.store.slug}-products.csv`)
    .send(`\ufeff${['שם', 'מעבר', 'מדף', 'מחיר', 'מבצע', 'מילות חיפוש', 'תיאור', 'מוצג'].join(',')}\n${rows.join('\n')}\n`);
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

// Manager photographs a product, AI suggests name, description and search words for the form.
app.post('/api/products/identify', requireOwner, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'צריך תמונה (JPG/PNG/WEBP עד 8MB)' });
  if (!ai.aiEnabled()) return res.status(503).json({ error: 'זיהוי מתמונה כבוי: צריך מפתח GEMINI_API_KEY (חינמי) בשרת' });
  try {
    res.json(await ai.identifyProduct(req.file.buffer, req.file.mimetype));
  } catch (err) {
    console.error('identifyProduct failed:', err.message);
    res.status(502).json({ error: `הזיהוי נכשל: ${err.message}` });
  }
});

// Walk-through video of an aisle. The phone samples frames from the video (no heavy upload) and the AI
// finds every product in one request. Only frames that show a product are kept, as shelf photos.
app.post('/api/videos', requireOwner, upload.array('frames', 60), async (req, res) => {
  const frames = req.files || [];
  if (!frames.length) return res.status(400).json({ error: 'לא התקבלו תמונות מהסרטון' });
  const shelfId = String(req.body.shelfId || '');
  const shelf = JSON.parse(req.store.map_json).shelves.find((s) => s.id === shelfId);
  if (!shelf) return res.status(400).json({ error: 'בחר מדף מהמפה' });
  if (!ai.aiEnabled()) return res.status(503).json({ error: 'זיהוי מסרטון דורש מפתח GEMINI_API_KEY (חינמי) בשרת' });

  let detected;
  try {
    detected = await ai.detectProductsInFrames(frames.map((f) => ({ buffer: f.buffer, mediaType: f.mimetype })), shelf.name);
  } catch (err) {
    console.error('video detection failed:', err.message);
    return res.status(502).json({ error: `הזיהוי נכשל: ${err.message}` });
  }
  const photoIds = new Map();
  const insert = db.prepare(`INSERT INTO products (store_id, shelf_id, photo_id, name, description, keywords, level, box_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const seen = new Set();
  const ids = [];
  for (const p of detected) {
    const c = cleanProduct(p);
    if (!c.name || seen.has(c.name)) continue;
    seen.add(c.name);
    if (!photoIds.has(p.frame)) {
      const f = frames[p.frame];
      const file = `${req.store.id}-v${crypto.randomBytes(8).toString('hex')}.${{ 'image/png': 'png', 'image/webp': 'webp' }[f.mimetype] || 'jpg'}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, file), f.buffer);
      photoIds.set(p.frame, Number(db.prepare('INSERT INTO photos (store_id, shelf_id, file) VALUES (?, ?, ?)').run(req.store.id, shelfId, file).lastInsertRowid));
    }
    ids.push(Number(insert.run(req.store.id, shelfId, photoIds.get(p.frame), c.name, c.description, c.keywords, c.level, JSON.stringify(p.box)).lastInsertRowid));
  }
  const products = ids.map((id) => productRow(db.prepare(`${PRODUCTS_QUERY} AND products.id = ?`).get(req.store.id, id)));
  res.json({ frames: frames.length, keptFrames: photoIds.size, products });
});

app.get('/api/products', requireOwner, (req, res) => {
  res.json(db.prepare(`${PRODUCTS_QUERY} ORDER BY products.id DESC`).all(req.store.id).map(productRow));
});

app.post('/api/products', requireOwner, (req, res) => {
  const p = cleanProduct(req.body);
  if (!p.name) return res.status(400).json({ error: 'צריך שם מוצר' });
  if (!shelfExists(req.store, req.body.shelfId)) return res.status(400).json({ error: 'בחר מדף' });
  const photoId = req.body.photoId && db.prepare('SELECT id FROM photos WHERE id = ? AND store_id = ?').get(req.body.photoId, req.store.id)?.id;
  const { lastInsertRowid } = db.prepare(`INSERT INTO products (store_id, shelf_id, photo_id, name, description, keywords, level, price, promo, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.store.id, req.body.shelfId, photoId || null, p.name, p.description, p.keywords, p.level, p.price, p.promo, req.body.active === false ? 0 : 1);
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
  const insert = db.prepare(`INSERT INTO products (store_id, shelf_id, name, description, keywords, level, price, promo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const skipped = [];
  let added = 0;
  rows.forEach((r, i) => {
    const p = cleanProduct(r);
    const shelf = findShelf(r.shelf);
    if (!p.name) return skipped.push({ row: i + 2, reason: 'חסר שם מוצר' });
    if (!shelf) return skipped.push({ row: i + 2, reason: `לא נמצא מדף "${r.shelf ?? ''}"` });
    insert.run(req.store.id, shelf.id, p.name, p.description, p.keywords, p.level, p.price, p.promo);
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
  db.prepare('UPDATE products SET name = ?, description = ?, keywords = ?, level = ?, price = ?, promo = ?, shelf_id = ?, active = ? WHERE id = ?')
    .run(p.name, p.description, p.keywords, p.level, p.price, p.promo, shelfId, active, existing.id);
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
  // Few or no direct matches: the built-in synonym dictionary ("קדרה" / "לבשל מרק" -> סיר), free and instant.
  if (results.length < 3) {
    const seen = new Set(results.map((r) => r.product.id));
    const extra = searchTerms(synonyms.expand(q), products).filter((r) => !seen.has(r.product.id));
    if (!results.length && extra.length) expanded = true;
    results = [...results, ...extra].slice(0, 10);
  }
  if (!results.length && products.length && ai.aiEnabled()) {
    try {
      results = searchTerms(await ai.expandQuery(q), products);
      expanded = results.length > 0;
    } catch (err) {
      console.error('expandQuery failed:', err.message);
    }
  }
  db.prepare('INSERT INTO searches (store_id, query, result_count, visitor) VALUES (?, ?, ?, ?)')
    .run(store.id, q, results.length, cleanVisitor(req.query.v));
  res.json({ expanded, results: results.map((r) => productRow(r.product)) });
});

// Shopper photographs a product (or a flyer / screenshot) and we find it in this store.
function searchTerms(terms, products) {
  const best = new Map();
  for (const term of terms) {
    for (const r of search(term, products, 10, { fuzzy: false })) {
      if ((best.get(r.product.id)?.score ?? 0) < r.score) best.set(r.product.id, r);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 10);
}
app.post('/api/public/:slug/photo-search', upload.single('image'), async (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'החנות לא נמצאה' });
  if (!req.file) return res.status(400).json({ error: 'צריך תמונה' });
  if (!ai.aiEnabled()) return res.status(503).json({ error: 'חיפוש בתמונה לא זמין כרגע. אפשר לכתוב מה מחפשים 🙂' });
  if (rateLimited(`photo:${req.ip}`, 6)) return res.status(429).json({ error: 'יותר מדי תמונות, נסו שוב בעוד דקה' });
  let identified;
  try {
    identified = await ai.identifyProduct(req.file.buffer, req.file.mimetype);
  } catch (err) {
    console.error('photo search failed:', err.message);
    return res.status(502).json({ error: 'לא הצלחנו לזהות את התמונה כרגע. אפשר לכתוב מה מחפשים 🙂' });
  }
  if (!identified.found) return res.json({ identified, results: [] });
  const products = db.prepare(`${PRODUCTS_QUERY} AND products.active = 1`).all(store.id);
  // The full name first (brand + size), then the general product type and nicknames.
  // Only the most general words: the long tail ("כלי מטבח") would match half the store.
  const results = searchTerms([identified.name, ...identified.keywords.slice(0, 6)], products);
  db.prepare('INSERT INTO searches (store_id, query, result_count, visitor) VALUES (?, ?, ?, ?)')
    .run(store.id, identified.name.slice(0, 100), results.length, cleanVisitor(req.body.visitor));
  res.json({ identified, results: results.map((r) => productRow(r.product)) });
});

// Deals for the shopper's home screen.
app.get('/api/public/:slug/deals', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'החנות לא נמצאה' });
  const rows = db.prepare(`${PRODUCTS_QUERY} AND products.active = 1 AND products.promo != '' ORDER BY products.id DESC LIMIT 12`).all(store.id);
  res.json(rows.map(productRow));
});

// "Shoppers who looked at this also looked at": other products the same shoppers opened or found
// (at least 2 different shoppers, last 90 days). Without enough data: more products from the same aisle.
app.get('/api/public/:slug/products/:id/related', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  const p = store && db.prepare('SELECT id, shelf_id FROM products WHERE id = ? AND store_id = ? AND active = 1').get(req.params.id, store.id);
  if (!p) return res.status(404).json({ error: 'המוצר לא נמצא' });
  const together = db.prepare(`
    SELECT b.product_id AS id, COUNT(DISTINCT b.visitor) AS shoppers
    FROM events a JOIN events b ON b.store_id = a.store_id AND b.visitor = a.visitor AND b.product_id != a.product_id
    JOIN products ON products.id = b.product_id AND products.active = 1
    WHERE a.store_id = ? AND a.product_id = ? AND a.visitor != '' AND a.type IN ('view', 'found') AND b.type IN ('view', 'found')
      AND a.created_at >= datetime('now', '-90 days') AND abs(julianday(b.created_at) - julianday(a.created_at)) < 1
    GROUP BY b.product_id HAVING shoppers >= 2 ORDER BY shoppers DESC LIMIT 4`).all(store.id, p.id);
  const byId = (id) => productRow(db.prepare(`${PRODUCTS_QUERY} AND products.id = ?`).get(store.id, id));
  if (together.length) return res.json({ kind: 'together', products: together.map((r) => byId(r.id)) });
  const aisle = db.prepare(`${PRODUCTS_QUERY} AND products.active = 1 AND products.shelf_id = ? AND products.id != ? ORDER BY products.promo = '', random() LIMIT 4`)
    .all(store.id, p.shelf_id, p.id);
  res.json({ kind: 'aisle', products: aisle.map(productRow) });
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
  // SEED_DEMO=1 on a fresh server: create the demo store (the הסטוק catalog) once, to show the system.
  if (process.env.SEED_DEMO === '1' && !getStoreBySlug('demo')) require('./scripts/seed-demo');
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`Store Finder running on http://localhost:${port}`);
    if (!ai.aiEnabled()) console.log('No GEMINI_API_KEY / ANTHROPIC_API_KEY — AI product detection is disabled (manual entry still works).');
    else console.log(`AI product detection: ${ai.provider()}`);
  });
}

module.exports = app;

const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { db, UPLOAD_DIR, DEFAULT_MAP } = require('./db');
const { search } = require('./search');
const ai = require('./ai');

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
    box: p.box_json ? JSON.parse(p.box_json) : null,
    photo: p.file ? `/uploads/${p.file}` : null,
    photoId: p.photo_id,
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
  return { name: str(body.name, 120), description: str(body.description, 500), keywords: str(keywords, 1000), level: str(body.level, 60) };
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
    return res.json({ photo: { id: photoId, url: `/uploads/${file}` }, products: [], aiError: 'זיהוי אוטומטי כבוי (חסר ANTHROPIC_API_KEY) — הוסף מוצרים ידנית' });
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
  const { lastInsertRowid } = db.prepare(`INSERT INTO products (store_id, shelf_id, photo_id, name, description, keywords, level)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(req.store.id, req.body.shelfId, photoId || null, p.name, p.description, p.keywords, p.level);
  res.json(productRow(db.prepare(`${PRODUCTS_QUERY} AND products.id = ?`).get(req.store.id, lastInsertRowid)));
});

app.put('/api/products/:id', requireOwner, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ? AND store_id = ?').get(req.params.id, req.store.id);
  if (!existing) return res.status(404).json({ error: 'מוצר לא נמצא' });
  const p = cleanProduct({ ...existing, ...req.body });
  if (!p.name) return res.status(400).json({ error: 'צריך שם מוצר' });
  const shelfId = req.body.shelfId ?? existing.shelf_id;
  if (!shelfExists(req.store, shelfId)) return res.status(400).json({ error: 'בחר מדף' });
  db.prepare('UPDATE products SET name = ?, description = ?, keywords = ?, level = ?, shelf_id = ? WHERE id = ?')
    .run(p.name, p.description, p.keywords, p.level, shelfId, existing.id);
  res.json(productRow(db.prepare(`${PRODUCTS_QUERY} AND products.id = ?`).get(req.store.id, existing.id)));
});

app.delete('/api/products/:id', requireOwner, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ? AND store_id = ?').run(req.params.id, req.store.id);
  res.json({ ok: true });
});

app.get('/api/insights', requireOwner, (req, res) => {
  const missing = db.prepare(`SELECT query, COUNT(*) AS count FROM searches
    WHERE store_id = ? AND result_count = 0 GROUP BY query ORDER BY count DESC LIMIT 20`).all(req.store.id);
  const top = db.prepare(`SELECT query, COUNT(*) AS count FROM searches
    WHERE store_id = ? AND result_count > 0 GROUP BY query ORDER BY count DESC LIMIT 20`).all(req.store.id);
  const total = db.prepare('SELECT COUNT(*) AS n FROM searches WHERE store_id = ?').get(req.store.id).n;
  res.json({ total, missing, top });
});

// ---------- public (customers) ----------
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

  const products = db.prepare(PRODUCTS_QUERY).all(store.id);
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
  db.prepare('INSERT INTO searches (store_id, query, result_count) VALUES (?, ?, ?)').run(store.id, q, results.length);
  res.json({ expanded, results: results.map((r) => productRow(r.product)) });
});

app.get('/api/public/:slug/products/:id', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  const p = store && db.prepare(`${PRODUCTS_QUERY} AND products.id = ?`).get(store.id, req.params.id);
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
    if (!ai.aiEnabled()) console.log('ANTHROPIC_API_KEY not set — AI product detection is disabled (manual entry still works).');
  });
}

module.exports = app;

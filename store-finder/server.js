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
const { suggest } = require('./suggest');
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
// changes with every deploy, so open shopper pages know a newer version is live
const BUILD = process.env.RAILWAY_DEPLOYMENT_ID || String(Date.now());
app.get('/healthz', (_req, res) => res.set('Cache-Control', 'no-store').json({ ok: true, build: BUILD }));
app.use(express.json({ limit: '10mb' })); // a supermarket catalog import is a few MB
// pages and code always checked for a newer version, so phones never keep showing an old screen
const fresh = (res) => res.setHeader('Cache-Control', 'no-cache');
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res, p) => { if (/\.(html|js|css|webmanifest)$/.test(p)) fresh(res); } }));
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
function newSession(storeId, role = 'owner') {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, store_id, role) VALUES (?, ?, ?)').run(token, storeId, role);
  return token;
}
function getStoreBySlug(slug) {
  return db.prepare('SELECT * FROM stores WHERE slug = ?').get(slug);
}
function publicStore(store) {
  return { slug: store.slug, name: store.name, map: JSON.parse(store.map_json), photoSearch: ai.aiEnabled(), premiumVoice: Boolean(voiceKey()), voiceInput: Boolean(voiceKey()), detourPct: store.detour_pct ?? 20, huntReward: store.hunt_reward || '' };
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
    barcode: p.barcode || '',
  };
}
const PRODUCTS_QUERY = `SELECT products.*, photos.file FROM products
  LEFT JOIN photos ON photos.id = products.photo_id WHERE products.store_id = ?`;

const SESSION_DAYS = 30;
// Managers can do everything; workers (signed in with the store's worker code) only handle alerts
// and keep products in the right place.
function requireRole(...roles) {
  return (req, res, next) => {
    const token = (req.get('authorization') || '').replace(/^Bearer /, '');
    const session = token && db.prepare(`SELECT store_id, role FROM sessions WHERE token = ? AND created_at >= datetime('now', ?)`)
      .get(token, `-${SESSION_DAYS} days`);
    if (!session) return res.status(401).json({ error: 'צריך להתחבר מחדש' });
    if (!roles.includes(session.role)) return res.status(403).json({ error: 'רק מנהל החנות יכול לעשות את זה' });
    req.store = db.prepare('SELECT * FROM stores WHERE id = ?').get(session.store_id);
    req.role = session.role;
    next();
  };
}
const requireOwner = requireRole('owner');
const requireStaff = requireRole('owner', 'staff');

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

app.post('/api/logout', requireStaff, (req, res) => {
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
  if (req.body.staffPin !== undefined) {
    const pin = String(req.body.staffPin);
    if (pin && !/^\d{4,8}$/.test(pin)) return res.status(400).json({ error: 'קוד עובדים: 4 עד 8 ספרות' });
    db.prepare('UPDATE stores SET staff_pin_hash = ? WHERE id = ?').run(pin ? hashPassword(pin) : null, req.store.id);
    // A new code (or none) signs out every worker who used the old one.
    db.prepare("DELETE FROM sessions WHERE store_id = ? AND role = 'staff'").run(req.store.id);
  }
  if (req.body.huntReward !== undefined) {
    const r = String(req.body.huntReward).trim().slice(0, 60);
    db.prepare('UPDATE stores SET hunt_reward = ? WHERE id = ?').run(r, req.store.id);
  }
  if (req.body.detourPct !== undefined) {
    const d = Math.round(Number(req.body.detourPct));
    if (!Number.isFinite(d) || d < 0 || d > 50) return res.status(400).json({ error: 'מסלול מגלה: בין 0 ל-50 אחוז' });
    db.prepare('UPDATE stores SET detour_pct = ? WHERE id = ?').run(d, req.store.id);
  }
  db.prepare('UPDATE stores SET name = ? WHERE id = ?').run(name, req.store.id);
  const st = db.prepare('SELECT detour_pct, hunt_reward FROM stores WHERE id = ?').get(req.store.id);
  res.json({ ok: true, name, detourPct: st.detour_pct ?? 20, huntReward: st.hunt_reward || '' });
});

// The whole catalog as a CSV file that opens in Excel (and imports back in the products tab).
app.get('/api/products/export.csv', requireOwner, (req, res) => {
  const shelves = JSON.parse(req.store.map_json).shelves;
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = db.prepare('SELECT * FROM products WHERE store_id = ? ORDER BY shelf_id, name').all(req.store.id).map((p) =>
    [p.name, shelves.find((s) => s.id === p.shelf_id)?.name ?? '', p.level, p.price, p.promo, p.keywords, p.description, p.active ? 'כן' : 'לא', p.barcode].map(cell).join(','));
  res.type('text/csv; charset=utf-8').attachment(`${req.store.slug}-products.csv`)
    .send(`\ufeff${['שם', 'מעבר', 'מדף', 'מחיר', 'מבצע', 'מילות חיפוש', 'תיאור', 'מוצג', 'ברקוד'].join(',')}\n${rows.join('\n')}\n`);
});

app.get('/api/me', requireStaff, (req, res) => {
  res.json({ ...publicStore(req.store), aiEnabled: ai.aiEnabled(), role: req.role, staffPinSet: Boolean(req.store.staff_pin_hash) });
});

// Worker sign-in: store address + the worker code the manager set (digits).
app.post('/api/staff/login', (req, res) => {
  if (rateLimited(`login:${req.ip}`, 10, 5 * 60000)) return res.status(429).json({ error: 'יותר מדי ניסיונות כניסה, נסו שוב בעוד 5 דקות' });
  const store = getStoreBySlug(String(req.body.slug || '').trim().toLowerCase());
  if (!store?.staff_pin_hash || !checkPassword(String(req.body.pin || ''), store.staff_pin_hash)) {
    return res.status(401).json({ error: 'כתובת חנות או קוד עובדים שגויים' });
  }
  res.json({ token: newSession(store.id, 'staff') });
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
    return res.json({ photo: { id: photoId, url: `/uploads/${file}` }, products: [], aiError: 'זיהוי אוטומטי כבוי: מוסיפים מוצרים ידנית ומסמנים אותם על התמונה (או מפעילים מפתח Gemini חינמי במסך הנהלת הרשת)' });
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
  if (!ai.aiEnabled()) return res.status(503).json({ error: 'זיהוי מתמונה כבוי: צריך מפתח Gemini חינמי (מכניסים אותו במסך הנהלת הרשת)' });
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
  const saveFrame = (f) => {
    const file = `${req.store.id}-v${crypto.randomBytes(8).toString('hex')}.${{ 'image/png': 'png', 'image/webp': 'webp' }[f.mimetype] || 'jpg'}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, file), f.buffer);
    const id = Number(db.prepare('INSERT INTO photos (store_id, shelf_id, file) VALUES (?, ?, ?)').run(req.store.id, shelfId, file).lastInsertRowid);
    return { id, url: `/uploads/${file}` };
  };
  // Without AI the video still gives the shoppers real photos of the shelf: a few frames spread along
  // the aisle (the phone already sent the sharpest ones). The manager marks products on them.
  if (!ai.aiEnabled()) {
    const keep = Math.min(frames.length, 8);
    const photos = Array.from({ length: keep }, (_, i) => saveFrame(frames[Math.round((i * (frames.length - 1)) / Math.max(1, keep - 1))]));
    return res.json({ frames: frames.length, keptFrames: photos.length, photos, products: [], ai: false });
  }

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
    if (!photoIds.has(p.frame)) photoIds.set(p.frame, saveFrame(frames[p.frame]).id);
    ids.push(Number(insert.run(req.store.id, shelfId, photoIds.get(p.frame), c.name, c.description, c.keywords, c.level, JSON.stringify(p.box)).lastInsertRowid));
  }
  const products = ids.map((id) => productRow(db.prepare(`${PRODUCTS_QUERY} AND products.id = ?`).get(req.store.id, id)));
  res.json({ frames: frames.length, keptFrames: photoIds.size, products });
});

// Quick map from a walk through the store: the AI reads the aisle signs, in order.
app.post('/api/store/walk', requireOwner, upload.array('frames', 60), async (req, res) => {
  const frames = req.files || [];
  if (!frames.length) return res.status(400).json({ error: 'לא התקבלו תמונות מהסרטון' });
  if (!ai.aiEnabled()) return res.status(503).json({ error: 'קריאת שלטים מסרטון צריכה מפתח Gemini חינמי (מכניסים אותו במסך הנהלת הרשת). בינתיים אפשר לכתוב את שמות המעברים.' });
  try {
    const aisles = await ai.readStoreWalk(frames.map((f) => ({ buffer: f.buffer, mediaType: f.mimetype })));
    // numbered signs in number order; the rest in the order they were walked
    aisles.sort((a, b) => (a.number && b.number ? a.number - b.number : 0));
    res.json({ aisles });
  } catch (err) {
    console.error('store walk failed:', err.message);
    res.status(502).json({ error: `הקריאה נכשלה: ${err.message}` });
  }
});

// Pilot readiness for the manager's start screen: per aisle, real photos, products and how many are
// marked on a photo, plus the store-wide checklist.
app.get('/api/store/setup', requireOwner, (req, res) => {
  const shelves = JSON.parse(req.store.map_json).shelves.filter((s) => !/^c\d+$/.test(s.id)); // checkouts aren't aisles to film
  const photos = db.prepare('SELECT shelf_id, COUNT(*) AS n, MAX(id) AS last FROM photos WHERE store_id = ? GROUP BY shelf_id').all(req.store.id);
  const lastFile = db.prepare('SELECT file FROM photos WHERE id = ?');
  const prods = db.prepare(`SELECT shelf_id, COUNT(*) AS n, SUM(photo_id IS NOT NULL AND box_json IS NOT NULL) AS marked,
    SUM(price != '') AS priced FROM products WHERE store_id = ? AND active = 1 GROUP BY shelf_id`).all(req.store.id);
  const ph = new Map(photos.map((r) => [r.shelf_id, r]));
  const pr = new Map(prods.map((r) => [r.shelf_id, r]));
  const aisles = shelves.map((s) => ({
    id: s.id, name: s.name,
    photos: ph.get(s.id)?.n || 0,
    photo: ph.get(s.id) ? `/uploads/${lastFile.get(ph.get(s.id).last).file}` : null,
    products: pr.get(s.id)?.n || 0,
    marked: pr.get(s.id)?.marked || 0,
  }));
  const sum = (k) => prods.reduce((a, r) => a + (r[k] || 0), 0);
  res.json({
    aisles,
    products: sum('n'), marked: sum('marked'), priced: sum('priced'),
    entrance: Boolean(JSON.parse(req.store.map_json).entrance),
    staffPinSet: Boolean(req.store.staff_pin_hash),
    aiEnabled: ai.aiEnabled(), premiumVoice: Boolean(voiceKey()),
  });
});

// The real shelf photos of an aisle (from photos and videos), and marking where a product is on one.
app.get('/api/photos', requireStaff, (req, res) => {
  const rows = db.prepare(`SELECT photos.id, photos.file, photos.shelf_id, COUNT(products.id) AS products FROM photos
    LEFT JOIN products ON products.photo_id = photos.id WHERE photos.store_id = ? AND photos.shelf_id = ? GROUP BY photos.id ORDER BY photos.id DESC`)
    .all(req.store.id, String(req.query.shelfId || ''));
  res.json(rows.map((r) => ({ id: r.id, url: `/uploads/${r.file}`, shelfId: r.shelf_id, products: r.products })));
});
app.delete('/api/photos/:id', requireOwner, (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ? AND store_id = ?').get(req.params.id, req.store.id);
  if (!photo) return res.status(404).json({ error: 'התמונה לא נמצאה' });
  db.prepare('UPDATE products SET photo_id = NULL, box_json = NULL WHERE photo_id = ?').run(photo.id);
  db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
  fs.rm(path.join(UPLOAD_DIR, photo.file), { force: true }, () => {});
  res.json({ ok: true });
});
app.put('/api/products/:id/spot', requireStaff, (req, res) => {
  const product = db.prepare('SELECT id FROM products WHERE id = ? AND store_id = ?').get(req.params.id, req.store.id);
  const photo = db.prepare('SELECT id, shelf_id FROM photos WHERE id = ? AND store_id = ?').get(req.body.photoId, req.store.id);
  if (!product || !photo) return res.status(404).json({ error: 'מוצר או תמונה לא נמצאו' });
  const b = req.body.box || {};
  const n = (v) => Math.max(0, Math.min(1000, Math.round(Number(v) || 0)));
  const box = { x0: n(Math.min(b.x0, b.x1)), y0: n(Math.min(b.y0, b.y1)), x1: n(Math.max(b.x0, b.x1)), y1: n(Math.max(b.y0, b.y1)) };
  if (box.x1 - box.x0 < 20 || box.y1 - box.y0 < 20) return res.status(400).json({ error: 'סמנו את המוצר בתמונה' });
  // the photo shows where the product really is, so it also moves to that aisle
  db.prepare('UPDATE products SET photo_id = ?, box_json = ?, shelf_id = ? WHERE id = ?').run(photo.id, JSON.stringify(box), photo.shelf_id, product.id);
  res.json(productRow(db.prepare(`${PRODUCTS_QUERY} AND products.id = ?`).get(req.store.id, product.id)));
});

app.get('/api/products', requireStaff, (req, res) => {
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
// Catalog import from the store's own system (Excel/CSV). For a supermarket: the aisle may be missing
// (then the department, then a default aisle the manager picks), and a re-import updates prices and
// deals of products already in the system (matched by barcode, else by name) instead of duplicating them.
app.post('/api/products/import', requireOwner, (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 20000) : [];
  const shelves = JSON.parse(req.store.map_json).shelves;
  const findShelf = (v) => {
    const t = String(v ?? '').trim();
    if (!t) return null;
    return shelves.find((s) => s.name === t) || shelves.find((s) => s.name.startsWith(t)) ||
      (/^\d+$/.test(t) ? shelves.find((s) => new RegExp(`(^|\\D)${t}(\\D|$)`).test(s.name)) : null);
  };
  const byDepartment = (v) => {
    const t = String(v ?? '').trim();
    if (!t) return null;
    return shelves.find((s) => s.name.includes(t)) || shelves.find((s) => t.split(/[\s,/]+/).some((w) => w.length > 2 && s.name.includes(w)));
  };
  const defaultShelf = shelves.find((s) => s.id === req.body.defaultShelfId) || null;
  const existing = db.prepare('SELECT * FROM products WHERE store_id = ?').all(req.store.id);
  const byBarcode = new Map(existing.filter((p) => p.barcode).map((p) => [p.barcode, p]));
  const byName = new Map(existing.map((p) => [p.name.trim().toLowerCase(), p]));
  const insert = db.prepare(`INSERT INTO products (store_id, shelf_id, name, description, keywords, level, price, promo, barcode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare(`UPDATE products SET shelf_id = ?, description = ?, keywords = ?, level = ?, price = ?, promo = ?, barcode = ? WHERE id = ?`);
  const skipped = [];
  let added = 0, updated = 0;
  db.exec('BEGIN');
  try {
    rows.forEach((r, i) => {
      const p = cleanProduct(r);
      const barcode = String(r.barcode ?? '').replace(/\D/g, '').slice(0, 20);
      if (!p.name) return skipped.push({ row: i + 2, reason: 'חסר שם מוצר' });
      const shelf = findShelf(r.shelf) || byDepartment(r.department);
      const match = (barcode && byBarcode.get(barcode)) || byName.get(p.name.toLowerCase());
      if (match) {
        // only what the file says changes; an empty cell keeps what the manager already set
        update.run(shelf?.id || match.shelf_id, p.description || match.description, p.keywords || match.keywords, p.level || match.level,
          p.price || match.price, 'promo' in r ? p.promo : match.promo, barcode || match.barcode, match.id);
        updated++;
        return;
      }
      const target = shelf || defaultShelf;
      if (!target) return skipped.push({ row: i + 2, reason: `לא נמצא מעבר "${r.shelf || r.department || ''}"` });
      const id = Number(insert.run(req.store.id, target.id, p.name, p.description, p.keywords, p.level, p.price, p.promo, barcode).lastInsertRowid);
      const row = { id, name: p.name, barcode };
      byName.set(p.name.toLowerCase(), row);
      if (barcode) byBarcode.set(barcode, row);
      added++;
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ added, updated, skipped: skipped.slice(0, 50), skippedCount: skipped.length });
});

// Several products at once from the products list: move to an aisle, hide, show, delete.
app.post('/api/products/bulk', requireOwner, (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 5000);
  const action = String(req.body.action || '');
  if (!ids.length) return res.status(400).json({ error: 'לא נבחרו מוצרים' });
  const own = db.prepare('SELECT id, image FROM products WHERE store_id = ? AND id = ?');
  const rows = ids.map((id) => own.get(req.store.id, id)).filter(Boolean);
  if (action === 'move' && !shelfExists(req.store, req.body.shelfId)) return res.status(400).json({ error: 'בחר מעבר' });
  const stmt = {
    move: db.prepare('UPDATE products SET shelf_id = ?, photo_id = NULL, box_json = NULL WHERE id = ?'),
    hide: db.prepare('UPDATE products SET active = 0 WHERE id = ?'),
    show: db.prepare('UPDATE products SET active = 1 WHERE id = ?'),
    delete: db.prepare('DELETE FROM products WHERE id = ?'),
  }[action];
  if (!stmt) return res.status(400).json({ error: 'פעולה לא מוכרת' });
  db.exec('BEGIN');
  for (const r of rows) action === 'move' ? stmt.run(req.body.shelfId, r.id) : stmt.run(r.id);
  db.exec('COMMIT');
  if (action === 'delete') for (const r of rows) if (r.image) fs.rm(path.join(UPLOAD_DIR, r.image), { force: true }, () => {});
  res.json({ changed: rows.length });
});

app.put('/api/products/:id', requireStaff, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ? AND store_id = ?').get(req.params.id, req.store.id);
  if (!existing) return res.status(404).json({ error: 'מוצר לא נמצא' });
  // Workers move products and mark them out of stock; everything else stays with the manager.
  if (req.role === 'staff') req.body = Object.fromEntries(Object.entries(req.body).filter(([k]) => ['shelfId', 'level', 'active'].includes(k)));
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
app.get('/api/alerts', requireStaff, (req, res) => {
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

app.post('/api/alerts/:id/resolve', requireStaff, (req, res) => {
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
  // sales from the couch: carts reserved for pickup, and how many were collected
  const orders = db.prepare(`SELECT status, total FROM orders WHERE store_id = ? AND created_at >= datetime('now', ?)`).all(req.store.id, since);
  const couch = { orders: orders.length, value: Math.round(orders.reduce((t, o) => t + o.total, 0)), collected: orders.filter((o) => o.status === 'done').length };
  res.json({ store: req.store.name, products: productNames.size, couch, ...pilot.report(searches, events, { days, productNames }) });
});

// ---------- chain headquarters: every branch on this server, side by side ----------
function requireHq(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  const ok = token && db.prepare(`SELECT 1 FROM hq_sessions WHERE token = ? AND created_at >= datetime('now', ?)`).get(token, `-${SESSION_DAYS} days`);
  if (!ok) return res.status(401).json({ error: 'צריך להתחבר מחדש' });
  next();
}
app.post('/api/hq/login', (req, res) => {
  if (!process.env.HQ_PASSWORD) return res.status(404).json({ error: 'מסך הרשת לא הופעל בשרת (חסר HQ_PASSWORD)' });
  if (rateLimited(`login:${req.ip}`, 10, 5 * 60000)) return res.status(429).json({ error: 'יותר מדי ניסיונות כניסה, נסו שוב בעוד 5 דקות' });
  const given = crypto.createHash('sha256').update(String(req.body.password || '')).digest();
  const real = crypto.createHash('sha256').update(process.env.HQ_PASSWORD).digest();
  if (!crypto.timingSafeEqual(given, real)) return res.status(401).json({ error: 'סיסמה שגויה' });
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO hq_sessions (token) VALUES (?)').run(token);
  res.json({ token });
});

// Headquarters turns on the real human voice (and voice search on every phone) with the ElevenLabs key.
app.get('/api/hq/voice', requireHq, (_req, res) => {
  res.json({ set: Boolean(voiceKey()), fromServer: Boolean(process.env.ELEVENLABS_API_KEY) });
});
app.put('/api/hq/voice', requireHq, async (req, res) => {
  const key = String(req.body.key || '').trim();
  if (!key) {
    db.prepare("DELETE FROM settings WHERE key = 'elevenlabs_key'").run();
    return res.json({ set: Boolean(voiceKey()) });
  }
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(key)) return res.status(400).json({ error: 'המפתח לא נראה תקין' });
  // check it opens the store's voice (a free lookup, nothing is generated or billed)
  const r = await fetch(`https://api.elevenlabs.io/v1/voices/${TTS_VOICE}`, { headers: { 'xi-api-key': key } }).catch(() => null);
  if (!r || r.status === 401) return res.status(400).json({ error: 'ElevenLabs לא מכיר את המפתח הזה' });
  db.prepare("INSERT INTO settings (key, value) VALUES ('elevenlabs_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key);
  res.json({ set: true });
});

// Headquarters turns on product recognition from photos and videos with a free Google Gemini key.
app.get('/api/hq/ai', requireHq, (_req, res) => {
  res.json({ set: ai.aiEnabled(), fromServer: Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY) });
});
app.put('/api/hq/ai', requireHq, async (req, res) => {
  const key = String(req.body.key || '').trim();
  if (!key) {
    db.prepare("DELETE FROM settings WHERE key = 'gemini_key'").run();
    return res.json({ set: ai.aiEnabled() });
  }
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(key)) return res.status(400).json({ error: 'המפתח לא נראה תקין' });
  // listing the models is free and proves the key works
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key } }).catch(() => null);
  if (!r || !r.ok) return res.status(400).json({ error: 'Google לא מכיר את המפתח הזה' });
  db.prepare("INSERT INTO settings (key, value) VALUES ('gemini_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key);
  res.json({ set: true });
});

app.get('/api/hq/overview', requireHq, (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const since = `-${days + 1} days`;
  const missing = new Map();
  const stores = db.prepare('SELECT * FROM stores ORDER BY name').all().map((store) => {
    const searches = db.prepare(`SELECT query, result_count, visitor, created_at FROM searches WHERE store_id = ? AND created_at >= datetime('now', ?)`).all(store.id, since);
    const events = db.prepare(`SELECT type, visitor, product_id, query, note, created_at, resolved_at FROM events WHERE store_id = ? AND created_at >= datetime('now', ?)`).all(store.id, since);
    const r = pilot.report(searches, events, { days });
    // What shoppers wanted and the branch doesn't carry: unfound searches + explicit requests.
    for (const s of searches.filter((x) => x.result_count === 0)) addMissing(missing, s.query, store.slug);
    for (const e of events.filter((x) => x.type === 'request')) addMissing(missing, e.query, store.slug);
    return {
      slug: store.slug, name: store.name,
      products: db.prepare('SELECT COUNT(*) AS n FROM products WHERE store_id = ? AND active = 1').get(store.id).n,
      openAlerts: db.prepare(`SELECT COUNT(*) AS n FROM events WHERE store_id = ? AND resolved_at IS NULL AND type IN ('help', 'not_there', 'empty')`).get(store.id).n,
      ...Object.fromEntries(['visitors', 'returning', 'searches', 'searchFoundRate', 'found', 'problems', 'successRate', 'medianSecondsToFind',
        'staffHoursSaved', 'help', 'medianHelpResponseSeconds', 'requests'].map((k) => [k, r[k]])),
      problemsPer100: r.views ? Math.round((r.problems / r.views) * 1000) / 10 : null,
    };
  });
  const sum = (k) => stores.reduce((a, s) => a + (s[k] || 0), 0);
  const weighted = (k, w) => { const tw = stores.reduce((a, s) => a + (s[k] == null ? 0 : s[w]), 0); return tw ? Math.round(stores.reduce((a, s) => a + (s[k] ?? 0) * s[w], 0) / tw) : null; };
  res.json({
    days,
    chain: {
      branches: stores.length, visitors: sum('visitors'), searches: sum('searches'), found: sum('found'), problems: sum('problems'),
      help: sum('help'), requests: sum('requests'), staffHoursSaved: Math.round(sum('staffHoursSaved') * 10) / 10,
      successRate: (sum('found') + sum('problems')) ? Math.round((sum('found') / (sum('found') + sum('problems'))) * 100) : null,
      medianSecondsToFind: weighted('medianSecondsToFind', 'found'),
    },
    stores,
    missing: [...missing.values()].map((m) => ({ ...m, branches: m.branches.size })).sort((a, b) => b.count - a.count).slice(0, 12),
  });
});
function addMissing(map, query, slug) {
  const key = insights.groupKey(query); // "סירי לחץ" and "סיר לחץ" are the same request
  if (!key) return;
  const m = map.get(key) || { query: query.trim(), count: 0, branches: new Set() };
  m.count++;
  m.branches.add(slug);
  map.set(key, m);
}

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

// ---------- buying from the couch ----------
// Prices are text ("89.90", "2 ב-25"); a plain number counts toward the total, a deal text doesn't.
const priceNumber = (p) => (/^\s*₪?\s*\d+(\.\d+)?\s*₪?\s*$/.test(p || '') ? Number(String(p).replace(/[^\d.]/g, '')) : 0);
const israelDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());

// The daily treasure hunt: three products, the same for everyone in the store today, new tomorrow.
function huntProducts(store, day = israelDay()) {
  const rows = db.prepare('SELECT id FROM products WHERE store_id = ? AND active = 1 ORDER BY id').all(store.id).map((r) => r.id);
  const picked = [];
  for (let k = 0; picked.length < Math.min(3, rows.length) && k < 50; k++) {
    const h = crypto.createHash('sha256').update(`${store.id}:${day}:${k}`).digest().readUInt32BE(0);
    const id = rows[h % rows.length];
    if (!picked.includes(id)) picked.push(id);
  }
  return picked;
}
// kept in the database, so a prize code found this morning still works after a restart
const HUNT_SECRET = process.env.HUNT_SECRET || db.prepare("SELECT value FROM settings WHERE key = 'hunt_secret'").get()?.value || (() => {
  const v = crypto.randomBytes(16).toString('hex');
  db.prepare("INSERT INTO settings (key, value) VALUES ('hunt_secret', ?)").run(v);
  return v;
})();
const huntCode = (store, visitor, day = israelDay()) => crypto.createHmac('sha256', HUNT_SECRET).update(`${store.id}:${day}:${visitor}`).digest('hex').slice(0, 8).toUpperCase();

app.get('/api/public/:slug/hunt', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'החנות לא נמצאה' });
  if (!store.hunt_reward) return res.json({ on: false });
  res.json({ on: true, day: israelDay(), reward: store.hunt_reward, ids: huntProducts(store) });
});
// Found all three: the prize code, good today, for this phone.
app.post('/api/public/:slug/hunt', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store?.hunt_reward) return res.status(404).json({ error: 'אין ציד אוצרות היום' });
  const visitor = cleanVisitor(req.body.visitor);
  const found = (Array.isArray(req.body.found) ? req.body.found : []).map(Number);
  const ids = huntProducts(store);
  if (!visitor || !ids.every((id) => found.includes(id))) return res.status(400).json({ error: 'עוד לא מצאת את כל האוצרות' });
  res.json({ code: huntCode(store, visitor), reward: store.hunt_reward });
});

// "Reserve for pickup": the cart from the couch goes to the branch; the staff prepare it and send a WhatsApp.
app.post('/api/public/:slug/orders', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'החנות לא נמצאה' });
  if (rateLimited(`order:${req.ip}`, 5, 10 * 60000)) return res.status(429).json({ error: 'יותר מדי הזמנות, נסו שוב בעוד כמה דקות' });
  const phone = String(req.body.phone || '').replace(/[^\d+]/g, '').slice(0, 15);
  if (!/^\+?\d{9,14}$/.test(phone)) return res.status(400).json({ error: 'צריך מספר טלפון, כדי שנעדכן כשההזמנה מוכנה' });
  const want = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 60);
  const get = db.prepare('SELECT id, name, price, shelf_id, level FROM products WHERE id = ? AND store_id = ? AND active = 1');
  const items = [];
  for (const it of want) {
    const p = get.get(Number(it.id), store.id);
    if (p && !items.some((x) => x.id === p.id)) items.push({ id: p.id, name: p.name, price: p.price, shelfId: p.shelf_id, level: p.level, qty: Math.max(1, Math.min(20, Math.round(Number(it.qty) || 1))) });
  }
  if (!items.length) return res.status(400).json({ error: 'העגלה ריקה' });
  const visitor = cleanVisitor(req.body.visitor);
  const reward = store.hunt_reward && visitor && String(req.body.huntCode || '').toUpperCase() === huntCode(store, visitor) ? store.hunt_reward : '';
  const total = Math.round(items.reduce((t, i) => t + priceNumber(i.price) * i.qty, 0) * 100) / 100;
  const code = String(1000 + crypto.randomInt(9000));
  const name = String(req.body.name || '').trim().slice(0, 40);
  const id = Number(db.prepare('INSERT INTO orders (store_id, visitor, name, phone, code, items_json, total, reward) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(store.id, visitor, name, phone, code, JSON.stringify(items), total, reward).lastInsertRowid);
  res.json({ id, code, total, reward });
});
const orderRow = (o) => ({ id: o.id, name: o.name, phone: o.phone, code: o.code, items: JSON.parse(o.items_json), total: o.total, reward: o.reward, status: o.status, createdAt: o.created_at, readyAt: o.ready_at, doneAt: o.done_at });
app.get('/api/orders', requireStaff, (req, res) => {
  res.json(db.prepare(`SELECT * FROM orders WHERE store_id = ? AND (status != 'done' OR done_at >= datetime('now', '-1 day'))
    ORDER BY status = 'done', id DESC LIMIT 100`).all(req.store.id).map(orderRow));
});
app.post('/api/orders/:id/:status', requireStaff, (req, res) => {
  const status = req.params.status;
  if (!['ready', 'done'].includes(status)) return res.status(400).json({ error: 'מצב לא מוכר' });
  const col = status === 'ready' ? 'ready_at' : 'done_at';
  const changes = db.prepare(`UPDATE orders SET status = ?, ${col} = datetime('now') WHERE id = ? AND store_id = ?`).run(status, req.params.id, req.store.id).changes;
  res.json({ ok: true, changes });
});

// 'cart': something went into the shopper's cart, with where it came from (note): what they searched
// for, or an extra the app led them to (a suggestion, a deal, the aisle, the tour, the discovery route)
const CART_SOURCES = ['search', 'suggest', 'deal', 'aisle', 'tour', 'detour', 'related'];
const EVENT_TYPES = ['view', 'found', 'cart', ...ALERT_TYPES];
app.post('/api/public/:slug/events', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'החנות לא נמצאה' });
  // per phone, plus a high ceiling per address: a whole store of shoppers can share one Wi-Fi address
  if (rateLimited(`ev:${req.ip}:${cleanVisitor(req.body.visitor)}`) || rateLimited(`ev:${req.ip}`, 900)) return res.status(429).json({ error: 'יותר מדי פניות, נסו שוב בעוד דקה' });
  const { type } = req.body;
  if (!EVENT_TYPES.includes(type)) return res.status(400).json({ error: 'סוג פנייה לא מוכר' });
  const product = req.body.productId != null
    ? db.prepare('SELECT id, shelf_id FROM products WHERE id = ? AND store_id = ?').get(req.body.productId, store.id) : null;
  if (['view', 'found', 'cart', 'not_there', 'empty'].includes(type) && !product) return res.status(400).json({ error: 'המוצר לא נמצא' });
  const shelfId = product?.shelf_id || (shelfExists(store, req.body.shelfId) ? req.body.shelfId : null);
  const query = String(req.body.query || '').trim().slice(0, 100);
  if (type === 'request' && !query) return res.status(400).json({ error: 'מה חיפשתם?' });
  const phone = String(req.body.phone || '').replace(/[^\d+]/g, '').slice(0, 15);
  if (phone && !/^\+?\d{9,14}$/.test(phone)) return res.status(400).json({ error: 'מספר טלפון לא תקין' });
  const note = type === 'cart' ? (CART_SOURCES.includes(req.body.source) ? req.body.source : 'search') : phone;
  db.prepare('INSERT INTO events (store_id, visitor, type, product_id, shelf_id, query, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(store.id, cleanVisitor(req.body.visitor), type, product?.id ?? null, shelfId, query, note);
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
// "Where am I?": the store's own shelf photos, so the phone can compare the shopper's photo to them
// (free, no AI), and an AI guess when a key is set.
app.get('/api/public/:slug/shelf-photos', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'החנות לא נמצאה' });
  const rows = db.prepare('SELECT shelf_id, file FROM photos WHERE store_id = ? ORDER BY id DESC').all(store.id);
  const perShelf = new Map();
  for (const r of rows) {
    const list = perShelf.get(r.shelf_id) || [];
    if (list.length < 3) list.push(`/uploads/${r.file}`);
    perShelf.set(r.shelf_id, list);
  }
  res.json([...perShelf].map(([shelfId, urls]) => ({ shelfId, urls })));
});
app.post('/api/public/:slug/locate', upload.single('image'), async (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'החנות לא נמצאה' });
  if (!req.file) return res.status(400).json({ error: 'צריך תמונה' });
  if (!ai.aiEnabled()) return res.json({ shelfIds: [], ai: false });
  if (rateLimited(`locate:${req.ip}`, 30)) return res.status(429).json({ error: 'יותר מדי תמונות, נסו שוב בעוד דקה' });
  const products = db.prepare('SELECT shelf_id, name FROM products WHERE store_id = ? AND active = 1').all(store.id);
  const shelves = JSON.parse(store.map_json).shelves.map((s) => ({
    id: s.id, name: s.name, products: products.filter((p) => p.shelf_id === s.id).slice(0, 15).map((p) => p.name),
  }));
  try {
    res.json({ shelfIds: await ai.locateShelf(req.file.buffer, req.file.mimetype, shelves), ai: true });
  } catch (err) {
    console.error('locate failed:', err.message);
    res.json({ shelfIds: [], ai: false });
  }
});

app.post('/api/public/:slug/photo-search', upload.single('image'), async (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'החנות לא נמצאה' });
  if (!req.file) return res.status(400).json({ error: 'צריך תמונה' });
  if (!ai.aiEnabled()) return res.status(503).json({ error: 'חיפוש בתמונה לא זמין כרגע. אפשר לכתוב מה מחפשים 🙂' });
  if (rateLimited(`photo:${req.ip}`, 30)) return res.status(429).json({ error: 'יותר מדי תמונות, נסו שוב בעוד דקה' });
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

// Home screen: what people look for this week (only things we have), and the departments with a
// photo of one of their products.
app.get('/api/public/:slug/home', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'החנות לא נמצאה' });
  const groups = new Map();
  for (const r of db.prepare(`SELECT query FROM searches WHERE store_id = ? AND result_count > 0 AND created_at >= datetime('now', '-30 days')`).all(store.id)) {
    const key = insights.groupKey(r.query);
    if (!key) continue;
    const g = groups.get(key) || { count: 0, forms: new Map() };
    g.count++;
    g.forms.set(r.query.trim(), (g.forms.get(r.query.trim()) || 0) + 1);
    groups.set(key, g);
  }
  const trending = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 8)
    .map((g) => [...g.forms.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  const products = db.prepare(`${PRODUCTS_QUERY} AND products.active = 1 ORDER BY products.promo = '', products.id`).all(store.id);
  const categories = JSON.parse(store.map_json).shelves.map((s) => {
    const items = products.filter((p) => p.shelf_id === s.id);
    const sample = items.find((p) => p.image) || items.find((p) => p.file);
    return { shelfId: s.id, name: s.name, count: items.length, sample: sample ? productRow(sample) : null };
  }).filter((c) => c.count);
  res.json({ trending, categories });
});

// Deals for the shopper's home screen.
// Virtual tour: every aisle with its real shelf photos and the products marked on each photo, plus the
// aisle's other products (not marked yet) so every aisle can be browsed and shopped from home.
app.get('/api/public/:slug/tour', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'החנות לא נמצאה' });
  const products = db.prepare(`${PRODUCTS_QUERY} AND products.active = 1 ORDER BY products.promo = '', products.name`).all(store.id);
  const photos = db.prepare('SELECT id, shelf_id, file FROM photos WHERE store_id = ? ORDER BY id').all(store.id);
  // how many carts each product went into this week: real numbers, for "added to 12 carts this week"
  const carts = new Map(db.prepare(`SELECT product_id, COUNT(DISTINCT visitor) AS n FROM events WHERE store_id = ? AND type = 'cart'
    AND created_at >= datetime('now', '-7 days') GROUP BY product_id`).all(store.id).map((r) => [r.product_id, r.n]));
  const row = (p) => ({ ...productRow(p), carts: carts.get(p.id) || 0 });
  const aisles = JSON.parse(store.map_json).shelves.map((s) => {
    const items = products.filter((p) => p.shelf_id === s.id);
    const shots = photos.filter((ph) => ph.shelf_id === s.id)
      .map((ph) => ({ url: `/uploads/${ph.file}`, products: items.filter((p) => p.photo_id === ph.id && p.box_json).map(row) }))
      .filter((ph, i, all) => ph.products.length || all.every((x) => !x.products.length) && i >= all.length - 4) // photos with marks; else the last few
      .slice(-6);
    return { shelfId: s.id, name: s.name, photos: shots, products: items.map(row) };
  }).filter((a) => a.products.length || a.photos.length);
  res.json(aisles);
});

// Everything on one aisle, for the department tiles on the shopper's home screen.
app.get('/api/public/:slug/aisle/:shelfId', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'החנות לא נמצאה' });
  const rows = db.prepare(`${PRODUCTS_QUERY} AND products.active = 1 AND products.shelf_id = ? ORDER BY products.promo = '', products.name`).all(store.id, req.params.shelfId);
  res.json(rows.map(productRow));
});

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

// "Goes well with" for what the shopper just put on their list (or the whole list).
app.get('/api/public/:slug/suggest', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'החנות לא נמצאה' });
  const ids = String(req.query.ids || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 30);
  const exclude = new Set(String(req.query.exclude || '').split(',').map(Number).filter(Boolean));
  const limit = Math.min(8, Math.max(1, Number(req.query.limit) || 4));
  const products = db.prepare(`${PRODUCTS_QUERY} AND products.active = 1`).all(store.id);
  const sources = products.filter((p) => ids.includes(p.id));
  if (!sources.length) return res.json([]);
  const together = new Map();
  const pairs = db.prepare(`
    SELECT b.product_id AS id, COUNT(DISTINCT b.visitor) AS shoppers
    FROM events a JOIN events b ON b.store_id = a.store_id AND b.visitor = a.visitor AND b.product_id != a.product_id
    WHERE a.store_id = ? AND a.product_id = ? AND a.visitor != '' AND a.type IN ('view', 'found') AND b.type IN ('view', 'found')
      AND a.created_at >= datetime('now', '-90 days') AND abs(julianday(b.created_at) - julianday(a.created_at)) < 1
    GROUP BY b.product_id HAVING shoppers >= 2`);
  for (const src of sources) together.set(src.id, new Map(pairs.all(store.id, src.id).map((r) => [r.id, r.shoppers])));
  const list = suggest(sources, products.filter((p) => !exclude.has(p.id)), together, limit);
  res.json(list.map((s) => ({ product: productRow(s.product), reason: s.reason, forId: s.forId })));
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

// QR for the workers' sign-in page (the code itself is never in the QR).
app.get('/api/public/:slug/staff-qr.svg', async (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).end();
  const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  res.type('image/svg+xml').send(await QRCode.toString(`${base}/staff.html?store=${encodeURIComponent(store.slug)}`, { type: 'svg', margin: 1, width: 240 }));
});

// ---------- premium voice: a real, clear human voice (ElevenLabs) for spoken answers ----------
// Every sentence is generated once and kept on disk, so the same answer (same product) never costs
// twice. A daily character cap protects the plan's quota; past it the phone's own voice takes over.
// The ElevenLabs key: from the server environment, or set by chain headquarters (stored on the server's
// disk, never sent back to any browser).
const storedSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';
ai.setKeySource(storedSetting);
function voiceKey() {
  return process.env.ELEVENLABS_API_KEY || db.prepare("SELECT value FROM settings WHERE key = 'elevenlabs_key'").get()?.value || '';
}
const TTS_VOICE = process.env.ELEVENLABS_VOICE_ID || 'k77ZRVqAFg9Hd0ltAuON'; // "Omer", the pitch video voice
const TTS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_v3';
const TTS_DAILY_CHARS = Number(process.env.TTS_DAILY_CHARS) || 1200;
const TTS_DIR = path.join(path.dirname(UPLOAD_DIR), 'tts');
fs.mkdirSync(TTS_DIR, { recursive: true });
function speechText(text) {
  return String(text || '')
    .replace(/ס["״]מ/g, 'סנטימטר').replace(/מ["״]ל/g, 'מיליליטר').replace(/מ['׳](?=\s|$)/g, 'מטר')
    .replace(/₪\s?([\d.]+)/g, '$1 שקלים').replace(/[·|]/g, ',').replace(/\s+/g, ' ').trim().slice(0, 300);
}
app.post('/api/public/:slug/tts', async (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'החנות לא נמצאה' });
  if (!voiceKey()) return res.status(503).json({ error: 'קול פרימיום לא הוגדר' });
  const text = speechText(req.body.text);
  const lang = ['he', 'ar', 'ru', 'en'].includes(req.body.lang) ? req.body.lang : 'he';
  if (!text) return res.status(400).json({ error: 'אין טקסט' });
  const key = crypto.createHash('sha256').update(`${TTS_VOICE}|${TTS_MODEL}|${lang}|${text}`).digest('hex').slice(0, 32);
  const file = path.join(TTS_DIR, `${key}.mp3`);
  res.set('Cache-Control', 'public, max-age=604800');
  if (fs.existsSync(file)) return res.type('audio/mpeg').send(fs.readFileSync(file));
  if (rateLimited(`tts:${req.ip}`, 200)) return res.status(429).json({ error: 'יותר מדי בקשות' });
  const day = new Date().toISOString().slice(0, 10);
  const used = db.prepare('SELECT chars FROM tts_usage WHERE day = ?').get(day)?.chars || 0;
  if (used + text.length > TTS_DAILY_CHARS) return res.status(429).json({ error: 'נגמרה המכסה היומית של הקול' });
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${TTS_VOICE}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': voiceKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: TTS_MODEL, language_code: lang }),
    });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}`);
    const audio = Buffer.from(await r.arrayBuffer());
    db.prepare('INSERT INTO tts_usage (day, chars) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET chars = chars + ?').run(day, text.length, text.length);
    fs.writeFileSync(file, audio);
    res.type('audio/mpeg').send(audio);
  } catch (err) {
    console.error('tts failed:', err.message);
    res.status(502).json({ error: 'הקול לא זמין כרגע' });
  }
});

// Voice search on phones whose browser can't recognise speech (iPhone in-app browsers): the phone
// records a few seconds and the server turns it into text. Capped per day.
const STT_DAILY_SECONDS = Number(process.env.STT_DAILY_SECONDS) || 600;
const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^(audio|video)\//.test(file.mimetype)),
});
app.post('/api/public/:slug/stt', uploadAudio.single('audio'), async (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'החנות לא נמצאה' });
  if (!voiceKey()) return res.status(503).json({ error: 'חיפוש קולי לא הוגדר' });
  if (!req.file) return res.status(400).json({ error: 'לא נקלט קול' });
  if (rateLimited(`stt:${req.ip}`, 60)) return res.status(429).json({ error: 'יותר מדי בקשות, נסו שוב בעוד דקה' });
  const seconds = Math.max(1, Math.min(12, Math.ceil(Number(req.body.seconds) || 8)));
  const day = new Date().toISOString().slice(0, 10);
  const used = db.prepare('SELECT seconds FROM stt_usage WHERE day = ?').get(day)?.seconds || 0;
  if (used + seconds > STT_DAILY_SECONDS) return res.status(429).json({ error: 'החיפוש הקולי הגיע למכסה היומית. אפשר לכתוב 🙂' });
  const lang = { he: 'heb', ar: 'ara', ru: 'rus', en: 'eng' }[req.body.lang] || 'heb';
  try {
    const form = new FormData();
    form.append('model_id', 'scribe_v1');
    form.append('language_code', lang);
    form.append('tag_audio_events', 'false');
    form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), 'voice');
    const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': voiceKey() }, body: form });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`ElevenLabs ${r.status} ${data.detail?.status || ''}`);
    db.prepare('INSERT INTO stt_usage (day, seconds) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET seconds = seconds + ?').run(day, seconds, seconds);
    res.json({ text: String(data.text || '').replace(/[.!?。]+$/, '').trim().slice(0, 100) });
  } catch (err) {
    console.error('stt failed:', err.message);
    res.status(502).json({ error: 'לא הצלחתי לשמוע. אפשר לנסות שוב או לכתוב 🙂' });
  }
});

// "Add to home screen": the store opens like an app, straight on the shopper's screen.
app.get('/api/public/:slug/manifest.webmanifest', (req, res) => {
  const store = getStoreBySlug(req.params.slug);
  if (!store) return res.status(404).json({ error: 'החנות לא נמצאה' });
  res.type('application/manifest+json').json({
    name: store.name, short_name: store.name.split('·')[0].trim().slice(0, 12), lang: 'he', dir: 'rtl',
    start_url: `/s/${encodeURIComponent(store.slug)}`, scope: '/', display: 'standalone',
    background_color: '#0b1224', theme_color: '#0b1224',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  });
});
app.get('/s/:slug', (_req, res) => { fresh(res); res.sendFile(path.join(__dirname, 'public', 'customer.html')); });

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'שגיאת שרת' });
});

if (require.main === module) {
  // SEED_DEMO=1 on a fresh server: create the demo store (the הסטוק catalog) once, to show the system.
  // A newer demo catalog (DEMO_VERSION) rebuilds the demo stores once; real stores are never touched.
  const DEMO_VERSION = '5';
  const demoVersion = db.prepare("SELECT value FROM settings WHERE key = 'demo_version'").get()?.value;
  if (process.env.SEED_DEMO === '1' && (!getStoreBySlug('demo') || demoVersion !== DEMO_VERSION)) {
    require('./scripts/seed-demo');
    db.prepare("INSERT INTO settings (key, value) VALUES ('demo_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(DEMO_VERSION);
  }
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`Store Finder running on http://localhost:${port}`);
    if (!ai.aiEnabled()) console.log('No GEMINI_API_KEY / ANTHROPIC_API_KEY — AI product detection is disabled (manual entry still works).');
    else console.log(`AI product detection: ${ai.provider()}`);
  });
}

module.exports = app;

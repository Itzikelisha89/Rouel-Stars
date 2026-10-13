// Creates a demo store ("demo" / password "demo1234") with a map, products and a year of
// simulated searches with seasonal demand, so the demand dashboard has something to show.
//   node scripts/seed-demo.js
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { db, UPLOAD_DIR } = require('../db');
const { holidayDates } = require('../insights');

const SLUG = 'demo';
const DAY = 24 * 60 * 60 * 1000;
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const poisson = (lambda) => { let k = 0, p = Math.exp(-lambda), s = p; const u = rnd(); while (u > s) { k++; p *= lambda / k; s += p; } return k; };

const old = db.prepare('SELECT id FROM stores WHERE slug = ?').get(SLUG);
if (old) db.prepare('DELETE FROM stores WHERE id = ?').run(old.id);

const salt = crypto.randomBytes(16).toString('hex');
const map = {
  cols: 40, rows: 25, entrance: { x: 20, y: 24 },
  shelves: ['ניקיון וטיפוח', 'מצעים', 'אמבטיה וכביסה', 'פחים', 'עיצוב הבית', 'מטבח ואחסון', 'ילדים']
    .map((cat, i) => ({ id: `a${i + 1}`, name: `מעבר ${i + 1} · ${cat}`, x: [34, 29, 24, 19, 14, 9, 4][i], y: 4, w: 2, h: 15 })),
};
const storeId = Number(db.prepare('INSERT INTO stores (slug, name, password_hash, map_json) VALUES (?, ?, ?, ?)')
  .run(SLUG, 'הסטוק · סניף הדגמה', `${salt}:${crypto.scryptSync('demo1234', salt, 32).toString('hex')}`, JSON.stringify(map)).lastInsertRowid);

// Real products from the chain's catalog (demo/hastock), each with its photo.
const CAT = path.join(__dirname, '..', 'demo', 'hastock');
const products = JSON.parse(fs.readFileSync(path.join(CAT, 'catalog.json'), 'utf8'));
for (const p of products) {
  const file = `${storeId}-demo-${p.image}`;
  fs.copyFileSync(path.join(CAT, p.image), path.join(UPLOAD_DIR, file));
  const photoId = db.prepare('INSERT INTO photos (store_id, shelf_id, file) VALUES (?, ?, ?)').run(storeId, p.aisle, file).lastInsertRowid;
  db.prepare(`INSERT INTO products (store_id, shelf_id, photo_id, name, description, keywords, level, price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(storeId, p.aisle, photoId, p.name, `${p.brand} · ${p.category}`, p.keywords, p.level, p.price);
}

const now = new Date();
const start = new Date(now.getTime() - 365 * DAY);
const holidays = holidayDates(start, now);
const near = (d, key, days = 28) => holidays.some((h) => h.key === key && h.date >= d && h.date - d <= days * DAY);

// [queries (spelling variants), found?, base daily rate, seasonal boost(day) -> multiplier]
const DEMAND = [
  [['סיר קטן', 'סירים', 'סיר'], true, 1.6, (d) => (near(d, 'rosh', 21) || near(d, 'pesach', 21) ? 2 : 1)],
  [['פח למטבח', 'פח אשפה', 'פח עם חיישן'], true, 1.2, () => 1],
  [['מצעים', 'מצעים לילדים', 'סט מצעים'], true, 1.0, (d) => (near(d, 'rosh', 21) ? 2.5 : 1)],
  [['צנצנות תבלינים', 'צנצנות'], true, 0.7, () => 1],
  [['קורקינט', 'קורקינט לילדים'], true, 0.6, (d) => (near(d, 'sukkot', 21) ? 3 : 1)],
  [['סל כביסה'], true, 0.5, () => 1],
  [['כלים לפסח', 'סט כלים לפסח', 'סיר גדול לפסח'], false, 0.05, (d) => (near(d, 'pesach') ? 40 : 1)],
  [['סיר לחץ חשמלי', 'סיר לחץ', 'מולטיקוקר'], false, 0.15, (d) => 1 + 4 * Math.max(0, 1 - (now - d) / (60 * DAY))],
  [['מחבת לסופגניות', 'סיר לטיגון עמוק', 'פריטוז'], false, 0.03, (d) => (near(d, 'hanukkah') ? 45 : 1)],
  [['צלחות חד פעמיות', 'כלים חד פעמיים'], false, 0.08, (d) => (near(d, 'sukkot', 21) || near(d, 'rosh', 21) ? 22 : 1)],
  [['קופסת אוכל לילדים', 'קופסאות אוכל', 'בקבוק מים לילדים'], false, 0.05, (d) => (near(d, 'school', 30) ? 25 : 1)],
  [['צידנית', 'צידנית גדולה'], false, 0.05, (d) => ([5, 6, 7].includes(d.getUTCMonth()) ? 9 : 1)],
  [['מסננת סיליקון'], false, 0.12, () => 1],
];

const insert = db.prepare('INSERT INTO searches (store_id, query, result_count, created_at) VALUES (?, ?, ?, ?)');
let n = 0;
for (let t = start.getTime(); t <= now.getTime(); t += DAY) {
  const d = new Date(t);
  for (const [queries, found, base, boost] of DEMAND) {
    const k = poisson(base * boost(d));
    for (let i = 0; i < k; i++) {
      const at = new Date(t + Math.floor(rnd() * 12 + 8) * 3600 * 1000);
      insert.run(storeId, queries[Math.floor(rnd() * queries.length)], found ? 1 + Math.floor(rnd() * 3) : 0, at.toISOString().slice(0, 19).replace('T', ' '));
      n++;
    }
  }
}
console.log(`demo store "${SLUG}" (password demo1234): ${products.length} products, ${n} searches`);

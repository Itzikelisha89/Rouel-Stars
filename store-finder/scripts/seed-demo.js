// Creates demo stores of the הסטוק chain ("demo", "demo-north", "demo-south" / password "demo1234")
// with a map, products, a year of simulated searches with seasonal demand, and a 30-day pilot, so the
// demand dashboard, the pilot report and the chain dashboard have something to show.
// The branches differ on purpose (traffic, how often shoppers find things, shelf problems, staff response).
//   node scripts/seed-demo.js
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { db, UPLOAD_DIR } = require('../db');
const { holidayDates } = require('../insights');
const { search } = require('../search');

const PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';
const DAY = 24 * 60 * 60 * 1000;
// Deterministic random numbers (mulberry32): the same demo data on every run. Integer math only;
// a float LCG loses precision here and starts repeating, which made "different" shoppers identical.
let seed = 42;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const poisson = (lambda) => { let k = 0, p = Math.exp(-lambda), s = p; const u = rnd(); while (u > s) { k++; p *= lambda / k; s += p; } return k; };

let cseed = 7;
const crnd = () => {
  cseed = (cseed + 0x6d2b79f5) | 0;
  let t = Math.imul(cseed ^ (cseed >>> 15), 1 | cseed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function seedBranch(SLUG, NAME, o) {
  const old = db.prepare('SELECT id FROM stores WHERE slug = ?').get(SLUG);
  if (old) db.prepare('DELETE FROM stores WHERE id = ?').run(old.id);

  const salt = crypto.randomBytes(16).toString('hex');
  const map = {
    cols: 44, rows: 25, entrance: { x: 20, y: 24 },
    shelves: ['ניקיון וטיפוח', 'מצעים', 'אמבטיה וכביסה', 'כלי בישול', 'עיצוב הבית', 'מטבח ואחסון', 'ילדים ובית ספר', "הלבשה ופיג'מות", 'צעצועים, יצירה וסקוויזים']
      .map((cat, i) => ({ id: `a${i + 1}`, name: `מעבר ${i + 1} · ${cat}`, x: [34, 29, 24, 19, 14, 9, 4, 0, 40][i], y: 4, w: 2, h: 15 })),
  };
  const storeId = Number(db.prepare('INSERT INTO stores (slug, name, password_hash, map_json) VALUES (?, ?, ?, ?)')
    .run(SLUG, NAME, `${salt}:${crypto.scryptSync(PASSWORD, salt, 32).toString('hex')}`, JSON.stringify(map)).lastInsertRowid);

  // Real products from the chain's catalog (demo/hastock), placed on shelf photos built by
  // demo/build-shelves.py: each product points at its shelf photo plus its box inside it,
  // exactly like products detected from a photographed shelf.
  const CAT = path.join(__dirname, '..', 'demo', 'hastock');
  const products = JSON.parse(fs.readFileSync(path.join(CAT, 'catalog.json'), 'utf8'));
  const placement = JSON.parse(fs.readFileSync(path.join(CAT, 'shelves.json'), 'utf8'));
  const shelfPhotoIds = {};
  for (const p of products) {
    const place = placement[p.id];
    if (!shelfPhotoIds[place.shelfPhoto]) {
      const file = `${storeId}-demo-shelf-${place.shelfPhoto}`;
      fs.copyFileSync(path.join(CAT, 'shelves', place.shelfPhoto), path.join(UPLOAD_DIR, file));
      shelfPhotoIds[place.shelfPhoto] = db.prepare('INSERT INTO photos (store_id, shelf_id, file) VALUES (?, ?, ?)').run(storeId, p.aisle, file).lastInsertRowid;
    }
    db.prepare(`INSERT INTO products (store_id, shelf_id, photo_id, name, description, keywords, level, price, box_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(storeId, p.aisle, shelfPhotoIds[place.shelfPhoto], p.name, `${p.brand} · ${p.category}`,
      p.keywords, place.level, p.price, JSON.stringify(place.box));
  }

  // Deals the manager marked, for the shopper's home screen.
  for (const [match, promo] of [['ORIENT 20', '20% הנחה השבוע'], ['תיק גב Marshmelo', '2 ב-150 ₪'], ['MOOSH בצבעי פסטל', '3 ב-60 ₪'],
    ['סט מצעים URBAN לילדים', 'מחיר מבצע'], ['פח סנסור DUBLIN', 'השני ב-50%'], ['קורקינט MAXI 3 גלגלים ידית מתקפלת', 'מבצע חגים'],
    ["פיג'מת בנות קטיפה פנדה", 'מבצע חורף'], ['מארז 3 סקוויזים', '2 ב-50 ₪'], ['ערכת סליים', 'מבצע!'], ['FOOTBALL KIDI', 'מבצע חורף']]) {
    db.prepare("UPDATE products SET promo = ? WHERE store_id = ? AND name LIKE '%' || ? || '%'").run(promo, storeId, match);
  }
  // buying from the couch: the daily treasure hunt's prize, and pickup orders over the pilot month
  db.prepare('UPDATE stores SET hunt_reward = ? WHERE id = ?').run('10% הנחה על ההזמנה', storeId);
  {
    const all = db.prepare('SELECT id, name, price, shelf_id, level FROM products WHERE store_id = ?').all(storeId);
    const num = (p) => (/^\s*\d+(\.\d+)?\s*$/.test(p || '') ? Number(p) : 0);
    const ins = db.prepare("INSERT INTO orders (store_id, visitor, name, phone, code, items_json, total, status, created_at, ready_at, done_at) VALUES (?, '', ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?), ?)");
    const names = ['מיכל', 'יוסי', 'רונית', 'אבי', 'שירן', 'דנה', ''];
    for (let k = 0; k < Math.round(46 * o.traffic); k++) {
      const n = 2 + Math.floor(crnd() * 4), items = [];
      for (let j = 0; j < n; j++) { const p = all[Math.floor(crnd() * all.length)]; if (!items.some((i) => i.id === p.id)) items.push({ id: p.id, name: p.name, price: p.price, shelfId: p.shelf_id, level: p.level, qty: 1 }); }
      const total = Math.round(items.reduce((t, i) => t + num(i.price), 0) * 100) / 100;
      const daysAgo = 1 + Math.floor(crnd() * 28), phone = `05${Math.floor(crnd() * 9)}${String(Math.floor(crnd() * 1e7)).padStart(7, '0')}`;
      ins.run(storeId, names[k % names.length], phone, String(1000 + Math.floor(crnd() * 9000)), JSON.stringify(items), total, 'done', `-${daysAgo} days`, `-${daysAgo} days`, null);
    }
    db.prepare("UPDATE orders SET done_at = ready_at WHERE store_id = ? AND status = 'done'").run(storeId);
    if (o.liveAlerts) { // one fresh order waiting for the staff right now
      const items = all.filter((p) => /פיג'מת נשים סאטן|mini me|כובע חורף Minnie/.test(p.name)).map((p) => ({ id: p.id, name: p.name, price: p.price, shelfId: p.shelf_id, level: p.level, qty: 1 }));
      ins.run(storeId, 'מיכל', '0541234567', '4821', JSON.stringify(items), Math.round(items.reduce((t, i) => t + num(i.price), 0) * 100) / 100, 'new', '-6 minutes', '-6 minutes', null);
      db.prepare("UPDATE orders SET ready_at = NULL WHERE store_id = ? AND status = 'new'").run(storeId);
    }
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
    [['קופסת אוכל לילדים', 'תיק גב', 'ילקוט'], true, 0.1, (d) => (near(d, 'school', 30) ? 25 : 1)],
    [['בקבוק מים לילדים', 'קלמר', 'מחברות'], false, 0.05, (d) => (near(d, 'school', 30) ? 25 : 1)],
    [['מפרץ ההרפתקאות', 'פאו פטרול'], true, 0.4, (d) => (near(d, 'hanukkah', 21) ? 3 : 1)],
    [['צידנית', 'צידנית גדולה'], false, 0.05, (d) => ([5, 6, 7].includes(d.getUTCMonth()) ? 9 : 1)],
    [['מסננת סיליקון'], false, 0.12, () => 1],
  ];

  const insert = db.prepare('INSERT INTO searches (store_id, query, result_count, created_at) VALUES (?, ?, ?, ?)');
  let n = 0;
  for (let t = start.getTime(); t <= now.getTime(); t += DAY) {
    const d = new Date(t);
    for (const [queries, found, base, boost] of DEMAND) {
      const k = poisson(base * boost(d) * o.traffic);
      for (let i = 0; i < k; i++) {
        // opening hours 9:00-21:00 Israel time (UTC+3)
        const at = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 6) + rnd() * 12 * 3600 * 1000);
        if (at > now) continue;
        insert.run(storeId, queries[Math.floor(rnd() * queries.length)], found ? 1 + Math.floor(rnd() * 3) : 0, at.toISOString().slice(0, 19).replace('T', ' '));
        n++;
      }
    }
  }
  // ---------- a simulated 30-day pilot: shoppers, "found it" taps, shelf reports, help calls ----------
  const sqlTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  const rows = db.prepare('SELECT * FROM products WHERE store_id = ?').all(storeId);
  const deals = rows.filter((x) => x.promo);
  const EXTRA_SOURCES = ['suggest', 'suggest', 'suggest', 'deal', 'deal', 'detour', 'detour', 'aisle', 'related', 'tour'];
  const visitorId = () => Array.from({ length: 16 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rnd() * 36)]).join('');
  const ev = db.prepare('INSERT INTO events (store_id, visitor, type, product_id, shelf_id, query, note, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const srch = db.prepare('INSERT INTO searches (store_id, query, result_count, visitor, created_at) VALUES (?, ?, ?, ?, ?)');
  const HOURS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 5, 7, 8, 6, 4, 4, 5, 8, 9, 8, 5, 2, 0, 0]; // store opens 9:00, evening rush
  const pickHour = () => { let r = rnd() * HOURS.reduce((a, b) => a + b); for (let h = 0; h < 24; h++) { r -= HOURS[h]; if (r < 0) return h; } return 18; };
  const foundQueries = DEMAND.filter((d) => d[1]).flatMap((d) => d[0]);
  // What people tend to look for next, so "shoppers also looked at" has real patterns to find.
  const COMPANION = {
    'תיק גב': 'קופסת אוכל', 'ילקוט': 'קופסת אוכל', 'קופסת אוכל לילדים': 'תיק גב',
    'סל כביסה': 'קפסולות לכביסה', 'מצעים': 'מגבת', 'סט מצעים': 'מגבת', 'מצעים לילדים': 'מפרץ ההרפתקאות',
    'סיר קטן': 'צנצנות תבלינים', 'סירים': 'צנצנות תבלינים', 'סיר': 'צנצנות תבלינים', 'פח למטבח': 'נוזל כלים',
    'קורקינט': 'בימבה', 'קורקינט לילדים': 'בימבה',
  };
  const missingQueries = DEMAND.filter((d) => !d[1]).flatMap((d) => d[0]);
  const regulars = [];
  const pilot = { visitors: 0, found: 0, problems: 0, help: 0, requests: 0 };
  for (let day = 30; day >= 1; day--) {
    const date = new Date(now.getTime() - day * DAY);
    const weekday = date.getUTCDay(); // Saturday is quiet, Thursday-Friday are busy
    const ramp = Math.min(1, 0.45 + (30 - day) / 30); // word spreads during the pilot
    const shoppers = poisson((weekday === 6 ? 14 : weekday >= 4 ? 52 : 38) * ramp * o.traffic);
    for (let k = 0; k < shoppers; k++) {
      const returning = regulars.length > 20 && rnd() < 0.22;
      const v = returning ? regulars[Math.floor(rnd() * regulars.length)] : visitorId();
      if (!returning) { regulars.push(v); pilot.visitors++; }
      let t = new Date(date); t.setUTCHours(pickHour() - 3, Math.floor(rnd() * 60), Math.floor(rnd() * 60)); // Israel is UTC+3
      let prevQ = null;
      for (let s = 1 + (rnd() < 0.35) + (rnd() < 0.1); s > 0; s--) {
        t = new Date(t.getTime() + (20 + rnd() * 200) * 1000);
        if (rnd() < 0.12) { // looking for something the store doesn't carry
          const q = missingQueries[Math.floor(rnd() * missingQueries.length)];
          srch.run(storeId, q, 0, v, sqlTime(t));
          if (rnd() < 0.3) {
            ev.run(storeId, v, 'request', null, null, q, rnd() < 0.45 ? `05${Math.floor(rnd() * 9)}${String(Math.floor(rnd() * 1e7)).padStart(7, '0')}` : '', sqlTime(new Date(t.getTime() + 15000)), sqlTime(new Date(t.getTime() + DAY)));
            pilot.requests++;
          }
          continue;
        }
        const q = prevQ && COMPANION[prevQ] && rnd() < 0.7 ? COMPANION[prevQ] : foundQueries[Math.floor(rnd() * foundQueries.length)];
        prevQ = q;
        const hits = search(q, rows);
        srch.run(storeId, q, hits.length, v, sqlTime(t));
        if (!hits.length) continue;
        const p = hits[Math.floor(rnd() * Math.min(3, hits.length))].product;
        t = new Date(t.getTime() + (5 + rnd() * 20) * 1000);
        ev.run(storeId, v, 'view', p.id, p.shelf_id, '', '', sqlTime(t), null);
        const r = rnd();
        const walk = (25 + rnd() * 70 + (rnd() < 0.15 ? rnd() * 120 : 0)) * 1000 * o.walk;
        if (r < o.found) {
          ev.run(storeId, v, 'found', p.id, p.shelf_id, '', '', sqlTime(new Date(t.getTime() + walk)), null); pilot.found++;
          // into the cart: what they came for, and sometimes something they didn't (own random stream,
          // so the rest of the demo numbers stay the same)
          if (crnd() < 0.7) {
            ev.run(storeId, v, 'cart', p.id, p.shelf_id, '', 'search', sqlTime(new Date(t.getTime() + walk + 4000)), null);
            for (let x = (crnd() < 0.38) + (crnd() < 0.15); x > 0; x--) {
              const src = EXTRA_SOURCES[Math.floor(crnd() * EXTRA_SOURCES.length)];
              const pool = src === 'deal' || src === 'detour' ? deals : rows;
              const q2 = pool[Math.floor(crnd() * pool.length)] || p;
              ev.run(storeId, v, 'cart', q2.id, q2.shelf_id, '', src, sqlTime(new Date(t.getTime() + walk + 30000 + crnd() * 90000)), null);
            }
          }
        }
        else if (r < o.found + o.problems) {
          const at = new Date(t.getTime() + walk);
          ev.run(storeId, v, rnd() < 0.55 ? 'empty' : 'not_there', p.id, p.shelf_id, '', '', sqlTime(at), sqlTime(new Date(at.getTime() + (8 + rnd() * 50) * 60000)));
          pilot.problems++;
        }
        t = new Date(t.getTime() + walk);
      }
      if (rnd() < 0.05) {
        const shelf = map.shelves[Math.floor(rnd() * map.shelves.length)];
        ev.run(storeId, v, 'help', null, shelf.id, '', '', sqlTime(t), sqlTime(new Date(t.getTime() + (o.help[0] + rnd() * o.help[1]) * 1000)));
        pilot.help++;
      }
    }
  }


  console.log(`demo store "${SLUG}": ${products.length} products, ${n} searches`);
  console.log(`pilot simulation (30 days): ${pilot.visitors} shoppers, ${pilot.found} found, ${pilot.problems} shelf reports, ${pilot.help} help calls, ${pilot.requests} requests`);
  if (!o.liveAlerts) return;
  // A few open alerts from the last minutes, so the live alert screen has something on it.
  const orient = rows.find((p) => p.name.includes('ORIENT'));
  const ago = (m) => sqlTime(new Date(now.getTime() - m * 60000));
  ev.run(storeId, visitorId(), 'request', null, null, 'סיר לחץ חשמלי', '0541234567', ago(26), null);
  ev.run(storeId, visitorId(), 'empty', orient.id, orient.shelf_id, '', '', ago(9), null);
  ev.run(storeId, visitorId(), 'help', null, 'a2', 'מצעים לילדים', '', ago(2), null);
}

seedBranch('demo', 'הסטוק · סניף מרכז', { traffic: 1, found: 0.74, problems: 0.06, help: [45, 150], walk: 1, liveAlerts: true });
seedBranch('demo-north', 'הסטוק · קריון', { traffic: 1.3, found: 0.66, problems: 0.12, help: [90, 330], walk: 1.25 });
seedBranch('demo-south', 'הסטוק · באר שבע', { traffic: 0.75, found: 0.8, problems: 0.04, help: [35, 80], walk: 0.9 });
console.log(`password: ${process.env.DEMO_PASSWORD ? '[DEMO_PASSWORD]' : 'demo1234'}`);

// SQLite storage (built into Node 22) — one file per installation, many stores inside.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'store-finder.db'));
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    map_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    shelf_id TEXT NOT NULL,
    file TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    shelf_id TEXT NOT NULL,
    photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    keywords TEXT NOT NULL DEFAULT '',
    level TEXT NOT NULL DEFAULT '',
    box_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS searches (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    result_count INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- What shoppers do after a search: opened a product, found it, reported a problem, asked for help.
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    visitor TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL,
    product_id INTEGER,
    shelf_id TEXT,
    query TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  );
  -- Chain headquarters sign-ins (one password for the whole server, HQ_PASSWORD).
  CREATE TABLE IF NOT EXISTS hq_sessions (
    token TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Characters sent to the premium voice per day (ElevenLabs quota guard).
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stt_usage (
    day TEXT PRIMARY KEY,
    seconds INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS tts_usage (
    day TEXT PRIMARY KEY,
    chars INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
  CREATE INDEX IF NOT EXISTS idx_events_store ON events(store_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_events_product ON events(store_id, product_id);
  CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(store_id, visitor);
  CREATE INDEX IF NOT EXISTS idx_searches_store ON searches(store_id);
`);

// Migrations for databases created by earlier versions.
if (!db.prepare('PRAGMA table_info(products)').all().some((c) => c.name === 'price')) {
  db.exec("ALTER TABLE products ADD COLUMN price TEXT NOT NULL DEFAULT ''");
}
const productCols = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
if (!productCols.includes('image')) db.exec('ALTER TABLE products ADD COLUMN image TEXT'); // the product's own photo, uploaded by the manager
if (!productCols.includes('promo')) db.exec("ALTER TABLE products ADD COLUMN promo TEXT NOT NULL DEFAULT ''"); // deal text, e.g. "2 ב-50 ₪"
if (!productCols.includes('active')) db.exec('ALTER TABLE products ADD COLUMN active INTEGER NOT NULL DEFAULT 1'); // 0 = hidden from shoppers
if (!db.prepare('PRAGMA table_info(stores)').all().some((c) => c.name === 'staff_pin_hash')) {
  db.exec('ALTER TABLE stores ADD COLUMN staff_pin_hash TEXT'); // workers' code, set by the manager
}
if (!db.prepare('PRAGMA table_info(sessions)').all().some((c) => c.name === 'role')) {
  db.exec("ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'owner'"); // 'owner' or 'staff'
}
if (!db.prepare('PRAGMA table_info(searches)').all().some((c) => c.name === 'visitor')) {
  db.exec("ALTER TABLE searches ADD COLUMN visitor TEXT NOT NULL DEFAULT ''");
}

// Each grid cell is roughly 1m x 1m, so 40x25 fits a ~1000m² store.
const DEFAULT_MAP = { cols: 40, rows: 25, entrance: { x: 20, y: 24 }, shelves: [] };

module.exports = { db, DATA_DIR, UPLOAD_DIR, DEFAULT_MAP };

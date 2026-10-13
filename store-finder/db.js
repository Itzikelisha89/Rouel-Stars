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
  CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
  CREATE INDEX IF NOT EXISTS idx_searches_store ON searches(store_id);
`);

// Migrations for databases created by earlier versions.
if (!db.prepare('PRAGMA table_info(products)').all().some((c) => c.name === 'price')) {
  db.exec("ALTER TABLE products ADD COLUMN price TEXT NOT NULL DEFAULT ''");
}

// Each grid cell is roughly 1m x 1m, so 40x25 fits a ~1000m² store.
const DEFAULT_MAP = { cols: 40, rows: 25, entrance: { x: 20, y: 24 }, shelves: [] };

module.exports = { db, DATA_DIR, UPLOAD_DIR, DEFAULT_MAP };

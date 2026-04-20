/**
 * db.js — Migrated from sql.js → better-sqlite3
 *
 * Why: sql.js holds the entire DB in memory and writes the whole file on every
 * operation. With multiple branches entering lots concurrently, this causes
 * race conditions and can lose writes. better-sqlite3 uses native SQLite with
 * WAL mode for safe concurrent access.
 *
 * Compatibility: This wrapper preserves the exact same API your existing
 * server.js, calculations.js, company-config.js, exports.js, etc. already use.
 * No changes needed in those files.
 *
 *   db.run(sql, params)           // INSERT/UPDATE/DELETE (params array or spread)
 *   db.get(sql, params)           // SELECT one row
 *   db.all(sql, params)           // SELECT many rows
 *   db.exec(sql)                  // multi-statement SQL
 *   db.prepare(sql).run(...args)  // prepared INSERT/UPDATE
 *   db.prepare(sql).get(...args)  // prepared SELECT one
 *   db.prepare(sql).all(...args)  // prepared SELECT many
 *   db.transaction(fn)            // returns a wrapped function
 */

const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'config.db');

let rawDb = null;
let wrapped = null;

/**
 * Initialize the database. Async signature preserved for backwards
 * compatibility (better-sqlite3 is synchronous, but existing code does
 * `await initDb()`).
 */
async function initDb() {
  if (wrapped) return wrapped;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  rawDb = new Database(DB_PATH);

  // WAL mode: concurrent reads during writes. Main reason we migrated.
  rawDb.pragma('journal_mode = WAL');
  // Wait up to 5s if another connection holds a lock, instead of instant failure.
  rawDb.pragma('busy_timeout = 5000');
  // Synchronous = NORMAL is safe with WAL and ~2x faster than FULL.
  rawDb.pragma('synchronous = NORMAL');
  // Enforce foreign keys (off by default in SQLite).
  rawDb.pragma('foreign_keys = ON');

  wrapped = makeWrapper();

  // ── SESSIONS ───────────────────────────────────────────────
  wrapped.exec(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    last_used_at TEXT DEFAULT (datetime('now','localtime')),
    device_label TEXT DEFAULT '',
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // ── USERS ──────────────────────────────────────────────────
  wrapped.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    token TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // ── TRADERS (NAM.DBF — sellers/poolers) ────────────────────
  wrapped.exec(`CREATE TABLE IF NOT EXISTS traders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cr TEXT DEFAULT '',
    pan TEXT DEFAULT '',
    tel TEXT DEFAULT '',
    aadhar TEXT DEFAULT '',
    padd TEXT DEFAULT '',
    ppla TEXT DEFAULT '',
    pin TEXT DEFAULT '',
    pstate TEXT DEFAULT '',
    pst_code TEXT DEFAULT '',
    ifsc TEXT DEFAULT '',
    acctnum TEXT DEFAULT '',
    holder_name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // ── TRADER BANKS ───────────────────────────────────────────
  wrapped.exec(`CREATE TABLE IF NOT EXISTS trader_banks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trader_id INTEGER NOT NULL,
    bank_name TEXT DEFAULT '',
    acctnum TEXT NOT NULL,
    ifsc TEXT NOT NULL,
    holder_name TEXT DEFAULT '',
    is_default INTEGER DEFAULT 0,
    FOREIGN KEY (trader_id) REFERENCES traders(id)
  )`);

  // ── BUYERS (SBL.DBF — buyers/dealers/traders) ──────────────
  wrapped.exec(`CREATE TABLE IF NOT EXISTS buyers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer TEXT NOT NULL,
    buyer1 TEXT DEFAULT '',
    code TEXT DEFAULT '',
    sbl TEXT DEFAULT '',
    add1 TEXT DEFAULT '',
    add2 TEXT DEFAULT '',
    pla TEXT DEFAULT '',
    pin TEXT DEFAULT '',
    state TEXT DEFAULT '',
    st_code TEXT DEFAULT '',
    gstin TEXT DEFAULT '',
    pan TEXT DEFAULT '',
    tel TEXT DEFAULT '',
    ti TEXT DEFAULT '',
    sale TEXT DEFAULT 'L',
    email TEXT DEFAULT '',
    tdsq TEXT DEFAULT '',
    cbuyer1 TEXT DEFAULT '',
    cadd1 TEXT DEFAULT '',
    cadd2 TEXT DEFAULT '',
    cpla TEXT DEFAULT '',
    cpin TEXT DEFAULT '',
    cstate TEXT DEFAULT '',
    cst_code TEXT DEFAULT '',
    cgstin TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // ── AUCTIONS (trade sessions) ──────────────────────────────
  wrapped.exec(`CREATE TABLE IF NOT EXISTS auctions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano TEXT NOT NULL,
    date TEXT NOT NULL,
    crop_type TEXT DEFAULT 'ASP',
    state TEXT DEFAULT 'TAMIL NADU',
    start_time TEXT,
    end_time TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // ── LOTS (CPA1.DBF — main lot data, before + after trade) ─
  wrapped.exec(`CREATE TABLE IF NOT EXISTS lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id INTEGER NOT NULL,
    lot_no TEXT NOT NULL,
    crop TEXT DEFAULT '',
    grade TEXT DEFAULT '',
    crpt TEXT DEFAULT '',
    branch TEXT DEFAULT '',
    state TEXT DEFAULT 'TAMIL NADU',
    trader_id INTEGER,
    name TEXT DEFAULT '',
    padd TEXT DEFAULT '',
    ppla TEXT DEFAULT '',
    ppin TEXT DEFAULT '',
    pstate TEXT DEFAULT '',
    pst_code TEXT DEFAULT '',
    cr TEXT DEFAULT '',
    pan TEXT DEFAULT '',
    tel TEXT DEFAULT '',
    aadhar TEXT DEFAULT '',
    bags INTEGER DEFAULT 0,
    litre TEXT DEFAULT '',
    qty REAL DEFAULT 0,
    gross_wt REAL DEFAULT 0,
    sample_wt REAL DEFAULT 0,
    moisture TEXT DEFAULT '',
    price REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    code TEXT DEFAULT '',
    buyer TEXT DEFAULT '',
    buyer1 TEXT DEFAULT '',
    sale TEXT DEFAULT '',
    invo TEXT DEFAULT '',
    pqty REAL DEFAULT 0,
    prate REAL DEFAULT 0,
    puramt REAL DEFAULT 0,
    com REAL DEFAULT 0,
    sertax REAL DEFAULT 0,
    cgst REAL DEFAULT 0,
    sgst REAL DEFAULT 0,
    igst REAL DEFAULT 0,
    dcgst REAL DEFAULT 0,
    dsgst REAL DEFAULT 0,
    digst REAL DEFAULT 0,
    refud REAL DEFAULT 0,
    refund REAL DEFAULT 0,
    advance REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    bilamt REAL DEFAULT 0,
    paid TEXT DEFAULT '',
    user_id TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (auction_id) REFERENCES auctions(id),
    FOREIGN KEY (trader_id) REFERENCES traders(id)
  )`);

  // ── INVOICES (INV.DBF — sales invoices) ────────────────────
  wrapped.exec(`CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id INTEGER,
    ano TEXT NOT NULL,
    date TEXT NOT NULL,
    state TEXT DEFAULT '',
    sale TEXT DEFAULT 'L',
    invo TEXT NOT NULL,
    buyer TEXT DEFAULT '',
    buyer1 TEXT DEFAULT '',
    gstin TEXT DEFAULT '',
    place TEXT DEFAULT '',
    lot TEXT DEFAULT '',
    bag INTEGER DEFAULT 0,
    qty REAL DEFAULT 0,
    price REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    gunny REAL DEFAULT 0,
    pava_hc REAL DEFAULT 0,
    ins REAL DEFAULT 0,
    cgst REAL DEFAULT 0,
    sgst REAL DEFAULT 0,
    igst REAL DEFAULT 0,
    tcs REAL DEFAULT 0,
    rund REAL DEFAULT 0,
    tot REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // ── PURCHASES (PURCHASE.DBF — purchase invoices for registered dealers)
  wrapped.exec(`CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id INTEGER,
    ano TEXT NOT NULL,
    date TEXT NOT NULL,
    state TEXT DEFAULT '',
    br TEXT DEFAULT '',
    name TEXT DEFAULT '',
    add_line TEXT DEFAULT '',
    place TEXT DEFAULT '',
    gstin TEXT DEFAULT '',
    invo TEXT DEFAULT '',
    qty REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    cgst REAL DEFAULT 0,
    sgst REAL DEFAULT 0,
    igst REAL DEFAULT 0,
    rund REAL DEFAULT 0,
    total REAL DEFAULT 0,
    tds REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // ── BILLS (BILL.DBF — bills of supply for unregistered/agriculturist)
  wrapped.exec(`CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano TEXT NOT NULL,
    date TEXT NOT NULL,
    state TEXT DEFAULT '',
    br TEXT DEFAULT '',
    crpt TEXT DEFAULT '',
    bil INTEGER DEFAULT 0,
    name TEXT DEFAULT '',
    add_line TEXT DEFAULT '',
    pla TEXT DEFAULT '',
    pstate TEXT DEFAULT '',
    st_code TEXT DEFAULT '',
    crr TEXT DEFAULT '',
    pan TEXT DEFAULT '',
    qty REAL DEFAULT 0,
    cost REAL DEFAULT 0,
    igst REAL DEFAULT 0,
    net REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // ── DEBIT NOTES ────────────────────────────────────────────
  wrapped.exec(`CREATE TABLE IF NOT EXISTS debit_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano TEXT NOT NULL,
    date TEXT NOT NULL,
    state TEXT DEFAULT '',
    name TEXT DEFAULT '',
    note_no TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    cgst REAL DEFAULT 0,
    sgst REAL DEFAULT 0,
    igst REAL DEFAULT 0,
    total REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // ── AUDIT LOG ──────────────────────────────────────────────
  wrapped.exec(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id INTEGER,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // ── INDEXES ────────────────────────────────────────────────
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_traders_name ON traders(name)',
    'CREATE INDEX IF NOT EXISTS idx_lots_auction ON lots(auction_id)',
    'CREATE INDEX IF NOT EXISTS idx_lots_lot ON lots(lot_no)',
    'CREATE INDEX IF NOT EXISTS idx_lots_name ON lots(name)',
    'CREATE INDEX IF NOT EXISTS idx_lots_buyer ON lots(buyer)',
    'CREATE INDEX IF NOT EXISTS idx_lots_sale ON lots(sale)',
    'CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date)',
    'CREATE INDEX IF NOT EXISTS idx_invoices_sale ON invoices(sale, invo)',
    'CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date)',
    'CREATE INDEX IF NOT EXISTS idx_purchases_name ON purchases(name)',
    'CREATE INDEX IF NOT EXISTS idx_bills_date ON bills(date)',
    'CREATE INDEX IF NOT EXISTS idx_bills_name ON bills(name)',
    'CREATE INDEX IF NOT EXISTS idx_buyers_buyer ON buyers(buyer)',
    'CREATE INDEX IF NOT EXISTS idx_buyers_buyer1 ON buyers(buyer1)',
  ];
  for (const idx of indexes) { try { wrapped.exec(idx); } catch (e) {} }

  // ── MIGRATIONS (for existing databases created before schema changes) ──
  const migrations = [
    'ALTER TABLE purchases ADD COLUMN auction_id INTEGER',
    'ALTER TABLE invoices ADD COLUMN auction_id INTEGER',
    'ALTER TABLE bills ADD COLUMN auction_id INTEGER',
    'ALTER TABLE debit_notes ADD COLUMN auction_id INTEGER',
    "ALTER TABLE buyers ADD COLUMN code TEXT DEFAULT ''",
    "ALTER TABLE buyers ADD COLUMN cadd2 TEXT DEFAULT ''",
    "ALTER TABLE buyers ADD COLUMN email TEXT DEFAULT ''",
    "ALTER TABLE buyers ADD COLUMN tdsq TEXT DEFAULT ''",
    "ALTER TABLE buyers ADD COLUMN sbl TEXT DEFAULT ''",
    // Discount GST columns (per-lot, when flag_disc_gst is ON)
    'ALTER TABLE lots ADD COLUMN dcgst REAL DEFAULT 0',
    'ALTER TABLE lots ADD COLUMN dsgst REAL DEFAULT 0',
    'ALTER TABLE lots ADD COLUMN digst REAL DEFAULT 0',
  ];
  for (const m of migrations) {
    try { wrapped.exec(m); console.log('Migration applied:', m); }
    catch (e) { /* column already exists — ignore */ }
  }

  // Seed admin
  const row = wrapped.get('SELECT COUNT(*) as cnt FROM users');
  if (!row || row.cnt === 0) {
    const hash = crypto.createHash('sha256').update('admin123').digest('hex');
    wrapped.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', ['admin', hash, 'admin']);
    console.log('Default admin created (admin / admin123)');
  }

  console.log('Database ready at', DB_PATH, '(better-sqlite3, WAL mode)');
  return wrapped;
}

/**
 * Normalize params so callers can pass either an array or spread arguments.
 * Accepts: fn('sql', [a, b, c])  OR  fn('sql', a, b, c)  OR  fn('sql')
 */
function normalizeParams(args) {
  if (args.length === 0) return [];
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

function makeWrapper() {
  return {
    /**
     * Execute multi-statement SQL (no params, no return).
     */
    exec(sql) {
      rawDb.exec(sql);
    },

    /**
     * Run an INSERT/UPDATE/DELETE. Accepts params as array or spread.
     * Returns { lastInsertRowid, changes } for compatibility with
     * better-sqlite3's native API, though existing code doesn't use them.
     */
    run(sql, ...rest) {
      const params = normalizeParams(rest);
      const stmt = rawDb.prepare(sql);
      const info = stmt.run(...params);
      return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
    },

    /**
     * SELECT one row. Returns row object or null (matching sql.js behavior).
     */
    get(sql, ...rest) {
      const params = normalizeParams(rest);
      const stmt = rawDb.prepare(sql);
      const row = stmt.get(...params);
      return row || null;
    },

    /**
     * SELECT many rows. Returns array (possibly empty).
     */
    all(sql, ...rest) {
      const params = normalizeParams(rest);
      const stmt = rawDb.prepare(sql);
      return stmt.all(...params);
    },

    /**
     * Prepare a statement. Returns an object with run/get/all that accept
     * spread args — matches better-sqlite3 native API and existing code's
     * usage pattern: `insert.run(a, b, c, d, e)`.
     */
    prepare(sql) {
      const stmt = rawDb.prepare(sql);
      return {
        run(...args) {
          const info = stmt.run(...args);
          return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
        },
        get(...args) {
          const row = stmt.get(...args);
          return row || null;
        },
        all(...args) {
          return stmt.all(...args);
        }
      };
    },

    /**
     * Wrap a function in a transaction. Returns a new function that runs
     * the original inside BEGIN/COMMIT (or ROLLBACK on throw). Uses
     * better-sqlite3's native transaction API for atomic correctness.
     */
    transaction(fn) {
      return rawDb.transaction(fn);
    },

    // Escape hatch to the raw better-sqlite3 Database instance.
    get raw() { return rawDb; }
  };
}

function getDb() {
  if (!wrapped) throw new Error('Call initDb() first');
  return wrapped;
}

function closeDb() {
  if (rawDb) {
    rawDb.close();
    rawDb = null;
    wrapped = null;
  }
}

module.exports = { initDb, getDb, closeDb };

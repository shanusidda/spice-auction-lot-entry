const initSqlJs = require('sql.js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'config.db');
let rawDb, wrapped;

async function initDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const SQL = await initSqlJs();
  rawDb = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();
  wrapped = makeWrapper();

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
    cbuyer1 TEXT DEFAULT '',
    cadd1 TEXT DEFAULT '',
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
  for (const idx of indexes) { try { wrapped.exec(idx); } catch(e) {} }

  // ── MIGRATIONS (for existing databases created before schema changes) ──
  const migrations = [
    'ALTER TABLE purchases ADD COLUMN auction_id INTEGER',
    'ALTER TABLE invoices ADD COLUMN auction_id INTEGER',
    'ALTER TABLE bills ADD COLUMN auction_id INTEGER',
    'ALTER TABLE debit_notes ADD COLUMN auction_id INTEGER',
  ];
  for (const m of migrations) {
    try { wrapped.exec(m); console.log('Migration applied:', m); }
    catch(e) { /* column already exists — ignore */ }
  }

  // Seed admin
  const row = wrapped.get('SELECT COUNT(*) as cnt FROM users');
  if (!row || row.cnt === 0) {
    const hash = crypto.createHash('sha256').update('admin123').digest('hex');
    wrapped.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', ['admin', hash, 'admin']);
    console.log('Default admin created (admin / admin123)');
  }

  save();
  setInterval(save, 30000);
  console.log('Database ready at', DB_PATH);
  return wrapped;
}

function save() { if (rawDb) fs.writeFileSync(DB_PATH, Buffer.from(rawDb.export())); }

function makeWrapper() {
  return {
    run(sql, params = []) { rawDb.run(sql, params); save(); },
    get(sql, params = []) {
      const s = rawDb.prepare(sql); s.bind(params);
      const r = s.step() ? s.getAsObject() : null; s.free(); return r;
    },
    all(sql, params = []) {
      const s = rawDb.prepare(sql); s.bind(params);
      const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows;
    },
    exec(sql) { rawDb.run(sql); save(); },
    prepare(sql) {
      return {
        run(...p) { rawDb.run(sql, p); },
        get(...p) { const s = rawDb.prepare(sql); s.bind(p); const r = s.step() ? s.getAsObject() : null; s.free(); return r; },
        all(...p) { const s = rawDb.prepare(sql); s.bind(p); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; }
      };
    },
    transaction(fn) {
      return (...args) => {
        rawDb.run('BEGIN');
        try { const r = fn(...args); rawDb.run('COMMIT'); save(); return r; }
        catch(e) { rawDb.run('ROLLBACK'); throw e; }
      };
    }
  };
}

function getDb() { if (!wrapped) throw new Error('Call initDb() first'); return wrapped; }

module.exports = { initDb, getDb };

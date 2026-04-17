const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'data', 'auction.db');
const KEY_PATH = path.join(__dirname, 'data', '.db_key');

// ── ENCRYPTION ─────────────────────────────────────────────
// AES-256-GCM file-level encryption.
// The DB is encrypted at rest — if someone copies auction.db,
// they get unreadable bytes without the key file.

const ALGO = 'aes-256-gcm';
const MAGIC = Buffer.from('SADB'); // 4-byte header to identify encrypted files

function getOrCreateKey() {
  if (fs.existsSync(KEY_PATH)) {
    return fs.readFileSync(KEY_PATH);
  }
  const key = crypto.randomBytes(32);
  // Ensure data directory exists
  const dir = path.dirname(KEY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(KEY_PATH, key, { mode: 0o600 }); // owner-only read/write
  console.log('🔑 Generated new database encryption key at', KEY_PATH);
  console.log('   ⚠️  KEEP THIS FILE SAFE — without it, the database cannot be decrypted!');
  return key;
}

function encryptBuffer(plainBuffer, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 16 bytes
  // Format: MAGIC(4) + IV(12) + AuthTag(16) + EncryptedData
  return Buffer.concat([MAGIC, iv, authTag, encrypted]);
}

function decryptBuffer(encBuffer, key) {
  // Check magic header
  if (encBuffer.length < 32 || !encBuffer.slice(0, 4).equals(MAGIC)) {
    // Not encrypted (legacy plain DB) — return as-is
    return encBuffer;
  }
  const iv = encBuffer.slice(4, 16);
  const authTag = encBuffer.slice(16, 32);
  const data = encBuffer.slice(32);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

// ── DB WRAPPER ─────────────────────────────────────────────

let db = null;
let SQL = null;
let encKey = null;

class DbWrapper {
  constructor(rawDb) {
    this.rawDb = rawDb;
  }

  exec(sql) {
    this.rawDb.run(sql);
    this._save();
  }

  run(sql, params = []) {
    this.rawDb.run(sql, params);
    const lastId = this.rawDb.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0] || 0;
    const changes = this.rawDb.getRowsModified();
    this._save();
    return { lastInsertRowid: lastId, changes };
  }

  get(sql, params = []) {
    const stmt = this.rawDb.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
      const cols = stmt.getColumnNames();
      const vals = stmt.get();
      stmt.free();
      const row = {};
      cols.forEach((c, i) => row[c] = vals[i]);
      return row;
    }
    stmt.free();
    return null;
  }

  all(sql, params = []) {
    const stmt = this.rawDb.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      const colNames = stmt.getColumnNames();
      const vals = stmt.get();
      const row = {};
      colNames.forEach((c, i) => row[c] = vals[i]);
      rows.push(row);
    }
    stmt.free();
    return rows;
  }

  _save() {
    try {
      const data = this.rawDb.export();
      const plainBuffer = Buffer.from(data);
      const encBuffer = encryptBuffer(plainBuffer, encKey);
      fs.writeFileSync(DB_PATH, encBuffer);
    } catch (e) {
      console.error('DB save error:', e.message);
    }
  }

  close() {
    this._save();
    this.rawDb.close();
  }

  export() {
    return this.rawDb.export();
  }
}

// ── INIT ───────────────────────────────────────────────────

async function initDb() {
  if (db) return db;

  SQL = await initSqlJs();
  encKey = getOrCreateKey();

  let rawDb;
  if (fs.existsSync(DB_PATH)) {
    const encBuffer = fs.readFileSync(DB_PATH);
    try {
      const plainBuffer = decryptBuffer(encBuffer, encKey);
      rawDb = new SQL.Database(plainBuffer);
      console.log('Loaded existing database from', DB_PATH);
      // If it was a legacy unencrypted DB, re-save as encrypted
      if (encBuffer.length >= 4 && !encBuffer.slice(0, 4).equals(MAGIC)) {
        console.log('🔒 Encrypting legacy unencrypted database...');
        const data = rawDb.export();
        const newEnc = encryptBuffer(Buffer.from(data), encKey);
        fs.writeFileSync(DB_PATH, newEnc);
        console.log('✅ Database encrypted successfully');
      }
    } catch (e) {
      console.error('❌ Failed to decrypt database:', e.message);
      console.error('   If you changed the key file, restore the original .db_key');
      process.exit(1);
    }
  } else {
    rawDb = new SQL.Database();
    console.log('Created new database');
  }

  db = new DbWrapper(rawDb);

  db.exec(`
    CREATE TABLE IF NOT EXISTS traders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cr TEXT, pan TEXT, tel TEXT, aadhar TEXT,
      padd TEXT, ppla TEXT, pin TEXT, pstate TEXT,
      pst_code TEXT, ifsc TEXT, acctnum TEXT
    );
    CREATE TABLE IF NOT EXISTS auctions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ano INTEGER NOT NULL, date TEXT NOT NULL,
      crop_type TEXT NOT NULL DEFAULT 'ASP',
      status TEXT NOT NULL DEFAULT 'open',
      start_time TEXT,
      end_time TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(ano, date)
    );
    CREATE TABLE IF NOT EXISTS lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auction_id INTEGER NOT NULL, lot_no TEXT NOT NULL,
      trader_id INTEGER NOT NULL, branch TEXT NOT NULL,
      grade TEXT NOT NULL DEFAULT '1',
      bags INTEGER NOT NULL, litre INTEGER NOT NULL,
      qty REAL NOT NULL, user_id TEXT,
      state TEXT DEFAULT 'TAMIL NADU',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (auction_id) REFERENCES auctions(id),
      FOREIGN KEY (trader_id) REFERENCES traders(id),
      UNIQUE(auction_id, lot_no)
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      branch TEXT DEFAULT '',
      token TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_traders_name ON traders(name);
    CREATE INDEX IF NOT EXISTS idx_lots_auction ON lots(auction_id);
    CREATE INDEX IF NOT EXISTS idx_users_token ON users(token);
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      UNIQUE(type, value)
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
    CREATE TABLE IF NOT EXISTS trader_banks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trader_id INTEGER NOT NULL,
      acctnum TEXT NOT NULL,
      ifsc TEXT DEFAULT '',
      label TEXT DEFAULT '',
      is_default INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (trader_id) REFERENCES traders(id)
    );
    CREATE INDEX IF NOT EXISTS idx_trader_banks_trader ON trader_banks(trader_id);
    CREATE TABLE IF NOT EXISTS login_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_login_history_user ON login_history(user_id);
    CREATE TABLE IF NOT EXISTS lot_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auction_id INTEGER NOT NULL,
      branch TEXT NOT NULL,
      start_lot TEXT NOT NULL,
      end_lot TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (auction_id) REFERENCES auctions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_lot_alloc_auction ON lot_allocations(auction_id);
  `);

  // Migrations for existing databases
  try { db.run("ALTER TABLE auctions ADD COLUMN start_time TEXT"); } catch(e) {}
  try { db.run("ALTER TABLE auctions ADD COLUMN end_time TEXT"); } catch(e) {}
  try { db.run("ALTER TABLE lots ADD COLUMN bank_id INTEGER"); } catch(e) {}
  try { db.run("ALTER TABLE lots ADD COLUMN gross_weight REAL"); } catch(e) {}
  try { db.run("ALTER TABLE lots ADD COLUMN sample_weight REAL DEFAULT 0"); } catch(e) {}
  try { db.run("ALTER TABLE lots ADD COLUMN moisture REAL"); } catch(e) {}
  try { db.run("ALTER TABLE trader_banks ADD COLUMN holder_name TEXT DEFAULT ''"); } catch(e) {}

  // Migrate existing bank details from traders to trader_banks
  try {
    // Clean up any duplicates first
    db.run(`DELETE FROM trader_banks WHERE id NOT IN (
      SELECT MIN(id) FROM trader_banks GROUP BY trader_id, acctnum
    )`);
    // Ensure only one default per trader
    const multiDefaults = db.all(`SELECT trader_id FROM trader_banks WHERE is_default = 1 GROUP BY trader_id HAVING COUNT(*) > 1`);
    multiDefaults.forEach(row => {
      const first = db.get('SELECT id FROM trader_banks WHERE trader_id = ? AND is_default = 1 ORDER BY id ASC LIMIT 1', [row.trader_id]);
      if (first) db.run('UPDATE trader_banks SET is_default = 0 WHERE trader_id = ? AND is_default = 1 AND id != ?', [row.trader_id, first.id]);
    });

    const tradersWithBank = db.all("SELECT id, acctnum, ifsc FROM traders WHERE acctnum IS NOT NULL AND acctnum != ''");
    let migrated = 0;
    tradersWithBank.forEach(t => {
      const existing = db.get("SELECT id FROM trader_banks WHERE trader_id = ? AND acctnum = ?", [t.id, t.acctnum]);
      if (!existing) {
        db.run("INSERT INTO trader_banks (trader_id, acctnum, ifsc, is_default) VALUES (?, ?, ?, 1)", [t.id, t.acctnum, t.ifsc || '']);
        migrated++;
      }
    });
    if (migrated > 0) console.log(`Migrated ${migrated} bank records to trader_banks table`);
    
    // Sync traders.acctnum/ifsc with their default bank account
    const toSync = db.all(`SELECT DISTINCT trader_id FROM trader_banks`);
    toSync.forEach(row => {
      const def = db.get('SELECT acctnum, ifsc FROM trader_banks WHERE trader_id = ? ORDER BY is_default DESC, id DESC LIMIT 1', [row.trader_id]);
      if (def) {
        db.run('UPDATE traders SET acctnum = ?, ifsc = ? WHERE id = ?', [def.acctnum || '', def.ifsc || '', row.trader_id]);
      }
    });
    if (toSync.length > 0) console.log(`Synced bank details for ${toSync.length} traders`);
  } catch(e) {}

  // Seed default admin account if no users exist
  const userCount = db.get('SELECT COUNT(*) as cnt FROM users');
  if (userCount.cnt === 0) {
    const adminHash = crypto.createHash('sha256').update('admin123').digest('hex');
    db.run(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      ['admin', adminHash, 'admin']
    );
    console.log('Default admin created (username: admin, password: admin123)');
  }

  // Seed default branches and crop types if none exist
  const configCount = db.get('SELECT COUNT(*) as cnt FROM config');
  if (configCount.cnt === 0) {
    const branches = ['VANDANMEDU','NEDUMKANDAM','ANAVILASAM','CUMBUM','KUMILY','KATTAPPANA','PULIYANMALA','CHAKKUPALLAM','THEKKADY'];
    branches.forEach((b, i) => {
      db.run('INSERT INTO config (type, value, sort_order) VALUES (?, ?, ?)', ['branch', b, i]);
    });
    db.run('INSERT INTO config (type, value, sort_order) VALUES (?, ?, ?)', ['crop_type', 'ASP', 0]);
    db.run('INSERT INTO config (type, value, sort_order) VALUES (?, ?, ?)', ['title', 'Spice Auction', 0]);
    console.log(`Seeded ${branches.length} branches + 1 crop type + title`);
  }

  console.log('Database initialized at', DB_PATH);
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call await initDb() first.');
  return db;
}

function closeDb() {
  if (db) { db.close(); db = null; }
}

module.exports = { initDb, getDb, closeDb };

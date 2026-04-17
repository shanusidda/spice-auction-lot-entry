const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const multer = require('multer');
const { initDb, getDb, closeDb } = require('./db');
const { exportXlsx, exportDbf } = require('./export');
const { importSource } = require('./import-source');

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({ dest: path.join(__dirname, 'data', 'uploads') });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── HELPERS ─────────────────────────────────────────────────

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── AUTH MIDDLEWARE ──────────────────────────────────────────

/** Require a valid user token (any role) */
function requireAuth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
  if (!token) return res.status(401).json({ error: 'Login required' });

  const db = getDb();
  const user = db.get('SELECT * FROM users WHERE token = ?', [token]);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });

  req.user = user;
  next();
}

/** Require admin role */
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

// ── AUTH ROUTES ─────────────────────────────────────────────

/**
 * POST /api/auth/login
 * Body: { username, password }
 * Returns: { user, token }
 */
app.post('/api/auth/login', (req, res) => {
  const db = getDb();
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = db.get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [username]);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });

  const hash = hashPassword(password);
  if (hash !== user.password_hash) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  // Generate and save token
  const token = generateToken();
  db.run('UPDATE users SET token = ? WHERE id = ?', [token, user.id]);

  res.json({
    user: { id: user.id, username: user.username, role: user.role },
    token,
  });
});

/**
 * POST /api/auth/logout
 * Clears the user's token
 */
app.post('/api/auth/logout', requireAuth, (req, res) => {
  const db = getDb();
  db.run('UPDATE users SET token = NULL WHERE id = ?', [req.user.id]);
  res.json({ success: true });
});

/**
 * GET /api/auth/me
 * Returns current user info (validates token)
 */
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    user: { id: req.user.id, username: req.user.username, role: req.user.role }
  });
});

/**
 * POST /api/auth/users — Admin only: create a new user
 * Body: { username, password, role }
 */
app.post('/api/auth/users', requireAdmin, (req, res) => {
  const db = getDb();
  const { username, password, role } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const existing = db.get('SELECT id FROM users WHERE username = ? COLLATE NOCASE', [username]);
  if (existing) return res.status(409).json({ error: 'Username already exists' });

  const hash = hashPassword(password);
  const result = db.run(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
    [username, hash, role || 'user']
  );

  res.status(201).json({
    user: { id: result.lastInsertRowid, username, role: role || 'user' }
  });
});

/**
 * GET /api/auth/users — Admin only: list all users
 */
app.get('/api/auth/users', requireAdmin, (req, res) => {
  const db = getDb();
  const users = db.all('SELECT id, username, role, created_at FROM users ORDER BY id ASC');
  res.json({ users });
});

/**
 * DELETE /api/auth/users/:id — Admin only: delete a user
 */
app.delete('/api/auth/users/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const userId = parseInt(req.params.id);

  if (userId === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }

  const user = db.get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.run('DELETE FROM users WHERE id = ?', [userId]);
  res.json({ deleted: true, username: user.username });
});

/**
 * PUT /api/auth/users/:id/password — Admin only: reset a user's password
 * Body: { password }
 */
app.put('/api/auth/users/:id/password', requireAdmin, (req, res) => {
  const db = getDb();
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });

  const user = db.get('SELECT * FROM users WHERE id = ?', [parseInt(req.params.id)]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const hash = hashPassword(password);
  db.run('UPDATE users SET password_hash = ?, token = NULL WHERE id = ?', [hash, user.id]);
  res.json({ success: true, username: user.username });
});

// ── CONFIG (branches, crop types) ───────────────────────────

/**
 * GET /api/config?type=branch  (public for app dropdowns)
 * Returns config values by type
 */
app.get('/api/config', (req, res) => {
  const db = getDb();
  const { type } = req.query;

  if (type) {
    const items = db.all('SELECT * FROM config WHERE type = ? ORDER BY sort_order ASC, value ASC', [type]);
    return res.json({ items });
  }

  // Return all config grouped by type
  const branches = db.all("SELECT * FROM config WHERE type = 'branch' ORDER BY sort_order ASC, value ASC");
  const cropTypes = db.all("SELECT * FROM config WHERE type = 'crop_type' ORDER BY sort_order ASC, value ASC");
  res.json({ branches, cropTypes });
});

/**
 * POST /api/config — Admin only: add a config value
 * Body: { type, value }
 */
app.post('/api/config', requireAdmin, (req, res) => {
  const db = getDb();
  const { type, value } = req.body;

  if (!type || !value) {
    return res.status(400).json({ error: 'type and value required' });
  }
  if (type !== 'branch' && type !== 'crop_type') {
    return res.status(400).json({ error: 'type must be branch or crop_type' });
  }

  const existing = db.get('SELECT id FROM config WHERE type = ? AND value = ? COLLATE NOCASE', [type, value.toUpperCase()]);
  if (existing) return res.status(409).json({ error: 'Already exists' });

  const maxOrder = db.get('SELECT COALESCE(MAX(sort_order), 0) as m FROM config WHERE type = ?', [type]);
  const result = db.run(
    'INSERT INTO config (type, value, sort_order) VALUES (?, ?, ?)',
    [type, value.toUpperCase(), maxOrder.m + 1]
  );

  res.status(201).json({ id: result.lastInsertRowid, type, value: value.toUpperCase() });
});

/**
 * DELETE /api/config/:id — Admin only: remove a config value
 */
app.delete('/api/config/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const item = db.get('SELECT * FROM config WHERE id = ?', [parseInt(req.params.id)]);
  if (!item) return res.status(404).json({ error: 'Not found' });

  db.run('DELETE FROM config WHERE id = ?', [parseInt(req.params.id)]);
  res.json({ deleted: true, value: item.value });
});

// ── TRADERS ─────────────────────────────────────────────────

app.get('/api/traders', requireAuth, (req, res) => {
  const db = getDb();
  const query = (req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);

  if (!query) {
    const traders = db.all('SELECT * FROM traders ORDER BY name ASC LIMIT ?', [limit]);
    return res.json({ traders, total: traders.length });
  }

  const traders = db.all(
    'SELECT * FROM traders WHERE name LIKE ? COLLATE NOCASE ORDER BY name ASC LIMIT ?',
    [`%${query}%`, limit]
  );
  res.json({ traders, total: traders.length });
});

app.get('/api/traders/:id', requireAuth, (req, res) => {
  const db = getDb();
  const trader = db.get('SELECT * FROM traders WHERE id = ?', [parseInt(req.params.id)]);
  if (!trader) return res.status(404).json({ error: 'Trader not found' });
  res.json(trader);
});

// ── AUCTIONS ────────────────────────────────────────────────

app.post('/api/auctions', requireAuth, (req, res) => {
  const db = getDb();
  const { ano, date, crop_type } = req.body;

  if (!ano || !date) {
    return res.status(400).json({ error: 'ano and date are required' });
  }

  const existing = db.get('SELECT * FROM auctions WHERE ano = ? AND date = ?', [ano, date]);
  if (existing) {
    const lotCount = db.get('SELECT COUNT(*) as cnt FROM lots WHERE auction_id = ?', [existing.id]).cnt;
    return res.json({ auction: existing, lotCount, isNew: false });
  }

  const result = db.run(
    'INSERT INTO auctions (ano, date, crop_type) VALUES (?, ?, ?)',
    [ano, date, crop_type || 'ASP']
  );
  const auction = db.get('SELECT * FROM auctions WHERE id = ?', [result.lastInsertRowid]);
  res.status(201).json({ auction, lotCount: 0, isNew: true });
});

app.get('/api/auctions', requireAuth, (req, res) => {
  const db = getDb();
  const auctions = db.all(`
    SELECT a.*,
      (SELECT COUNT(*) FROM lots WHERE auction_id = a.id) as lot_count,
      (SELECT COALESCE(SUM(qty), 0) FROM lots WHERE auction_id = a.id) as total_qty
    FROM auctions a ORDER BY a.date DESC, a.ano DESC
  `);
  res.json({ auctions });
});

// ── LOTS ────────────────────────────────────────────────────

app.post('/api/lots', requireAuth, (req, res) => {
  const db = getDb();
  const { auction_id, trader_id, branch, grade, bags, litre, qty, state } = req.body;
  const user_id = req.user.username; // Use authenticated username

  if (!auction_id || !trader_id || !branch || bags == null || litre == null || qty == null) {
    return res.status(400).json({
      error: 'Required: auction_id, trader_id, branch, bags, litre, qty'
    });
  }

  const auction = db.get('SELECT * FROM auctions WHERE id = ?', [auction_id]);
  if (!auction) return res.status(404).json({ error: 'Auction not found' });
  if (auction.status !== 'open') return res.status(400).json({ error: 'Auction is closed' });

  try {
    const maxLot = db.get(
      'SELECT COALESCE(MAX(lot_no), 0) as max_lot FROM lots WHERE auction_id = ?',
      [auction_id]
    );
    const nextLotNo = maxLot.max_lot + 1;

    const result = db.run(
      `INSERT INTO lots (auction_id, lot_no, trader_id, branch, grade, bags, litre, qty, user_id, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [auction_id, nextLotNo, trader_id, branch, grade || 1, bags, litre, qty, user_id, state || 'TAMIL NADU']
    );

    const lot = db.get(`
      SELECT l.*, t.name as trader_name, t.cr, t.pan
      FROM lots l JOIN traders t ON t.id = l.trader_id WHERE l.id = ?
    `, [result.lastInsertRowid]);

    const stats = db.get(
      'SELECT COUNT(*) as lot_count, COALESCE(SUM(qty), 0) as total_qty FROM lots WHERE auction_id = ?',
      [auction_id]
    );

    res.status(201).json({
      lot,
      nextLotNo: nextLotNo + 1,
      sessionStats: {
        lotCount: stats.lot_count,
        totalQty: Math.round(stats.total_qty * 10) / 10,
      }
    });
  } catch (err) {
    console.error('Error saving lot:', err.message);
    res.status(500).json({ error: 'Failed to save lot' });
  }
});

app.get('/api/lots', requireAuth, (req, res) => {
  const db = getDb();
  const { auction_id } = req.query;
  if (!auction_id) return res.status(400).json({ error: 'auction_id is required' });

  const lots = db.all(`
    SELECT l.*, t.name as trader_name, t.cr, t.pan, t.ppla, t.pin
    FROM lots l JOIN traders t ON t.id = l.trader_id
    WHERE l.auction_id = ? ORDER BY l.lot_no ASC
  `, [parseInt(auction_id)]);

  const stats = db.get(`
    SELECT COUNT(*) as lot_count, COALESCE(SUM(qty), 0) as total_qty,
           COALESCE(SUM(bags), 0) as total_bags
    FROM lots WHERE auction_id = ?
  `, [parseInt(auction_id)]);

  res.json({
    lots,
    stats: {
      lotCount: stats.lot_count,
      totalQty: Math.round(stats.total_qty * 10) / 10,
      totalBags: stats.total_bags,
    }
  });
});

app.delete('/api/lots/:id', requireAuth, (req, res) => {
  const db = getDb();
  const lot = db.get('SELECT * FROM lots WHERE id = ?', [parseInt(req.params.id)]);
  if (!lot) return res.status(404).json({ error: 'Lot not found' });

  db.run('DELETE FROM lots WHERE id = ?', [parseInt(req.params.id)]);
  res.json({ deleted: true, lot_no: lot.lot_no });
});

// ── EXPORT ──────────────────────────────────────────────────

app.get('/api/export/:auctionId/:format', requireAdmin, async (req, res) => {
  const { auctionId, format } = req.params;
  try {
    const result = format === 'dbf'
      ? await exportDbf(parseInt(auctionId))
      : await exportXlsx(parseInt(auctionId));
    res.download(result.filePath, result.fileName);
  } catch (err) {
    console.error('Export error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── UPLOAD SOURCE ───────────────────────────────────────────

app.post('/api/upload-source', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const db = getDb();
    const count = await importSource(req.file.path, db);
    res.json({
      success: true,
      traders: count,
      message: `Successfully imported ${count} traders`,
    });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: 'Failed to import: ' + err.message });
  }
});

// ── ADMIN ───────────────────────────────────────────────────

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── PWA MOBILE APP ──────────────────────────────────────────

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.get('/manifest.json', (req, res) => {
  res.json({
    name: 'Spice Auction',
    short_name: 'Auction',
    start_url: '/app',
    display: 'standalone',
    background_color: '#f4f3ef',
    theme_color: '#1D9E75',
    icons: []
  });
});

// ── PWA MOBILE APP ──────────────────────────────────────────

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// ── STATUS (public — no auth, needed for connect screen) ───

app.get('/api/status', (req, res) => {
  const db = getDb();
  const traderCount = db.get('SELECT COUNT(*) as cnt FROM traders').cnt;
  const auctionCount = db.get('SELECT COUNT(*) as cnt FROM auctions').cnt;

  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({ interface: name, address: iface.address });
      }
    }
  }

  res.json({
    status: 'running',
    traders: traderCount,
    auctions: auctionCount,
    serverAddresses: addresses,
    port: PORT,
    connectUrl: addresses.length > 0 ? `http://${addresses[0].address}:${PORT}` : `http://localhost:${PORT}`,
  });
});

// ── START ───────────────────────────────────────────────────

const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const CERT_DIR = path.join(__dirname, 'data', 'certs');
const CERT_PATH = path.join(CERT_DIR, 'server.crt');
const KEY_PATH = path.join(CERT_DIR, 'server.key');

/**
 * Auto-generate self-signed certificate if none exists
 */
function ensureCerts() {
  const fs = require('fs');
  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) return true;

  console.log('  Generating self-signed SSL certificate...');
  try {
    fs.mkdirSync(CERT_DIR, { recursive: true });
    const { execSync } = require('child_process');
    execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${KEY_PATH}" -out "${CERT_PATH}" -days 365 -nodes -subj "/CN=SpiceAuction/O=Auction/C=IN" 2>/dev/null`);
    console.log('  SSL certificate generated!');
    return true;
  } catch (e) {
    console.log('  Could not generate SSL cert (openssl not found). Running HTTP only.');
    return false;
  }
}

async function start() {
  await initDb();
  const db = getDb();
  const traderCount = db.get('SELECT COUNT(*) as cnt FROM traders').cnt;
  const userCount = db.get('SELECT COUNT(*) as cnt FROM users').cnt;

  // Start HTTP
  const http = require('http');
  http.createServer(app).listen(PORT, '0.0.0.0');

  // Start HTTPS if certs available
  let httpsRunning = false;
  const hasCerts = ensureCerts();
  if (hasCerts) {
    try {
      const https = require('https');
      const fs = require('fs');
      const sslOptions = {
        key: fs.readFileSync(KEY_PATH),
        cert: fs.readFileSync(CERT_PATH),
      };
      https.createServer(sslOptions, app).listen(HTTPS_PORT, '0.0.0.0');
      httpsRunning = true;
    } catch (e) {
      console.log('  HTTPS failed to start:', e.message);
    }
  }

  console.log('');
  console.log('='.repeat(55));
  console.log('  SPICE AUCTION SERVER');
  console.log('='.repeat(55));
  console.log(`  HTTP Port:   ${PORT}`);
  if (httpsRunning) console.log(`  HTTPS Port:  ${HTTPS_PORT}`);
  console.log(`  Traders:     ${traderCount} loaded`);
  console.log(`  Users:       ${userCount} registered`);
  console.log('');

  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`  Mobile app (HTTP):   http://${iface.address}:${PORT}/app`);
        if (httpsRunning) {
          console.log(`  Mobile app (HTTPS):  https://${iface.address}:${HTTPS_PORT}/app`);
        }
        console.log(`  Admin dashboard:     http://${iface.address}:${PORT}/admin`);
        console.log('');
      }
    }
  }
  console.log(`  Local:               http://localhost:${PORT}`);
  if (httpsRunning) console.log(`  Local (HTTPS):       https://localhost:${HTTPS_PORT}`);
  console.log('');
  console.log('  Default admin:       admin / admin123');
  console.log('');
  if (httpsRunning) {
    console.log('  NOTE: Phones will show a security warning for the');
    console.log('  self-signed cert. Tap "Advanced" → "Proceed" to accept.');
  }
  console.log('');
  console.log('  Ready for lot entries!');
  console.log('='.repeat(55));
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  closeDb();
  process.exit(0);
});

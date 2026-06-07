const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { initDb, getDb } = require('./db/database');

const app  = express();
const PORT = process.env.PORT || 3000;

fs.mkdirSync(path.join(__dirname, 'uploads/photos'), { recursive: true });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'pvs-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 8 * 60 * 60 * 1000 }
}));

app.use('/uploads/photos', express.static(path.join(__dirname, 'uploads/photos')));
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js',  express.static(path.join(__dirname, 'public/js')));

app.use('/',         require('./routes/auth'));
app.use('/manager',  require('./routes/manager'));
app.use('/operator', require('./routes/operator'));
app.use('/qa',       require('./routes/qa'));

app.get('/', (req, res) => res.redirect('/dashboard'));

// ── Debug routes (safe to leave in — read-only, no passwords exposed) ─────────
app.get('/debug/users', (req, res) => {
  const db    = getDb();
  const result = db.rawExec('SELECT id, name, email, role, length(password) as pwd_len FROM users');
  if (!result || result.length === 0) return res.json([]);
  const cols = result[0].columns;
  const rows = result[0].values.map(v => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = v[i]);
    return obj;
  });
  res.json(rows);
});

// hecks the same hardcoded account (manager@pvs.com with password123) 
// to confirm the DB and bcrypt are working.
app.get('/debug/login-test', (req, res) => {
  const db     = getDb();
  const result = db.rawExec('SELECT id, name, email, password, role FROM users WHERE email = ?', ['manager@pvs.com']);
  if (!result || result.length === 0 || result[0].values.length === 0) {
    return res.json({ found: false });
  }
  const cols = result[0].columns;
  const vals = result[0].values[0];
  const user = {};
  cols.forEach((c, i) => user[c] = vals[i]);

  const bcrypt = require('bcryptjs');
  const match  = bcrypt.compareSync('password123', user.password);
  res.json({
    found:      true,
    email:      user.email,
    role:       user.role,
    pwd_length: user.password ? user.password.length : 0,
    pwd_match:  match
  });
});
app.get('/debug/products', (req, res) => {
  const db = getDb();
  const result = db.rawExec('SELECT COUNT(*) as total, MIN(expiry_date) as earliest_expiry, MAX(expiry_date) as latest_expiry FROM products');
  if (!result || result.length === 0) return res.json({ total: 0 });
  const cols = result[0].columns;
  const obj  = {};
  cols.forEach((c, i) => obj[c] = result[0].values[0][i]);
  res.json(obj);
});
// ─────────────────────────────────────────────────────────────────────────────

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  PVS running at http://localhost:${PORT}`);
    console.log('  Test login: http://localhost:' + PORT + '/debug/login-test\n');
  });
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});

module.exports = app;

const express = require('express');
const bcrypt  = require('bcryptjs');
const { getDb } = require('../db/database');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/dashboard');
  res.sendFile('login.html', { root: __dirname + '/../public' });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.redirect('/login?error=missing');
  }

  const db = getDb();

  // Use sqlAll-style exec so we know exactly what sql.js returns
  // Use db.get() — uses prepare/bind/step which correctly handles params in sql.js
  // NOTE: db.rawExec (sql.js exec()) does NOT support bound parameters — it ignores them
  const user = db.get(
    'SELECT id, name, email, password, role FROM users WHERE email = ?',
    [email.trim().toLowerCase()]
  );

  if (!user) {
    console.log('Login failed: user not found for', email);
    return res.redirect('/login?error=invalid');
  }

  console.log('User found:', user.email, '| pwd length:', user.password ? user.password.length : 'NONE');

  if (!user.password) {
    return res.redirect('/login?error=invalid');
  }

  const match = bcrypt.compareSync(password, user.password);
  console.log('Password match:', match);

  if (!match) {
    return res.redirect('/login?error=invalid');
  }

  req.session.user = { id: user.id, name: user.name, role: user.role, email: user.email };
  console.log('Login success:', user.email, 'role:', user.role);
  res.redirect('/dashboard');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.get('/dashboard', (req, res) => {
  if (!req.session || !req.session.user) return res.redirect('/login');
  const role = req.session.user.role;
  if (role === 'manager')  return res.redirect('/manager');
  if (role === 'operator') return res.redirect('/operator');
  if (role === 'qa')       return res.redirect('/qa');
  res.redirect('/login');
});

module.exports = router;

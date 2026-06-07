// routes/qa.js
const express = require('express');
const { getDb } = require('../db/database');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /qa — serve QA dashboard
router.get('/', requireRole('qa'), (req, res) => {
  res.sendFile('index.html', { root: __dirname + '/../public/qa' });
});

// GET /qa/report?from=YYYY-MM-DD&to=YYYY-MM-DD — fetch verification logs
router.get('/report', requireRole('qa'), (req, res) => {
  const { from, to, page = 1, limit = 50 } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: 'Both from and to dates are required' });
  }

  const db = getDb();
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const rows = db.prepare(`
    SELECT
      vl.id,
      vl.wid,
      p.ean,
      p.manufacturing_date,
      p.expiry_date,
      u.name   AS operator_name,
      u.email  AS operator_email,
      vl.checked_at,
      vl.photo_path,
      vl.notes
    FROM validation_logs vl
    JOIN products p ON p.wid = vl.wid
    JOIN users    u ON u.id  = vl.checked_by
    WHERE date(vl.checked_at) >= date(?) AND date(vl.checked_at) <= date(?)
    ORDER BY vl.checked_at DESC
    LIMIT ? OFFSET ?
  `).all(from, to, parseInt(limit), offset);

  const totalRow = db.prepare(`
    SELECT COUNT(*) as total FROM validation_logs
    WHERE date(checked_at) >= date(?) AND date(checked_at) <= date(?)
  `).get(from, to);

  // Add expiry status to each row
  const today = new Date().toISOString().split('T')[0];
  rows.forEach(r => {
    r.is_expired = r.expiry_date < today;
  });

  res.json({
    total: totalRow.total,
    page: parseInt(page),
    limit: parseInt(limit),
    pages: Math.ceil(totalRow.total / parseInt(limit)),
    rows
  });
});

// GET /qa/report/export — download full date-range as CSV
router.get('/report/export', requireRole('qa'), (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).send('from and to dates are required');
  }

  const db = getDb();
  const rows = db.prepare(`
    SELECT
      vl.wid,
      p.ean,
      p.manufacturing_date,
      p.expiry_date,
      u.name   AS operator_name,
      vl.checked_at,
      vl.notes,
      CASE WHEN vl.photo_path IS NOT NULL THEN 'Yes' ELSE 'No' END AS has_photo
    FROM validation_logs vl
    JOIN products p ON p.wid = vl.wid
    JOIN users    u ON u.id  = vl.checked_by
    WHERE date(vl.checked_at) >= date(?) AND date(vl.checked_at) <= date(?)
    ORDER BY vl.checked_at DESC
  `).all(from, to);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="verification-report-${from}-to-${to}.csv"`);

  const header = 'WID,EAN,Manufacturing Date,Expiry Date,Operator,Verified At,Notes,Has Photo\n';
  const csvRows = rows.map(r =>
    [r.wid, r.ean, r.manufacturing_date, r.expiry_date,
     `"${r.operator_name}"`, r.checked_at,
     `"${(r.notes || '').replace(/"/g, '""')}"`, r.has_photo
    ].join(',')
  );

  res.send(header + csvRows.join('\n'));
});

// GET /qa/stats — summary numbers for the dashboard header
router.get('/stats', requireRole('qa'), (req, res) => {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];

  const stats = {
    total_products: db.prepare('SELECT COUNT(*) as c FROM products').get().c,
    total_verifications: db.prepare('SELECT COUNT(*) as c FROM validation_logs').get().c,
    verifications_today: db.prepare(
      "SELECT COUNT(*) as c FROM validation_logs WHERE date(checked_at) = date('now')"
    ).get().c,
    expired_products: db.prepare(
      'SELECT COUNT(*) as c FROM products WHERE expiry_date < ?'
    ).get(today).c,
  };

  res.json(stats);
});

module.exports = router;

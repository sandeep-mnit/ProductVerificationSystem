// routes/operator.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Multer for product photos
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads/photos')),
  filename:    (req, file, cb) => cb(null, `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`)
});
const uploadPhoto = multer({
  storage: photoStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Images only'));
    cb(null, true);
  }
});

// GET /operator — serve operator page
router.get('/', requireRole('operator'), (req, res) => {
  res.sendFile('index.html', { root: path.join(__dirname, '../public/operator') });
});

// GET /operator/lookup/:wid — fast product lookup (used after scan)
router.get('/lookup/:wid', requireRole('operator'), (req, res) => {
  const db = getDb();
  // const product = db.prepare(
  //   'SELECT wid, ean, manufacturing_date, expiry_date FROM products WHERE wid = ?'
  // ).get(req.params.wid.trim());

  const product = db.prepare(
    'SELECT wid, ean, manufacturing_date, expiry_date FROM products WHERE wid = ?')
  .get([req.params.wid.trim()]);

  if (!product) {
    return res.status(404).json({ error: 'WID not found in system' });
  }

  // Compute expiry status for the UI
  const today = new Date().toISOString().split('T')[0];
  product.is_expired = product.expiry_date < today;
  product.days_until_expiry = Math.ceil(
    (new Date(product.expiry_date) - new Date(today)) / (1000 * 60 * 60 * 24)
  );

  res.json(product);
});

// POST /operator/verify — log a verification event with optional photo
router.post('/verify', requireRole('operator'), uploadPhoto.single('photo'), (req, res) => {
  const { wid, notes } = req.body;

  if (!wid) {
    return res.status(400).json({ error: 'WID is required' });
  }

  const db = getDb();

  // Confirm WID exists
  // const product = db.prepare('SELECT wid FROM products WHERE wid = ?').get(wid.trim());
  const product = db.prepare('SELECT wid FROM products WHERE wid = ?').get([wid.trim()]);
  if (!product) {
    return res.status(404).json({ error: 'WID not found' });
  }

  const logId = uuidv4();
  const photoPath = req.file ? `/uploads/photos/${req.file.filename}` : null;

  db.prepare(`
    INSERT INTO validation_logs (id, wid, checked_by, photo_path, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(logId, wid.trim(), req.session.user.id, photoPath, notes || null);

  res.json({
    success: true,
    logId,
    message: 'Verification logged successfully',
    photo: photoPath
  });
});

// GET /uploads/photos/:filename — serve uploaded photos
router.get('/photos/:filename', requireRole('operator', 'qa', 'manager'), (req, res) => {
  res.sendFile(req.params.filename, {
    root: path.join(__dirname, '../uploads/photos')
  });
});

module.exports = router;

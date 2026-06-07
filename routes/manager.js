const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { parse } = require('csv-parse');
const { v4: uuidv4 } = require('uuid');
const { getDb, saveDb } = require('../db/database');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
  filename:    (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!file.originalname.match(/\.csv$/i)) return cb(new Error('Only CSV files allowed'));
    cb(null, true);
  },
  limits: { fileSize: 500 * 1024 * 1024 }  // 500 MB
});

router.get('/', requireRole('manager'), (req, res) => {
  res.sendFile('index.html', { root: path.join(__dirname, '../public/manager') });
});

router.post('/upload', requireRole('manager'), upload.single('csvfile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file provided' });

  const jobId = uuidv4();
  const db    = getDb();
  db.run(
    `INSERT INTO upload_jobs (id, filename, status, started_by) VALUES (?, ?, 'processing', ?)`,
    [jobId, req.file.originalname, req.session.user.id]
  );

  setImmediate(() => processCsvJob(jobId, req.file.path));
  res.json({ jobId });
});

router.get('/job/:id', requireRole('manager'), (req, res) => {
  const db  = getDb();
  const job = db.get('SELECT * FROM upload_jobs WHERE id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  job.error_log = JSON.parse(job.error_log || '[]');
  res.json(job);
});

router.get('/jobs', requireRole('manager'), (req, res) => {
  const db   = getDb();
  const jobs = db.all(
    `SELECT id, filename, status, total_rows, processed, errors, started_at, finished_at
     FROM upload_jobs WHERE started_by = ? ORDER BY started_at DESC LIMIT 50`,
    [req.session.user.id]
  );
  res.json(jobs);
});

// ─── CSV Processing ───────────────────────────────────────────────────────────

function processCsvJob(jobId, filePath) {
  const db     = getDb();
  const errors = [];
  let totalRows = 0;
  let processed = 0;

  // Larger batch = fewer disk saves = much faster for big files
  const BATCH_SIZE  = 10000;
  // Only save DB to disk every N batches (not every single batch)
  const SAVE_EVERY  = 5;      // save every 50,000 rows
  let   batchCount  = 0;
  let   batch       = [];

  // Build raw SQL for fast bulk insert — avoids the prepare() wrapper overhead
  function commitBatch(rows) {
    if (rows.length === 0) return;

    // Build one big INSERT with multiple value rows
    // ON CONFLICT handles duplicate WIDs gracefully
    const placeholders = rows.map(() => '(?,?,?,?)').join(',');
    const values = [];
    rows.forEach(r => values.push(r.wid, r.ean, r.manufacturing_date, r.expiry_date));

    db.run(
      `INSERT INTO products (wid, ean, manufacturing_date, expiry_date)
       VALUES ${placeholders}
       ON CONFLICT(wid) DO UPDATE SET
         ean = excluded.ean,
         manufacturing_date = excluded.manufacturing_date,
         expiry_date = excluded.expiry_date`,
      values
    );

    processed += rows.length;
    batchCount++;

    // Update job progress (but don't saveDb every time — too slow)
    db.run(
      `UPDATE upload_jobs SET processed = ?, errors = ?, error_log = ? WHERE id = ?`,
      [processed, errors.length, JSON.stringify(errors.slice(-50)), jobId]
    );

    // Only flush to disk every SAVE_EVERY batches
    if (batchCount % SAVE_EVERY === 0) {
      saveDb();
      console.log(`  Job ${jobId.slice(0,8)}: ${processed.toLocaleString()} rows processed...`);
    }
  }

  const stream = fs.createReadStream(filePath);
  const parser = parse({ columns: true, skip_empty_lines: true, trim: true });

  parser.on('readable', () => {
    let record;
    while ((record = parser.read()) !== null) {
      totalRows++;

      const { WID, EAN, Manufacturing_Date, Expiry_Date } = record;

      if (!WID || !EAN || !Manufacturing_Date || !Expiry_Date) {
        if (errors.length < 100) {
          errors.push({ row: totalRows, error: 'Missing required field' });
        }
        continue;
      }

      batch.push({
        wid:               WID.trim(),
        ean:               EAN.trim(),
        manufacturing_date: Manufacturing_Date.trim(),
        expiry_date:       Expiry_Date.trim()
      });

      if (batch.length >= BATCH_SIZE) {
        try {
          commitBatch(batch);
        } catch (err) {
          console.error('Batch error:', err.message);
          errors.push({ row: totalRows, error: err.message });
        }
        batch = [];
      }
    }
  });

  parser.on('end', () => {
    // Commit remaining rows
    try { commitBatch(batch); } catch (e) { errors.push({ error: e.message }); }

    // Final save and mark job done
    db.run(
      `UPDATE upload_jobs
       SET status = 'done', total_rows = ?, processed = ?, errors = ?,
           error_log = ?, finished_at = datetime('now')
       WHERE id = ?`,
      [totalRows, processed, errors.length, JSON.stringify(errors.slice(-100)), jobId]
    );

    saveDb();  // Final disk flush
    fs.unlink(filePath, () => {});

    console.log(`  Job ${jobId.slice(0,8)} DONE: ${processed.toLocaleString()} / ${totalRows.toLocaleString()} rows, ${errors.length} errors`);
  });

  parser.on('error', (err) => {
    db.run(
      `UPDATE upload_jobs SET status = 'failed', error_log = ?, finished_at = datetime('now') WHERE id = ?`,
      [JSON.stringify([{ error: err.message }]), jobId]
    );
    saveDb();
    fs.unlink(filePath, () => {});
    console.error('CSV parse error:', err.message);
  });

  stream.pipe(parser);
}

module.exports = router;

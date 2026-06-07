# Product Verification System — Setup Guide

## Prerequisites

- Node.js 18+ (https://nodejs.org)
- npm

## Quick Start (3 steps)

### 1. Install dependencies

```bash
cd ProductVerificationSystem
npm install
```

### 2. Start the server

```bash
npm start
# or for development with auto-restart:
npm run dev
```

### 3. Open the app

Visit http://localhost:3000

---

## Default Login Accounts

All accounts use password: `password123`

| Email            | Role     | Dashboard                   |
| ---------------- | -------- | --------------------------- |
| manager@pvs.com  | Manager  | /manager (CSV upload)       |
| operator@pvs.com | Operator | /operator (verify products) |
| qa@pvs.com       | QA       | /qa (reports)               |

Sessions expire after **8 hours** of inactivity.

---

## CSV Format for Upload

```csv
WID,EAN,Manufacturing_Date,Expiry_Date
WH-001,5901234123457,2024-01-15,2026-01-15
WH-002,5901234123457,2024-02-01,2026-02-01
WH-003,4006381333931,2023-11-10,2025-11-10
```

**Column rules:**

- `WID` — unique per physical item (primary key)
- `EAN` — product barcode (multiple WIDs can share an EAN)
- `Manufacturing_Date` — recommended format: YYYY-MM-DD
- `Expiry_Date` — recommended format: YYYY-MM-DD

> **Excel users:** Before exporting as CSV, widen date columns so they show actual dates (not `########`) and format EAN columns as **Text** (not Number) to prevent scientific notation like `8.43E+12`.

---

## Project Structure

```
ProductVerificationSystem/
    ├── server.js              # Express entry point
    ├── package.json
    ├── db/
    │   ├── database.js        # sql.js setup, schema creation + seed users
    │   └── pvs.db             # SQLite database (auto-created on first run)
    ├── middleware/
    │   └── auth.js            # Session auth + role guard
    ├── routes/
    │   ├── auth.js            # Login / logout / dashboard redirect
    │   ├── manager.js         # CSV upload + background job polling
    │   ├── operator.js        # WID lookup + verification logging + photo upload
    │   └── qa.js              # Report generation + CSV export + stats
    ├── public/
    │   ├── login.html         # Shared login page
    │   ├── manager/index.html # Manager upload dashboard
    │   ├── operator/index.html# Operator verification page (mobile-optimised)
    │   └── qa/index.html      # QA reporting dashboard
    └── uploads/
        └── photos/            # Product photos captured during verification
```

---

## How Each Role Works

### Warehouse Manager

1. Log in at `/login` → auto-redirected to `/manager`
2. Drag & drop or browse for a CSV file
3. Click **Upload & Process** — a background job starts immediately
4. Progress bar polls every 1.5 seconds
5. Upload history shows all past jobs with row counts and error summaries

### Warehouse Operator (mobile-first)

1. Log in → redirected to `/operator`
2. Type or scan a WID (barcode reader sends keystrokes + Enter)
3. System shows EAN, manufacturing date, expiry date, and expired status
4. Optionally capture a photo with the device camera
5. Add notes, click **Confirm & Log Verification**
6. Click **Verify another product** to reset for the next scan

### QA Manager

1. Log in → redirected to `/qa`
2. View live stats: total products, total verifications, today's count, expired items
3. Pick a From/To date range, click **Generate Report**
4. Browse paginated results (50 rows per page)
5. Click **Export CSV** to download the full date range as a file

---

## Scalability Notes

- **Large CSVs:** Processed in batches of 10,000 rows using SQL transactions — a 1M-row file processes without blocking the HTTP server. DB is flushed to disk every 5 batches (every 50,000 rows) to balance speed and durability.
- **WID uniqueness:** Enforced at the database `PRIMARY KEY` level — duplicates are rejected at the DB layer, not just in application code.
- **Duplicate uploads:** `ON CONFLICT ... DO UPDATE` means re-uploading a CSV with the same WIDs safely updates existing records rather than erroring.
- **Concurrent operators:** sql.js is an in-memory SQLite engine — for multi-instance deployments, migrate to PostgreSQL (see Production Upgrade Path below).
- **Photo storage:** Currently stored on local disk at `uploads/photos/`. In production, replace with S3 or equivalent object storage.

---

## Environment Variables (optional)

```bash
PORT=3000                  # Default: 3000
SESSION_SECRET=your-secret # Change this in production!
```

---

## Production Checklist

- [ ] Set `SESSION_SECRET` to a long random string
- [ ] Set `cookie.secure = true` in `server.js` (requires HTTPS)
- [ ] Add HTTPS via nginx or a reverse proxy
- [ ] Migrate from sql.js to PostgreSQL for multi-server deployments
- [ ] Move photo uploads from local disk to S3 / object storage
- [ ] Remove or protect debug routes (`/debug/users`, `/debug/products`, `/debug/login-test`)

---

## Production Upgrade Path

The current stack uses **sql.js** (an in-memory SQLite engine) which persists to a single `.db` file. This is ideal for a single-server deployment.

For multi-server or high-concurrency production use:

- Replace `sql.js` with **PostgreSQL** using the `pg` package
- The DB wrapper in `db/database.js` abstracts all queries — only that file needs to change
- All SQL is standard and compatible with PostgreSQL with minimal changes
- Photo storage: swap `multer.diskStorage` in `routes/operator.js` for `multer-s3` and update `photo_path` to store the S3 URL instead of a local path

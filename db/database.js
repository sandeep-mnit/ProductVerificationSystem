const path = require('path');
const fs   = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'pvs.db');
let db  = null;
let SQL = null;

async function initDb() {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    console.log('  Loading existing DB:', DB_PATH);
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    console.log('  Creating new DB:', DB_PATH);
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('manager','operator','qa')),
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    wid TEXT PRIMARY KEY, ean TEXT NOT NULL,
    manufacturing_date TEXT NOT NULL, expiry_date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_products_ean    ON products(ean)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_products_expiry ON products(expiry_date)`);

  db.run(`CREATE TABLE IF NOT EXISTS validation_logs (
    id TEXT PRIMARY KEY, wid TEXT NOT NULL, checked_by TEXT NOT NULL,
    checked_at TEXT DEFAULT (datetime('now')), photo_path TEXT, notes TEXT,
    FOREIGN KEY(wid) REFERENCES products(wid),
    FOREIGN KEY(checked_by) REFERENCES users(id)
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_wid        ON validation_logs(wid)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_checked_at ON validation_logs(checked_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_user       ON validation_logs(checked_by)`);

  db.run(`CREATE TABLE IF NOT EXISTS upload_jobs (
    id TEXT PRIMARY KEY, filename TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    total_rows INTEGER DEFAULT 0, processed INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0, error_log TEXT DEFAULT '[]',
    started_by TEXT NOT NULL,
    started_at TEXT DEFAULT (datetime('now')), finished_at TEXT,
    FOREIGN KEY(started_by) REFERENCES users(id)
  )`);

  saveDb();

  const res   = db.exec('SELECT COUNT(*) FROM users');
  const count = res[0] ? res[0].values[0][0] : 0;
  console.log('  Users in DB:', count);

  if (count === 0) {
    const { v4: uuidv4 } = require('uuid');
    [
      { name: 'Alice Manager', email: 'manager@pvs.com',  role: 'manager'  },
      { name: 'Bob Operator',  email: 'operator@pvs.com', role: 'operator' },
      { name: 'Carol QA',      email: 'qa@pvs.com',       role: 'qa'       },
    ].forEach(u => {
      const hash = bcrypt.hashSync('password123', 10);
      db.run('INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
        [uuidv4(), u.name, u.email, hash, u.role]);
      console.log('  Seeded:', u.email);
    });
    saveDb();
  }

  console.log('  DB ready.');
}

function saveDb() {
  if (!db) return;
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

// ─── sql.js correct query pattern: prepare → bind → step → getAsObject ────────

function sqlGet(sql, params = []) {
  const stmt   = db.prepare(sql);
  stmt.bind(params);
  const hasRow = stmt.step();
  const row    = hasRow ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function sqlAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function sqlRun(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

// rawExec — returns sql.js native format: [{columns:[...], values:[[...]]}]
// Used by auth.js for reliable SELECT with all columns
function sqlRawExec(sql, params = []) {
  return db.exec(sql, params);
}

function getDb() {
  if (!db) throw new Error('DB not initialized');
  return {
    get(sql, params = [])      { return sqlGet(sql, params); },
    all(sql, params = [])      { return sqlAll(sql, params); },
    run(sql, params = [])      { sqlRun(sql, params); return this; },
    rawExec(sql, params = [])  { return sqlRawExec(sql, params); },

    // prepare(sql) {
    //   return {
    //     run(...args) {
    //       const params = (args.length === 1 && args[0] !== null &&
    //         typeof args[0] === 'object' && !Array.isArray(args[0]))
    //         ? Object.values(args[0]) : args.flat();
    //       sqlRun(sql, params);
    //     },
    //     get(params = [])  { return sqlGet(sql, params); },
    //     all(params = [])  { return sqlAll(sql, params); }
    //   };
    // },

    prepare(sql) {
      return {
        run(...args) {
          const params = (args.length === 1 && Array.isArray(args[0])) ? args[0] :
            (args.length === 1 && args[0] !== null && typeof args[0] === 'object') 
              ? Object.values(args[0]) : args.flat();
          sqlRun(sql, params);
        },
        // Accept array OR spread: .get([a,b]) and .get(a,b) both work
        get(...args)  { 
          const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
          return sqlGet(sql, params); 
        },
        all(...args)  { 
          const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
          return sqlAll(sql, params); 
        }
      };
    },

    transaction(fn) {
      return (rows) => {
        db.run('BEGIN');
        try   { fn(rows); db.run('COMMIT'); saveDb(); }
        catch (e) { db.run('ROLLBACK'); throw e; }
      };
    }
  };
}

module.exports = { getDb, initDb, saveDb };

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
const schema = require('./schema');

// Local development: file:data/local.db    Production: libsql://...turso.io
const url = process.env.TURSO_DATABASE_URL || 'file:data/local.db';
const isFile = url.startsWith('file:');

if (isFile) {
  fs.mkdirSync(path.resolve(process.cwd(), path.dirname(url.slice(5))), { recursive: true });
}

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });

const clean = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

// Positional values (...params) or one object with named values (@name).
// Named values that the SQL text does not use are dropped.
function pack(sql, params) {
  if (params.length === 1 && params[0] !== null && typeof params[0] === 'object') {
    const p = params[0];
    if (Array.isArray(p)) return p.map(clean);
    const out = {};
    Object.keys(p).forEach((k) => {
      if (new RegExp('[@:$]' + k + '\\b').test(sql)) out[k] = clean(p[k]);
    });
    return out;
  }
  return params.map(clean);
}

function toRow(columns, row) {
  const o = {};
  columns.forEach((c, i) => { o[c] = row[i]; });
  return o;
}

// The same methods work on the client and inside a transaction.
function api(executor) {
  const exe = (sql, params) => executor.execute({ sql, args: pack(sql, params) });
  return {
    async all(sql, ...p) {
      const r = await exe(sql, p);
      return r.rows.map((row) => toRow(r.columns, row));
    },
    async get(sql, ...p) {
      const r = await exe(sql, p);
      return r.rows.length ? toRow(r.columns, r.rows[0]) : undefined;
    },
    async run(sql, ...p) {
      const r = await exe(sql, p);
      return { changes: r.rowsAffected, lastId: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null };
    },
    async exec(sql) {
      await executor.executeMultiple(sql);
    },
  };
}

const db = api(client);

db.tx = async function (fn) {
  const t = await client.transaction('write');
  try {
    const out = await fn(api(t));
    await t.commit();
    return out;
  } catch (err) {
    try { await t.rollback(); } catch (e) { /* ignore */ }
    throw err;
  } finally {
    t.close();
  }
};

db.batch = async function (statements) {
  await client.batch(
    statements.map((s) => ({ sql: s.sql, args: pack(s.sql, [s.args || []]) })),
    'write'
  );
};

db.initSchema = async function () {
  await client.executeMultiple(schema);
  try { await client.execute('PRAGMA foreign_keys = ON'); } catch (e) { /* not needed on some servers */ }
};

db.url = url;
db.isFile = isFile;
db.client = client;

module.exports = db;
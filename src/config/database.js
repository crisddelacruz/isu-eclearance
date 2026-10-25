require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const schema = require('./schema');

// Database file location (relative to the project root)
const dbPath = path.resolve(__dirname, '../..', process.env.DB_PATH || 'data/isu-eclearance.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

// WAL mode is faster for many users, but it creates extra files that can
// upset OneDrive. So we only use it on the real server.
if (process.env.NODE_ENV === 'production') {
  db.pragma('journal_mode = WAL');
}
db.pragma('foreign_keys = ON'); // enforce table relationships

// Create all tables if they don't exist yet
db.exec(schema);

module.exports = db;
module.exports.dbPath = dbPath;
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const sig = require('./signature');

const ROOT = path.resolve(__dirname, '../../backups');

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Deletes the oldest backups, keeping BACKUP_KEEP (default 14).
function prune() {
  const keep = parseInt(process.env.BACKUP_KEEP, 10) || 14;
  const dirs = fs.readdirSync(ROOT).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
  dirs.slice(0, Math.max(0, dirs.length - keep)).forEach((n) => {
    fs.rmSync(path.join(ROOT, n), { recursive: true, force: true });
  });
}

// One backup folder per day: backups/2026-10-26/ (database + signatures).
// Skips if today's backup already exists, unless force is true.
async function runBackup({ force = false } = {}) {
  fs.mkdirSync(ROOT, { recursive: true });
  const dir = path.join(ROOT, today());

  if (fs.existsSync(dir)) {
    if (!force) return { skipped: true, dir };
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const tmp = dir + '.partial';
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp);

  await db.backup(path.join(tmp, 'isu-eclearance.db')); // safe copy while the server runs
  if (fs.existsSync(sig.DIR)) fs.cpSync(sig.DIR, path.join(tmp, 'signatures'), { recursive: true });

  fs.renameSync(tmp, dir); // only a finished backup gets the real name
  prune();
  return { dir };
}

module.exports = { runBackup };
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const sig = require('./signature');

let fails = 0;
const ok = (cond, label) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
  if (!cond) fails++;
};

const FILES = ['admin', 'files', 'verify', 'pdf'];
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function main() {
  if (!db.isFile) throw new Error('Run this against the LOCAL file database only.');

  // 1. Route files: no old calls, and they load
  for (const f of FILES) {
    const p = path.resolve(__dirname, '../routes', f + '.js');
    const code = fs.readFileSync(p, 'utf8');
    ok(!/db\.prepare\(|db\.transaction\(|better-sqlite3/.test(code), f + '.js has no old-style database calls');
    let loaded = false;
    try { loaded = typeof require(p) === 'function'; } catch (e) { console.error(e.message); }
    ok(loaded, f + '.js loads as an Express router');
  }

  // 2. The verify page is the right file
  const idx = fs.readFileSync(path.resolve(__dirname, '../../views/verify/index.ejs'), 'utf8');
  ok(!/sheet\.request/.test(idx) && /Verification code/.test(idx), 'views/verify/index.ejs is the code-entry page');

  // 3. A bulk insert in ONE batch, and duplicates are refused
  const hash = 'x';
  const stmts = [1, 2, 3].map((i) => ({
    sql: `INSERT INTO users (role, email, password_hash, first_name, last_name, status)
          VALUES ('student', @email, @h, 'Batch', 'Test', 'active')`,
    args: { email: 'batch' + i + '@example.com', h: hash },
  }));
  await db.batch(stmts);
  const n = await db.get("SELECT COUNT(*) AS n FROM users WHERE email LIKE 'batch%@example.com'");
  ok(n.n === 3, 'db.batch inserts several rows in one call');
  let rolled = false;
  try {
    await db.batch([
      { sql: "INSERT INTO settings (key, value) VALUES ('b1', '1')", args: [] },
      { sql: "INSERT INTO users (role, email, password_hash, first_name, last_name) VALUES ('student','batch1@example.com','x','a','b')", args: [] },
    ]);
  } catch (e) { rolled = true; }
  const b1 = await db.get("SELECT 1 AS x FROM settings WHERE key = 'b1'");
  ok(rolled && !b1, 'a failing batch is rolled back completely');

  // 4. Signature storage and removal rules
  const name = await sig.saveFile(PNG, 'png');
  const lib = await db.get("SELECT id FROM users WHERE email = 'library@isu-demo.local'");
  await db.run('UPDATE users SET signature_path = ? WHERE id = ?', name, lib.id);
  await sig.removeIfUnused(name);
  ok(!!(await sig.getFile(name)), 'a signature still used by a user is NOT deleted');
  await db.run('UPDATE users SET signature_path = NULL WHERE id = ?', lib.id);
  await sig.removeIfUnused(name);
  ok(!(await sig.getFile(name)), 'an unused signature is deleted');

  // 5. Demo purge sequence (same statements as the admin button)
  const DEMO_LIKE = '%@isu-demo.local';
  const DEMO = '(SELECT id FROM users WHERE email LIKE ?)';
  const removed = await db.tx(async (t) => {
    await t.run(`DELETE FROM clearance_items WHERE request_id IN (SELECT id FROM clearance_requests WHERE student_id IN ${DEMO})`, DEMO_LIKE);
    await t.run(`DELETE FROM clearance_requests WHERE student_id IN ${DEMO}`, DEMO_LIKE);
    await t.run(`DELETE FROM enrollments WHERE student_id IN ${DEMO}`, DEMO_LIKE);
    await t.run(`UPDATE enrollments SET instructor_id = NULL WHERE instructor_id IN ${DEMO}`, DEMO_LIKE);
    await t.run(`UPDATE clearance_items SET signatory_id = NULL WHERE signatory_id IN ${DEMO}`, DEMO_LIKE);
    await t.run(`DELETE FROM notifications WHERE user_id IN ${DEMO}`, DEMO_LIKE);
    await t.run(`UPDATE audit_logs SET user_id = NULL WHERE user_id IN ${DEMO}`, DEMO_LIKE);
    await t.run(`DELETE FROM password_resets WHERE user_id IN ${DEMO}`, DEMO_LIKE);
    return (await t.run('DELETE FROM users WHERE email LIKE ?', DEMO_LIKE)).changes;
  });
  ok(removed === 14, 'demo purge removed all 14 demo accounts (' + removed + ')');
  const fk = await db.all('PRAGMA foreign_key_check');
  ok(fk.length === 0, 'no foreign key problems after the purge');

  console.log(fails ? '\n' + fails + ' check(s) FAILED.' : '\nAll checks passed.');
  console.log('Run "npm run db:reset" to restore the demo data.');
}

main()
  .then(() => process.exit(fails ? 1 : 0))
  .catch((err) => {
    console.error('Check crashed:', err);
    process.exit(1);
  });
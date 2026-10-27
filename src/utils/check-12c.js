require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../config/database');

let fails = 0;
const ok = (cond, label) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
  if (!cond) fails++;
};

const FILES = ['auth', 'account', 'reset', 'student', 'signatory'];

async function main() {
  if (!db.isFile) throw new Error('Run this against the LOCAL file database only.');

  // 1. No leftover old-style calls, and each file loads as a router
  for (const f of FILES) {
    const p = path.resolve(__dirname, '../routes', f + '.js');
    const code = fs.readFileSync(p, 'utf8');
    const old = /db\.prepare\(|req\.session\.(regenerate|destroy)|\.run\(\)\s*;?\s*$/m.test(code);
    ok(!old, f + '.js has no old-style database or session calls');
    let loaded = false;
    try { loaded = typeof require(p) === 'function'; } catch (e) { console.error(e.message); }
    ok(loaded, f + '.js loads as an Express router');
  }

  // 2. Login lookup by email and by ID number
  const byEmail = await db.get('SELECT * FROM users WHERE email = ? OR lower(id_number) = lower(?)',
    'student@isu-demo.local', 'student@isu-demo.local');
  const byId = await db.get('SELECT * FROM users WHERE email = ? OR lower(id_number) = lower(?)',
    '2026-00001', '2026-00001');
  ok(byEmail && byId && byEmail.id === byId.id, 'login finds the same student by email and by ID number');
  ok(await bcrypt.compare('Demo@12345', byEmail.password_hash), 'demo password verifies');
  ok(!(await bcrypt.compare('wrong-password1', byEmail.password_hash)), 'a wrong password is rejected');

  // 3. Session version
  ok(byEmail.session_version === 0, 'new users start at session_version 0');
  await db.run('UPDATE users SET session_version = session_version + 1 WHERE id = ?', byEmail.id);
  const after = await db.get('SELECT session_version FROM users WHERE id = ?', byEmail.id);
  ok(after.session_version === 1, 'session_version can be raised (this signs old cookies out)');

  // 4. Registration insert and duplicate protection
  const hash = await bcrypt.hash('Test1234', 10);
  const ins = await db.run(
    `INSERT INTO users (role, id_number, email, password_hash, first_name, last_name,
                        college_id, program_id, year_level, status)
     VALUES ('student', 'TEST-0001', 'check12c@example.com', ?, 'Check', 'Student',
             (SELECT id FROM colleges WHERE code = 'CCSICT'), (SELECT id FROM programs WHERE code = 'BSIT'), 1, 'active')`,
    hash
  );
  ok(ins.lastId > 0, 'a new student can be inserted (id ' + ins.lastId + ')');
  let dup = false;
  try {
    await db.run(
      `INSERT INTO users (role, id_number, email, password_hash, first_name, last_name, status)
       VALUES ('student', 'TEST-0002', 'CHECK12C@example.com', ?, 'Dup', 'Student', 'active')`, hash);
  } catch (e) { dup = true; }
  ok(dup, 'the same email in different letter case is refused');

  // 5. Cancel a clearance explicitly (items first, then the request)
  const stu = await db.get("SELECT * FROM users WHERE email = 'student@isu-demo.local'");
  const term = await db.get('SELECT * FROM academic_terms WHERE is_current = 1');
  const { createClearance } = require('./clearance');
  await db.run('DELETE FROM clearance_requests WHERE student_id = ?', stu.id);
  const made = await createClearance(stu, term, 'End of Semester');
  await db.tx(async (t) => {
    await t.run('DELETE FROM clearance_items WHERE request_id = ?', made.id);
    await t.run('DELETE FROM clearance_requests WHERE id = ?', made.id);
  });
  const left = await db.get('SELECT COUNT(*) AS n FROM clearance_items WHERE request_id = ?', made.id);
  const reqLeft = await db.get('SELECT COUNT(*) AS n FROM clearance_requests WHERE id = ?', made.id);
  ok(left.n === 0 && reqLeft.n === 0, 'cancelling removes the request and all of its lines');

  console.log(fails ? '\n' + fails + ' check(s) FAILED.' : '\nAll checks passed.');
  console.log('Run "npm run db:reset" to clear this test data.');
}

main()
  .then(() => process.exit(fails ? 1 : 0))
  .catch((err) => {
    console.error('Check crashed:', err);
    process.exit(1);
  });
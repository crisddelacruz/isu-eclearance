require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const data = require('../config/seed-data');
const baseStatements = require('../config/seed-base');

// Children first, so foreign keys never complain.
const DROP_ORDER = [
  'audit_logs', 'notifications', 'clearance_items', 'clearance_requests', 'enrollments',
  'password_resets', 'signatures', 'users', 'academic_terms', 'settings', 'offices', 'programs', 'colleges',
];

const USER_SQL = `
  INSERT OR IGNORE INTO users
    (role, id_number, email, password_hash, first_name, middle_name, last_name,
     college_id, program_id, year_level, office_id, position_title, status)
  VALUES
    (?, ?, ?, ?, ?, ?, ?,
     (SELECT id FROM colleges WHERE code = ?), (SELECT id FROM programs WHERE code = ?),
     ?, (SELECT id FROM offices WHERE code = ?), ?, 'active')`;

async function main() {
  if (process.argv.includes('--reset')) {
    if (!db.isFile) throw new Error('--reset only works on a local file database. It is blocked on Turso on purpose.');
    for (const t of DROP_ORDER) await db.exec('DROP TABLE IF EXISTS ' + t);
    console.log('• Old tables deleted.');
  }
  await db.initSchema();

  const S = baseStatements();
  const add = (sql, args) => S.push({ sql, args });
  const adminHash = bcrypt.hashSync(data.ADMIN_PASSWORD, 10);
  const demoHash = bcrypt.hashSync(data.DEMO_PASSWORD, 10);

  const a = data.demoAdmin;
  add(USER_SQL, ['admin', a.id_number, a.email, adminHash, a.first_name, null, a.last_name,
    null, null, null, null, a.position]);

  data.demoSignatories.forEach((s) =>
    add(USER_SQL, ['signatory', s.id_number, s.email, demoHash, s.first_name, null, s.last_name,
      s.college || null, s.program || null, null, s.office || null, s.position])
  );

  const st = data.demoStudent;
  add(USER_SQL, ['student', st.id_number, st.email, demoHash, st.first_name, st.middle_name || null, st.last_name,
    st.college || null, st.program || null, st.year_level, null, null]);

  data.demoSubjects.forEach(([code, title, instructorEmail]) =>
    add(
      `INSERT OR IGNORE INTO enrollments (student_id, term_id, subject_code, subject_title, instructor_id)
       VALUES ((SELECT id FROM users WHERE email = ?), (SELECT id FROM academic_terms WHERE is_current = 1), ?, ?,
               (SELECT id FROM users WHERE email = ?))`,
      [st.email, code, title, instructorEmail]
    )
  );

  await db.batch(S);

  console.log('✔ Database ready (' + (db.isFile ? db.url : 'Turso') + ').');
  console.log('✔ Colleges, programs, offices, term, settings and demo accounts seeded.');
  console.log('');
  console.log('Demo logins (for testing only):');
  console.log('  Admin   : admin@isu-demo.local     /', data.ADMIN_PASSWORD);
  console.log('  Student : student@isu-demo.local   /', data.DEMO_PASSWORD);
  console.log('  Library : library@isu-demo.local   /', data.DEMO_PASSWORD);
  console.log('  (all other demo signatories also use', data.DEMO_PASSWORD + ')');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
  });
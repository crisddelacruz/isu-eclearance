require('dotenv').config();
const db = require('../config/database');

const tables = [
  'colleges', 'programs', 'offices', 'users', 'academic_terms', 'enrollments',
  'clearance_requests', 'clearance_items', 'notifications', 'audit_logs', 'settings',
  'signatures', 'password_resets',
];

async function main() {
  console.log('\nDatabase:', db.isFile ? 'local file (' + db.url + ')' : 'Turso (remote)');

  console.log('\n=== TABLE ROW COUNTS ===');
  for (const t of tables) {
    const r = await db.get('SELECT COUNT(*) AS n FROM ' + t);
    console.log(t.padEnd(20), r.n);
  }

  console.log('\n=== OFFICES (signing order) ===');
  const offices = await db.all('SELECT sort_order, code, scope, name FROM offices ORDER BY sort_order');
  offices.forEach((o) => console.log(String(o.sort_order).padStart(2) + '. ' + o.code.padEnd(7) + ' [' + o.scope + '] ' + o.name));

  console.log('\n=== USERS BY ROLE ===');
  const roles = await db.all('SELECT role, COUNT(*) AS n FROM users GROUP BY role');
  roles.forEach((r) => console.log(r.role.padEnd(10), r.n));

  const fk = await db.all('PRAGMA foreign_key_check');
  console.log('\nForeign key problems:', fk.length === 0 ? 'none ✔' : fk);
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Check failed:', err.message);
    process.exit(1);
  });
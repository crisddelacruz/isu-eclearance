const db = require('../config/database');

const tables = [
  'colleges', 'programs', 'offices', 'users', 'academic_terms', 'enrollments',
  'clearance_requests', 'clearance_items', 'notifications', 'audit_logs', 'settings',
];

console.log('\n=== TABLE ROW COUNTS ===');
tables.forEach((t) => {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get();
  console.log(`${t.padEnd(20)} ${n}`);
});

console.log('\n=== PROGRAMS PER COLLEGE ===');
db.prepare(`
  SELECT c.code, c.dean_name, COUNT(p.id) AS programs
  FROM colleges c LEFT JOIN programs p ON p.college_id = c.id
  GROUP BY c.id ORDER BY c.id
`).all().forEach((r) => {
  console.log(`${r.code.padEnd(8)} ${String(r.programs).padStart(2)} program(s)   Dean: ${r.dean_name}`);
});

console.log('\n=== OFFICES (signing order) ===');
db.prepare('SELECT sort_order, code, scope, name FROM offices ORDER BY sort_order').all()
  .forEach((o) => console.log(`${String(o.sort_order).padStart(2)}. ${o.code.padEnd(7)} [${o.scope}] ${o.name}`));

console.log('\n=== USERS BY ROLE ===');
db.prepare('SELECT role, COUNT(*) AS n FROM users GROUP BY role').all()
  .forEach((r) => console.log(`${r.role.padEnd(10)} ${r.n}`));

const fkProblems = db.pragma('foreign_key_check');
console.log('\nForeign key problems:', fkProblems.length === 0 ? 'none ✔' : fkProblems);
console.log('');
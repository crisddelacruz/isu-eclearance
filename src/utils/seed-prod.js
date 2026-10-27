require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const data = require('../config/seed-data');
const pw = require('./password');

// Usage: npm run seed:prod -- admin@isu.edu.ph "First name" "Last name"
const [email, first, last] = process.argv.slice(2);
if (!email || !first || !last || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.log('Usage: npm run seed:prod -- admin@isu.edu.ph "First name" "Last name"');
  process.exit(1);
}

const idOf = (table, code) => {
  const row = db.prepare(`SELECT id FROM ${table} WHERE code = ?`).get(code);
  return row ? row.id : null;
};

const temp = pw.generateTemp();
let created = false;

db.transaction(() => {
  const insCollege = db.prepare('INSERT OR IGNORE INTO colleges (code, name, dean_name, email) VALUES (?, ?, ?, ?)');
  data.colleges.forEach((c) => insCollege.run(c.code, c.name, c.dean, c.email));

  const insProgram = db.prepare('INSERT OR IGNORE INTO programs (college_id, code, name) VALUES (?, ?, ?)');
  data.programs.forEach(([code, name, college]) => insProgram.run(idOf('colleges', college), code, name));

  const insOffice = db.prepare('INSERT OR IGNORE INTO offices (code, name, description, scope, sort_order) VALUES (?, ?, ?, ?, ?)');
  data.offices.forEach((o) => insOffice.run(o.code, o.name, o.desc, o.scope, o.sort));

  const insTerm = db.prepare(
    'INSERT OR IGNORE INTO academic_terms (school_year, semester, clearance_open_date, clearance_deadline, is_current) VALUES (?, ?, ?, ?, ?)'
  );
  data.terms.forEach((t) => insTerm.run(t.school_year, t.semester, t.open, t.deadline, t.current));

  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(data.settings).forEach(([k, v]) => insSetting.run(k, v));

  if (!db.prepare('SELECT 1 FROM users WHERE email = ?').get(email.toLowerCase())) {
    db.prepare(`
      INSERT INTO users (role, email, password_hash, first_name, last_name, position_title, status, must_change_password)
      VALUES ('admin', ?, ?, ?, ?, 'System Administrator', 'active', 1)
    `).run(email.toLowerCase(), bcrypt.hashSync(temp, 10), first, last);
    created = true;
  }
})();

console.log('✔ Colleges, programs, offices, term, and settings are ready.');
if (created) {
  console.log('✔ Admin account created.');
  console.log('  Email             :', email.toLowerCase());
  console.log('  Temporary password:', temp);
  console.log('  Copy it now. It is shown only once, and you must change it at first login.');
} else {
  console.log('• An account with that email already exists, so no new admin was created.');
}
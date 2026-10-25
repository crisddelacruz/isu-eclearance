require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// "npm run db:reset" deletes the old database first
if (process.argv.includes('--reset')) {
  const dbFile = path.resolve(__dirname, '../..', process.env.DB_PATH || 'data/isu-eclearance.db');
  for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm', dbFile + '-journal']) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  console.log('• Old database deleted.');
}

const db = require('../config/database');
const data = require('../config/seed-data');

const idOf = (table, code) => {
  if (!code) return null;
  const row = db.prepare(`SELECT id FROM ${table} WHERE code = ?`).get(code);
  return row ? row.id : null;
};

const seed = db.transaction(() => {
  // ---- Colleges ----
  const insCollege = db.prepare(
    'INSERT OR IGNORE INTO colleges (code, name, dean_name, email) VALUES (?, ?, ?, ?)'
  );
  data.colleges.forEach((c) => insCollege.run(c.code, c.name, c.dean, c.email));

  // ---- Programs ----
  const insProgram = db.prepare(
    'INSERT OR IGNORE INTO programs (college_id, code, name) VALUES (?, ?, ?)'
  );
  data.programs.forEach(([code, name, collegeCode]) => {
    insProgram.run(idOf('colleges', collegeCode), code, name);
  });

  // ---- Offices ----
  const insOffice = db.prepare(
    'INSERT OR IGNORE INTO offices (code, name, description, scope, sort_order) VALUES (?, ?, ?, ?, ?)'
  );
  data.offices.forEach((o) => insOffice.run(o.code, o.name, o.desc, o.scope, o.sort));

  // ---- Academic terms ----
  const insTerm = db.prepare(
    `INSERT OR IGNORE INTO academic_terms
     (school_year, semester, clearance_open_date, clearance_deadline, is_current)
     VALUES (?, ?, ?, ?, ?)`
  );
  data.terms.forEach((t) => insTerm.run(t.school_year, t.semester, t.open, t.deadline, t.current));

  // ---- Settings ----
  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(data.settings).forEach(([k, v]) => insSetting.run(k, v));

  // ---- Demo users ----
  const insUser = db.prepare(`
    INSERT OR IGNORE INTO users
      (role, id_number, email, password_hash, first_name, middle_name, last_name,
       college_id, program_id, year_level, office_id, position_title, status)
    VALUES
      (@role, @id_number, @email, @password_hash, @first_name, @middle_name, @last_name,
       @college_id, @program_id, @year_level, @office_id, @position_title, 'active')
  `);

  const adminHash = bcrypt.hashSync(data.ADMIN_PASSWORD, 10);
  const demoHash = bcrypt.hashSync(data.DEMO_PASSWORD, 10);

  const a = data.demoAdmin;
  insUser.run({
    role: 'admin', id_number: a.id_number, email: a.email, password_hash: adminHash,
    first_name: a.first_name, middle_name: null, last_name: a.last_name,
    college_id: null, program_id: null, year_level: null, office_id: null,
    position_title: a.position,
  });

  data.demoSignatories.forEach((s) => {
    insUser.run({
      role: 'signatory', id_number: s.id_number, email: s.email, password_hash: demoHash,
      first_name: s.first_name, middle_name: null, last_name: s.last_name,
      college_id: idOf('colleges', s.college), program_id: idOf('programs', s.program),
      year_level: null, office_id: idOf('offices', s.office), position_title: s.position,
    });
  });

  const st = data.demoStudent;
  insUser.run({
    role: 'student', id_number: st.id_number, email: st.email, password_hash: demoHash,
    first_name: st.first_name, middle_name: st.middle_name, last_name: st.last_name,
    college_id: idOf('colleges', st.college), program_id: idOf('programs', st.program),
    year_level: st.year_level, office_id: null, position_title: null,
  });

  // ---- Demo enrollments ----
  const studentId = db.prepare('SELECT id FROM users WHERE email = ?').get(st.email).id;
  const termId = db.prepare('SELECT id FROM academic_terms WHERE is_current = 1').get().id;
  const insEnroll = db.prepare(`
    INSERT OR IGNORE INTO enrollments (student_id, term_id, subject_code, subject_title, instructor_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  data.demoSubjects.forEach(([code, title, instructorEmail]) => {
    const inst = db.prepare('SELECT id FROM users WHERE email = ?').get(instructorEmail);
    insEnroll.run(studentId, termId, code, title, inst ? inst.id : null);
  });
});

seed();

console.log('✔ Database ready at:', db.dbPath);
console.log('✔ Colleges, programs, offices, term, settings and demo accounts seeded.');
console.log('');
console.log('Demo logins (for testing only):');
console.log('  Admin   : admin@isu-demo.local     /', data.ADMIN_PASSWORD);
console.log('  Student : student@isu-demo.local   /', data.DEMO_PASSWORD);
console.log('  Library : library@isu-demo.local   /', data.DEMO_PASSWORD);
console.log('  (all other demo signatories also use', data.DEMO_PASSWORD + ')');
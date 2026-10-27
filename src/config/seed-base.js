const data = require('./seed-data');

// Colleges, programs, offices, the term, and settings as a list of statements.
module.exports = function baseStatements() {
  const S = [];
  const add = (sql, args) => S.push({ sql, args });

  data.colleges.forEach((c) =>
    add('INSERT OR IGNORE INTO colleges (code, name, dean_name, email) VALUES (?, ?, ?, ?)',
      [c.code, c.name, c.dean, c.email])
  );
  data.programs.forEach(([code, name, college]) =>
    add('INSERT OR IGNORE INTO programs (college_id, code, name) VALUES ((SELECT id FROM colleges WHERE code = ?), ?, ?)',
      [college, code, name])
  );
  data.offices.forEach((o) =>
    add('INSERT OR IGNORE INTO offices (code, name, description, scope, sort_order) VALUES (?, ?, ?, ?, ?)',
      [o.code, o.name, o.desc, o.scope, o.sort])
  );
  data.terms.forEach((t) =>
    add(`INSERT OR IGNORE INTO academic_terms
         (school_year, semester, clearance_open_date, clearance_deadline, is_current) VALUES (?, ?, ?, ?, ?)`,
      [t.school_year, t.semester, t.open, t.deadline, t.current])
  );
  Object.entries(data.settings).forEach(([k, v]) =>
    add('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [k, v])
  );
  return S;
};
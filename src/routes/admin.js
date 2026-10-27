const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('../config/database');
const audit = require('../utils/audit');
const sig = require('../utils/signature');
const csv = require('../utils/csv');
const pw = require('../utils/password');
const { getCurrentTerm } = require('../utils/clearance');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('admin')); // every page below is for administrators only

const ROLES = ['student', 'signatory', 'admin'];
const SEMESTERS = ['1st Semester', '2nd Semester', 'Summer'];
const DEMO_LIKE = '%@isu-demo.local';
const NOW = "datetime('now','+8 hours')";

// ---------- small helpers ----------
const one = (sql, ...p) => db.get(sql, ...p);
const all = (sql, ...p) => db.all(sql, ...p);
const trim = (x, n) => String(x == null ? '' : x).trim().slice(0, n || 200);
const int = (x) => parseInt(x, 10) || null;

const notFound = (res) =>
  res.status(404).render('error', {
    title: 'Not found', code: 404, heading: 'Not found',
    message: 'We could not find what you were looking for.',
  });

async function lookups() {
  const [colleges, programs, offices] = await Promise.all([
    all('SELECT id, code, name FROM colleges WHERE is_active = 1 ORDER BY name'),
    all('SELECT id, college_id, code, name FROM programs WHERE is_active = 1 ORDER BY name'),
    all('SELECT id, code, name, scope FROM offices WHERE is_active = 1 ORDER BY sort_order'),
  ]);
  return { colleges, programs, offices };
}

function paging(req, total, per) {
  const pages = Math.max(1, Math.ceil(total / per));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), pages);
  return { page, pages, offset: (page - 1) * per };
}

// Keeps the filters when moving between pages
function qsWithout(req, key) {
  const p = new URLSearchParams();
  Object.entries(req.query).forEach(([k, v]) => {
    if (k !== key && typeof v === 'string' && v !== '') p.set(k, v);
  });
  return p.toString();
}

const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

// ======================================================================
// DASHBOARD
// ======================================================================
router.get('/dashboard', async (req, res) => {
  const term = await getCurrentTerm();
  const termId = term ? term.id : -1;

  const [students, signatories, disabled, reqStats, colleges, bottlenecks,
    noSignature, officesNoSignatory, demo, activity] = await Promise.all([
    one("SELECT COUNT(*) AS n FROM users WHERE role = 'student' AND status = 'active'"),
    one("SELECT COUNT(*) AS n FROM users WHERE role = 'signatory' AND status = 'active'"),
    one("SELECT COUNT(*) AS n FROM users WHERE status = 'disabled'"),
    one(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(status = 'in_progress'), 0) AS in_progress,
              COALESCE(SUM(status = 'completed'), 0) AS completed
       FROM clearance_requests WHERE term_id = ?`, termId),
    all(
      `SELECT c.code, c.name,
              COUNT(r.id) AS total,
              COALESCE(SUM(r.status = 'completed'), 0) AS completed
       FROM colleges c
       LEFT JOIN users s ON s.college_id = c.id AND s.role = 'student'
       LEFT JOIN clearance_requests r ON r.student_id = s.id AND r.term_id = ?
       WHERE c.is_active = 1
       GROUP BY c.id ORDER BY c.name`, termId),
    all(
      `SELECT o.name, COUNT(*) AS n
       FROM clearance_items ci
       JOIN clearance_requests r ON r.id = ci.request_id
       JOIN offices o ON o.id = ci.office_id
       WHERE r.term_id = ? AND r.status = 'in_progress' AND ci.status = 'pending'
       GROUP BY o.id ORDER BY n DESC, o.sort_order LIMIT 6`, termId),
    one("SELECT COUNT(*) AS n FROM users WHERE role = 'signatory' AND status = 'active' AND signature_path IS NULL"),
    all(
      `SELECT o.name FROM offices o
       WHERE o.is_active = 1 AND NOT EXISTS (
         SELECT 1 FROM users u WHERE u.role = 'signatory' AND u.status = 'active' AND u.office_id = o.id)
       ORDER BY o.sort_order`),
    one('SELECT COUNT(*) AS n FROM users WHERE email LIKE ?', DEMO_LIKE),
    all(
      `SELECT a.action, a.details, a.created_at, u.first_name, u.last_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.id DESC LIMIT 8`),
  ]);

  res.render('admin/dashboard', {
    title: 'Admin Dashboard', active: 'dashboard',
    term,
    counts: { students: students.n, signatories: signatories.n, disabled: disabled.n },
    reqStats, colleges, bottlenecks,
    alerts: { noSignature: noSignature.n, officesNoSignatory, demo: demo.n },
    activity,
  });
});

// ======================================================================
// USERS
// ======================================================================
function readForm(b, role) {
  return {
    role,
    id_number: trim(b.id_number, 40),
    email: trim(b.email, 150).toLowerCase(),
    first_name: trim(b.first_name, 100),
    middle_name: trim(b.middle_name, 100),
    last_name: trim(b.last_name, 100),
    suffix: trim(b.suffix, 30),
    college_id: int(b.college_id),
    program_id: int(b.program_id),
    year_level: int(b.year_level),
    office_id: int(b.office_id),
    position_title: trim(b.position_title, 150),
  };
}

// Small lookup tables (colleges, programs, offices). For CSV import it also
// holds every existing email and ID number, so no query is needed per row.
async function makeCtx(withUsers) {
  const [c, p, o] = await Promise.all([
    all('SELECT id FROM colleges'),
    all('SELECT id, college_id FROM programs'),
    all('SELECT id, scope FROM offices'),
  ]);
  const ctx = {
    colleges: new Map(c.map((x) => [x.id, x])),
    programs: new Map(p.map((x) => [x.id, x])),
    offices: new Map(o.map((x) => [x.id, x])),
  };
  if (withUsers) {
    const u = await all('SELECT email, id_number FROM users');
    ctx.emails = new Set(u.map((x) => String(x.email).toLowerCase()));
    ctx.ids = new Set(u.filter((x) => x.id_number).map((x) => String(x.id_number).toLowerCase()));
  }
  return ctx;
}

async function emailTaken(ctx, email, me) {
  if (ctx.emails) return ctx.emails.has(email);
  return !!(await one('SELECT 1 AS x FROM users WHERE email = ? AND id != ?', email, me));
}
async function idTaken(ctx, idn, me) {
  if (ctx.ids) return ctx.ids.has(idn.toLowerCase());
  return !!(await one('SELECT 1 AS x FROM users WHERE lower(id_number) = lower(?) AND id != ?', idn, me));
}

// Returns an object of error messages (empty object = valid).
async function checkUser(v, selfId, ctx) {
  const e = {};
  const me = selfId || 0;
  if (!ROLES.includes(v.role)) e.role = 'Choose a role.';

  if (v.id_number) {
    if (!/^[A-Za-z0-9-]{4,20}$/.test(v.id_number)) e.id_number = 'Use 4 to 20 characters: letters, numbers, and dashes.';
    else if (await idTaken(ctx, v.id_number, me)) e.id_number = 'This ID number is already used.';
  } else if (v.role === 'student') {
    e.id_number = 'Student ID number is required.';
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) || v.email.length > 120) e.email = 'Enter a valid email address.';
  else if (await emailTaken(ctx, v.email, me)) e.email = 'This email is already used.';

  if (!v.first_name) e.first_name = 'First name is required.';
  else if (v.first_name.length > 60) e.first_name = 'First name is too long.';
  if (!v.last_name) e.last_name = 'Last name is required.';
  else if (v.last_name.length > 60) e.last_name = 'Last name is too long.';
  if (v.middle_name.length > 60) e.middle_name = 'Middle name is too long.';
  if (v.suffix.length > 10) e.suffix = 'Suffix is too long.';

  const college = v.college_id ? ctx.colleges.get(v.college_id) : null;
  const program = v.program_id ? ctx.programs.get(v.program_id) : null;
  if (v.college_id && !college) e.college_id = 'Unknown college.';
  if (v.program_id && !program) e.program_id = 'Unknown program.';
  else if (program && college && program.college_id !== college.id) e.program_id = 'That program does not belong to the selected college.';

  if (v.role === 'student') {
    if (!college) e.college_id = e.college_id || 'Select a college.';
    if (!program) e.program_id = e.program_id || 'Select a program.';
    if (!(v.year_level >= 1 && v.year_level <= 6)) e.year_level = 'Select a year level.';
  }

  if (v.role === 'signatory') {
    const office = v.office_id ? ctx.offices.get(v.office_id) : null;
    if (!office) {
      e.office_id = 'Select an office.';
    } else {
      if (office.scope === 'college' && !college) e.college_id = e.college_id || 'This office needs a college.';
      if (office.scope === 'program') {
        if (!college) e.college_id = e.college_id || 'This office needs a college.';
        if (!program) e.program_id = e.program_id || 'This office needs a program.';
      }
    }
    if (v.position_title.length > 100) e.position_title = 'Position is too long.';
  }
  return e;
}

// Clears fields that do not apply to the role. Only call after checkUser passed.
function normalize(v, ctx) {
  const n = {
    ...v,
    id_number: v.id_number || null,
    middle_name: v.middle_name || null,
    suffix: v.suffix || null,
    position_title: v.position_title || null,
  };
  if (v.role === 'admin') {
    n.college_id = n.program_id = n.year_level = n.office_id = null;
  } else if (v.role === 'student') {
    n.office_id = null;
    n.position_title = null;
  } else if (v.role === 'signatory') {
    n.year_level = null;
    const office = ctx.offices.get(v.office_id);
    if (office.scope === 'university') { n.college_id = null; n.program_id = null; }
    else if (office.scope !== 'program') n.program_id = null;
  }
  return n;
}

const cols = (n) => ({
  id_number: n.id_number, email: n.email, first_name: n.first_name, middle_name: n.middle_name,
  last_name: n.last_name, suffix: n.suffix, college_id: n.college_id, program_id: n.program_id,
  year_level: n.year_level, office_id: n.office_id, position_title: n.position_title,
});

const INSERT_USER = `
  INSERT INTO users
    (role, id_number, email, password_hash, first_name, middle_name, last_name, suffix,
     college_id, program_id, year_level, office_id, position_title, status, must_change_password)
  VALUES
    (@role, @id_number, @email, @password_hash, @first_name, @middle_name, @last_name, @suffix,
     @college_id, @program_id, @year_level, @office_id, @position_title, 'active', 1)`;

const UPDATE_USER = `
  UPDATE users SET
    id_number = @id_number, email = @email, first_name = @first_name, middle_name = @middle_name,
    last_name = @last_name, suffix = @suffix, college_id = @college_id, program_id = @program_id,
    year_level = @year_level, office_id = @office_id, position_title = @position_title,
    updated_at = ${NOW}
  WHERE id = @id`;

// ---------- list ----------
router.get('/users', async (req, res) => {
  const q = trim(req.query.q, 60);
  const role = ROLES.includes(req.query.role) ? req.query.role : '';
  const status = ['active', 'disabled'].includes(req.query.status) ? req.query.status : '';
  const college = parseInt(req.query.college, 10) || 0;

  const where = ['1 = 1'];
  const prm = {};
  if (q) {
    where.push('(u.first_name LIKE @q OR u.last_name LIKE @q OR u.email LIKE @q OR u.id_number LIKE @q)');
    prm.q = '%' + q + '%';
  }
  if (role) { where.push('u.role = @role'); prm.role = role; }
  if (status) { where.push('u.status = @status'); prm.status = status; }
  if (college) { where.push('u.college_id = @college'); prm.college = college; }
  const W = where.join(' AND ');

  const total = (await db.get(`SELECT COUNT(*) AS n FROM users u WHERE ${W}`, prm)).n;
  const pg = paging(req, total, 20);
  const rows = await db.all(
    `SELECT u.id, u.role, u.id_number, u.email, u.first_name, u.last_name, u.status,
            u.last_login_at, u.must_change_password,
            c.code AS college_code, p.code AS program_code, o.name AS office_name
     FROM users u
     LEFT JOIN colleges c ON c.id = u.college_id
     LEFT JOIN programs p ON p.id = u.program_id
     LEFT JOIN offices o ON o.id = u.office_id
     WHERE ${W}
     ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'signatory' THEN 1 ELSE 2 END, u.last_name, u.first_name
     LIMIT @lim OFFSET @off`,
    { ...prm, lim: 20, off: pg.offset }
  );

  res.render('admin/users', {
    title: 'Users', active: 'users',
    rows, total, q, role, status, college,
    page: pg.page, pages: pg.pages, qs: qsWithout(req, 'page'),
    colleges: await all('SELECT id, code FROM colleges ORDER BY code'),
  });
});

// ---------- import from CSV (must come before /users/:id) ----------
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/\.csv$/i.test(file.originalname || '')) return cb(null, true);
    cb(new Error('Please choose a .csv file.'));
  },
});

const IMPORT_HEADERS = [
  'role', 'id_number', 'email', 'first_name', 'middle_name', 'last_name', 'suffix',
  'college_code', 'program_code', 'year_level', 'office_code', 'position_title',
];
const IMPORT_MAX = 300; // one batch must finish inside the serverless time limit

router.get('/users/import/template.csv', (req, res) => {
  const text = csv.toCsv(IMPORT_HEADERS, [
    ['student', '2026-10001', 'maria.santos@example.com', 'Maria', 'Lopez', 'Santos', '', 'CCSICT', 'BSIT', '2', '', ''],
    ['signatory', 'EMP-2001', 'juan.reyes@isu.edu.ph', 'Juan', '', 'Reyes', '', 'CCSICT', '', '', 'INSTR', 'Instructor I'],
  ]);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="isu-users-template.csv"' });
  res.send(text);
});

router.get('/users/import', async (req, res) => {
  res.render('admin/user-import', { title: 'Import Users', active: 'users', result: null, ...(await lookups()) });
});

router.post('/users/import', (req, res, next) => {
  csvUpload.single('file')(req, res, (err) => {
    if (err) {
      req.flash('error', err.code === 'LIMIT_FILE_SIZE' ? 'The file is too large (512 KB maximum).' : err.message);
      return res.redirect('/admin/users/import');
    }
    next();
  });
}, async (req, res) => {
  const back = (msg) => { req.flash('error', msg); return res.redirect('/admin/users/import'); };
  if (!req.file) return back('Please choose a CSV file.');

  const password = String(req.body.default_password || '');
  const problem = pw.check(password);
  if (problem) return back('Starting password: ' + problem);

  const rows = csv.parse(req.file.buffer.toString('utf8'));
  if (rows.length < 2) return back('The file has no data rows.');
  if (rows.length > IMPORT_MAX + 1) return back('The file has more than ' + IMPORT_MAX + ' rows. Please split it into smaller files.');

  const header = rows.shift().map((h) => h.trim().toLowerCase());
  const missing = ['role', 'email', 'first_name', 'last_name'].filter((h) => !header.includes(h));
  if (missing.length) return back('The file is missing these columns: ' + missing.join(', ') + '. Download the template to see the right format.');

  const [collegeRows, programRows, officeRows, ctx] = await Promise.all([
    all('SELECT id, code FROM colleges'),
    all('SELECT id, code FROM programs'),
    all('SELECT id, code FROM offices'),
    makeCtx(true),
  ]);
  const colleges = {}; collegeRows.forEach((c) => { colleges[c.code.toUpperCase()] = c.id; });
  const programs = {}; programRows.forEach((p) => { programs[p.code.toUpperCase()] = p.id; });
  const offices = {}; officeRows.forEach((o) => { offices[o.code.toUpperCase()] = o.id; });

  const hash = await bcrypt.hash(password, 10); // everyone must change it at first login
  const result = { created: 0, skipped: [] };
  const statements = [];

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i];
    const line = i + 2;
    const get = (name) => trim(cells[header.indexOf(name)] || '', 200);
    const who = (get('first_name') + ' ' + get('last_name')).trim() || get('email') || '(blank)';
    const skip = (msg) => { if (result.skipped.length < 100) result.skipped.push({ line, who, msg }); };

    const role = get('role').toLowerCase();
    if (role === 'admin') { skip('Admin accounts must be created one by one.'); continue; }
    if (!ROLES.includes(role)) { skip('Role must be student or signatory.'); continue; }

    const v = readForm({
      id_number: get('id_number'), email: get('email'), first_name: get('first_name'),
      middle_name: get('middle_name'), last_name: get('last_name'), suffix: get('suffix'),
      year_level: get('year_level'), position_title: get('position_title'),
    }, role);

    const codeErrors = [];
    const lookup = (col, map, label) => {
      const code = get(col).toUpperCase();
      if (!code) return null;
      if (!map[code]) { codeErrors.push('Unknown ' + label + ' code "' + code + '".'); return null; }
      return map[code];
    };
    v.college_id = lookup('college_code', colleges, 'college');
    v.program_id = lookup('program_code', programs, 'program');
    v.office_id = lookup('office_code', offices, 'office');
    if (codeErrors.length) { skip(codeErrors.join(' ')); continue; }

    const errors = await checkUser(v, 0, ctx);
    if (Object.keys(errors).length) { skip(Object.values(errors).join(' ')); continue; }

    const n = normalize(v, ctx);
    statements.push({ sql: INSERT_USER, args: { role: n.role, password_hash: hash, ...cols(n) } });
    ctx.emails.add(n.email); // catches duplicates inside the same file
    if (n.id_number) ctx.ids.add(n.id_number.toLowerCase());
    result.created++;
  }

  if (statements.length) await db.batch(statements); // all valid rows in ONE round trip

  result.skippedTotal = rows.length - result.created;
  await audit(req, 'USER_IMPORT', result.created + ' created, ' + result.skippedTotal + ' skipped');
  res.render('admin/user-import', { title: 'Import Users', active: 'users', result, ...(await lookups()) });
});

// ---------- create ----------
router.get('/users/new', async (req, res) => {
  const role = ROLES.includes(req.query.role) ? req.query.role : 'signatory';
  res.render('admin/user-form', {
    title: 'Add User', active: 'users', isEdit: false, userRow: null,
    values: { role, college_id: '', program_id: '', year_level: '', office_id: '' }, errors: {}, ...(await lookups()),
  });
});

router.post('/users', async (req, res) => {
  const role = ROLES.includes(req.body.role) ? req.body.role : '';
  const v = readForm(req.body, role);
  const ctx = await makeCtx(false);
  const errors = await checkUser(v, 0, ctx);

  let temp = String(req.body.password || '');
  let generated = false;
  if (!temp) { temp = pw.generateTemp(); generated = true; }
  else {
    const problem = pw.check(temp);
    if (problem) errors.password = problem;
  }

  if (Object.keys(errors).length) {
    return res.status(422).render('admin/user-form', {
      title: 'Add User', active: 'users', isEdit: false, userRow: null, values: v, errors, ...(await lookups()),
    });
  }

  const n = normalize(v, ctx);
  const info = await db.run(INSERT_USER, { role: n.role, password_hash: await bcrypt.hash(temp, 10), ...cols(n) });
  await audit(req, 'USER_CREATE', n.role + ' #' + info.lastId + ' ' + n.email);
  req.flash(
    'success',
    'Account created for ' + n.first_name + ' ' + n.last_name + '. ' +
      (generated
        ? 'Temporary password: ' + temp + ' (copy it now, it is shown only once). The user must change it at first login.'
        : 'The user must change the password at first login.')
  );
  res.redirect('/admin/users');
});

// ---------- edit ----------
router.get('/users/:id/edit', async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id = ?', parseInt(req.params.id, 10) || 0);
  if (!u) return notFound(res);
  res.render('admin/user-form', {
    title: 'Edit User', active: 'users', isEdit: true, userRow: u,
    values: {
      role: u.role, id_number: u.id_number || '', email: u.email, first_name: u.first_name,
      middle_name: u.middle_name || '', last_name: u.last_name, suffix: u.suffix || '',
      college_id: u.college_id || '', program_id: u.program_id || '', year_level: u.year_level || '',
      office_id: u.office_id || '', position_title: u.position_title || '',
    },
    errors: {}, ...(await lookups()),
  });
});

router.post('/users/:id', async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id = ?', parseInt(req.params.id, 10) || 0);
  if (!u) return notFound(res);

  const v = readForm(req.body, u.role); // the role never changes
  const ctx = await makeCtx(false);
  const errors = await checkUser(v, u.id, ctx);
  if (Object.keys(errors).length) {
    return res.status(422).render('admin/user-form', {
      title: 'Edit User', active: 'users', isEdit: true, userRow: u, values: v, errors, ...(await lookups()),
    });
  }
  const n = normalize(v, ctx);
  await db.run(UPDATE_USER, { id: u.id, ...cols(n) });
  await audit(req, 'USER_UPDATE', 'User #' + u.id);
  req.flash('success', 'Changes saved.');
  res.redirect('/admin/users');
});

// ---------- disable / enable ----------
router.post('/users/:id/toggle', async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id = ?', parseInt(req.params.id, 10) || 0);
  if (!u) return notFound(res);
  if (u.id === req.user.id) {
    req.flash('error', 'You cannot disable your own account.');
    return res.redirect('/admin/users');
  }
  const next = u.status === 'active' ? 'disabled' : 'active';
  if (next === 'disabled' && u.role === 'admin') {
    const others = (await one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active' AND id != ?", u.id)).n;
    if (!others) {
      req.flash('error', 'You cannot disable the last active administrator.');
      return res.redirect('/admin/users');
    }
  }
  // session_version + 1 signs the user out everywhere right away
  await db.run(
    `UPDATE users SET status = ?, session_version = session_version + 1, updated_at = ${NOW} WHERE id = ?`,
    next, u.id
  );
  await audit(req, next === 'disabled' ? 'USER_DISABLE' : 'USER_ENABLE', 'User #' + u.id);
  req.flash('success', u.first_name + ' ' + u.last_name + (next === 'disabled' ? ' was disabled and can no longer log in.' : ' was enabled.'));
  res.redirect('/admin/users');
});

// ---------- reset password ----------
router.post('/users/:id/reset-password', async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id = ?', parseInt(req.params.id, 10) || 0);
  if (!u) return notFound(res);
  if (u.id === req.user.id) {
    req.flash('error', 'To change your own password, use "Change password" in the top-right menu.');
    return res.redirect('/admin/users');
  }
  const temp = pw.generateTemp();
  await db.run(
    `UPDATE users SET password_hash = ?, must_change_password = 1,
            session_version = session_version + 1, updated_at = ${NOW} WHERE id = ?`,
    await bcrypt.hash(temp, 10), u.id
  );
  await audit(req, 'USER_PASSWORD_RESET', 'User #' + u.id);
  req.flash('success', 'New temporary password for ' + u.first_name + ' ' + u.last_name + ': ' + temp + ' (copy it now, it is shown only once).');
  res.redirect('/admin/users');
});

// ======================================================================
// OFFICES
// ======================================================================
async function checkOffice(v, id, isCreate) {
  const e = {};
  if (isCreate) {
    if (!/^[A-Z0-9]{2,10}$/.test(v.code)) e.code = 'Use 2 to 10 capital letters or numbers, no spaces.';
    else if (await one('SELECT 1 AS x FROM offices WHERE code = ?', v.code)) e.code = 'This code is already used.';
    if (!['university', 'college', 'program'].includes(v.scope)) e.scope = 'Choose who signs for this office.';
  }
  if (v.name.length < 3 || v.name.length > 80) e.name = 'Name must be 3 to 80 characters.';
  else if (await one('SELECT 1 AS x FROM offices WHERE name = ? AND id != ?', v.name, id || 0)) e.name = 'An office with this name already exists.';
  if (v.description.length > 200) e.description = 'Keep the description under 200 characters.';
  if (!(v.sort_order >= 1 && v.sort_order <= 999)) e.sort_order = 'Enter a number from 1 to 999.';
  return e;
}

const officeForm = (b) => ({
  code: trim(b.code, 20).toUpperCase(),
  name: trim(b.name, 100),
  description: trim(b.description, 250),
  scope: trim(b.scope, 20),
  sort_order: parseInt(b.sort_order, 10),
  is_active: b.is_active ? 1 : 0,
});

router.get('/offices', async (req, res) => {
  const rows = await all(`
    SELECT o.*,
      (SELECT COUNT(*) FROM users u WHERE u.office_id = o.id AND u.role = 'signatory' AND u.status = 'active') AS signatories,
      (SELECT COUNT(*) FROM clearance_items ci WHERE ci.office_id = o.id) AS lines
    FROM offices o ORDER BY o.sort_order, o.id
  `);
  res.render('admin/offices', { title: 'Offices', active: 'offices', rows });
});

router.get('/offices/new', async (req, res) => {
  const next = ((await one('SELECT MAX(sort_order) AS m FROM offices')).m || 0) + 1;
  res.render('admin/office-form', {
    title: 'Add Office', active: 'offices', isEdit: false, office: null,
    values: { code: '', name: '', description: '', scope: 'university', sort_order: next, is_active: 1 }, errors: {},
  });
});

router.post('/offices', async (req, res) => {
  const v = officeForm(req.body);
  const errors = await checkOffice(v, 0, true);
  if (Object.keys(errors).length) {
    return res.status(422).render('admin/office-form', {
      title: 'Add Office', active: 'offices', isEdit: false, office: null, values: v, errors,
    });
  }
  await db.run(
    'INSERT INTO offices (code, name, description, scope, sort_order, is_required, is_active) VALUES (?, ?, ?, ?, ?, 1, ?)',
    v.code, v.name, v.description || null, v.scope, v.sort_order, v.is_active
  );
  await audit(req, 'OFFICE_CREATE', v.code);
  req.flash('success', 'Office added. Now create a signatory account for it under Users.');
  res.redirect('/admin/offices');
});

router.get('/offices/:id/edit', async (req, res) => {
  const o = await one('SELECT * FROM offices WHERE id = ?', parseInt(req.params.id, 10) || 0);
  if (!o) return notFound(res);
  res.render('admin/office-form', {
    title: 'Edit Office', active: 'offices', isEdit: true, office: o,
    values: { code: o.code, name: o.name, description: o.description || '', scope: o.scope, sort_order: o.sort_order, is_active: o.is_active },
    errors: {},
  });
});

router.post('/offices/:id', async (req, res) => {
  const o = await one('SELECT * FROM offices WHERE id = ?', parseInt(req.params.id, 10) || 0);
  if (!o) return notFound(res);
  const v = officeForm(req.body);
  v.code = o.code;
  v.scope = o.scope; // code and scope never change
  const errors = await checkOffice(v, o.id, false);
  if (Object.keys(errors).length) {
    return res.status(422).render('admin/office-form', {
      title: 'Edit Office', active: 'offices', isEdit: true, office: o, values: v, errors,
    });
  }
  await db.run(
    'UPDATE offices SET name = ?, description = ?, sort_order = ?, is_active = ? WHERE id = ?',
    v.name, v.description || null, v.sort_order, v.is_active, o.id
  );
  await audit(req, 'OFFICE_UPDATE', o.code);
  req.flash('success', 'Office updated. Changes apply to new clearance requests only.');
  res.redirect('/admin/offices');
});

// ======================================================================
// ACADEMIC TERMS
// ======================================================================
async function termErrors(v, id, isCreate) {
  const e = {};
  if (isCreate) {
    const m = /^(\d{4})-(\d{4})$/.exec(v.school_year);
    if (!m || Number(m[2]) !== Number(m[1]) + 1) e.school_year = 'Use the format 2026-2027 (the second year is one more than the first).';
    if (!SEMESTERS.includes(v.semester)) e.semester = 'Choose a semester.';
    if (!e.school_year && !e.semester &&
        await one('SELECT 1 AS x FROM academic_terms WHERE school_year = ? AND semester = ?', v.school_year, v.semester)) {
      e.semester = 'This term already exists.';
    }
  }
  if (v.open && !validDate(v.open)) e.open = 'Enter a valid date.';
  if (v.deadline && !validDate(v.deadline)) e.deadline = 'Enter a valid date.';
  if (!e.open && !e.deadline && v.open && v.deadline && v.deadline < v.open) e.deadline = 'The deadline must be on or after the open date.';
  return e;
}

const termForm = (b) => ({
  school_year: trim(b.school_year, 9),
  semester: trim(b.semester, 20),
  open: trim(b.clearance_open_date, 10),
  deadline: trim(b.clearance_deadline, 10),
  is_current: b.is_current ? 1 : 0,
});

const makeCurrent = (id) =>
  db.batch([
    { sql: 'UPDATE academic_terms SET is_current = 0', args: [] },
    { sql: 'UPDATE academic_terms SET is_current = 1 WHERE id = ?', args: [id] },
  ]);

router.get('/terms', async (req, res) => {
  const rows = await all(`
    SELECT t.*,
      (SELECT COUNT(*) FROM clearance_requests r WHERE r.term_id = t.id) AS requests,
      (SELECT COUNT(*) FROM clearance_requests r WHERE r.term_id = t.id AND r.status = 'in_progress') AS in_progress
    FROM academic_terms t ORDER BY t.school_year DESC, t.id DESC
  `);
  res.render('admin/terms', { title: 'Academic Terms', active: 'terms', rows });
});

router.get('/terms/new', (req, res) => {
  res.render('admin/term-form', {
    title: 'Add Term', active: 'terms', isEdit: false, term: null, semesters: SEMESTERS,
    values: { school_year: '', semester: '1st Semester', open: '', deadline: '', is_current: 0 }, errors: {},
  });
});

router.post('/terms', async (req, res) => {
  const v = termForm(req.body);
  const errors = await termErrors(v, 0, true);
  if (Object.keys(errors).length) {
    return res.status(422).render('admin/term-form', {
      title: 'Add Term', active: 'terms', isEdit: false, term: null, semesters: SEMESTERS, values: v, errors,
    });
  }
  const info = await db.run(
    'INSERT INTO academic_terms (school_year, semester, clearance_open_date, clearance_deadline, is_current) VALUES (?, ?, ?, ?, 0)',
    v.school_year, v.semester, v.open || null, v.deadline || null
  );
  if (v.is_current) await makeCurrent(info.lastId);
  await audit(req, 'TERM_CREATE', v.school_year + ' ' + v.semester);
  req.flash('success', 'Term added.');
  res.redirect('/admin/terms');
});

router.get('/terms/:id/edit', async (req, res) => {
  const t = await one('SELECT * FROM academic_terms WHERE id = ?', parseInt(req.params.id, 10) || 0);
  if (!t) return notFound(res);
  res.render('admin/term-form', {
    title: 'Edit Term', active: 'terms', isEdit: true, term: t, semesters: SEMESTERS,
    values: { school_year: t.school_year, semester: t.semester, open: t.clearance_open_date || '', deadline: t.clearance_deadline || '', is_current: t.is_current },
    errors: {},
  });
});

router.post('/terms/:id', async (req, res) => {
  const t = await one('SELECT * FROM academic_terms WHERE id = ?', parseInt(req.params.id, 10) || 0);
  if (!t) return notFound(res);
  const v = termForm(req.body);
  v.school_year = t.school_year;
  v.semester = t.semester;
  const errors = await termErrors(v, t.id, false);
  if (Object.keys(errors).length) {
    return res.status(422).render('admin/term-form', {
      title: 'Edit Term', active: 'terms', isEdit: true, term: t, semesters: SEMESTERS, values: v, errors,
    });
  }
  await db.run('UPDATE academic_terms SET clearance_open_date = ?, clearance_deadline = ? WHERE id = ?',
    v.open || null, v.deadline || null, t.id);
  await audit(req, 'TERM_UPDATE', t.school_year + ' ' + t.semester);
  req.flash('success', 'Term dates saved.');
  res.redirect('/admin/terms');
});

router.post('/terms/:id/current', async (req, res) => {
  const t = await one('SELECT * FROM academic_terms WHERE id = ?', parseInt(req.params.id, 10) || 0);
  if (!t) return notFound(res);
  await makeCurrent(t.id);
  await audit(req, 'TERM_SET_CURRENT', t.school_year + ' ' + t.semester);
  req.flash('success', t.school_year + ', ' + t.semester + ' is now the current term.');
  res.redirect('/admin/terms');
});

// ======================================================================
// REPORTS
// ======================================================================
async function reportTerm(req) {
  const terms = await all('SELECT * FROM academic_terms ORDER BY school_year DESC, id DESC');
  const cur = await getCurrentTerm();
  const wanted = parseInt(req.query.term, 10) || (cur ? cur.id : terms[0] ? terms[0].id : 0);
  return { terms, term: terms.find((t) => t.id === wanted) || null };
}

router.get('/reports', async (req, res) => {
  const { terms, term } = await reportTerm(req);
  const id = term ? term.id : -1;

  const [totals, returned, byCollege, byProgram, byOffice] = await Promise.all([
    one(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(status = 'in_progress'), 0) AS in_progress,
              COALESCE(SUM(status = 'completed'), 0) AS completed
       FROM clearance_requests WHERE term_id = ?`, id),
    one(
      `SELECT COUNT(*) AS n FROM clearance_items ci JOIN clearance_requests r ON r.id = ci.request_id
       WHERE r.term_id = ? AND ci.status = 'rejected'`, id),
    all(
      `SELECT c.code, c.name, COUNT(r.id) AS total,
              COALESCE(SUM(r.status = 'in_progress'), 0) AS in_progress,
              COALESCE(SUM(r.status = 'completed'), 0) AS completed
       FROM clearance_requests r
       JOIN users s ON s.id = r.student_id
       JOIN colleges c ON c.id = s.college_id
       WHERE r.term_id = ? GROUP BY c.id ORDER BY c.name`, id),
    all(
      `SELECT p.code, p.name, COUNT(r.id) AS total,
              COALESCE(SUM(r.status = 'in_progress'), 0) AS in_progress,
              COALESCE(SUM(r.status = 'completed'), 0) AS completed
       FROM clearance_requests r
       JOIN users s ON s.id = r.student_id
       JOIN programs p ON p.id = s.program_id
       WHERE r.term_id = ? GROUP BY p.id ORDER BY total DESC, p.name`, id),
    all(
      `SELECT o.name, COUNT(*) AS n
       FROM clearance_items ci
       JOIN clearance_requests r ON r.id = ci.request_id
       JOIN offices o ON o.id = ci.office_id
       WHERE r.term_id = ? AND r.status = 'in_progress' AND ci.status = 'pending'
       GROUP BY o.id ORDER BY n DESC, o.sort_order`, id),
  ]);
  totals.returned = returned.n;

  res.render('admin/reports', {
    title: 'Reports', active: 'reports', terms, term, totals, byCollege, byProgram, byOffice,
  });
});

router.get('/reports/export.csv', async (req, res) => {
  const { term } = await reportTerm(req);
  if (!term) return notFound(res);

  const rows = await all(
    `SELECT r.reference_no, s.id_number, s.last_name, s.first_name, s.middle_name,
            c.code AS college, p.code AS program, s.year_level, r.purpose, r.status,
            (SELECT COUNT(*) FROM clearance_items WHERE request_id = r.id AND status = 'approved') AS approved,
            (SELECT COUNT(*) FROM clearance_items WHERE request_id = r.id) AS total,
            r.created_at, r.completed_at
     FROM clearance_requests r
     JOIN users s ON s.id = r.student_id
     LEFT JOIN colleges c ON c.id = s.college_id
     LEFT JOIN programs p ON p.id = s.program_id
     WHERE r.term_id = ? ORDER BY r.id`, term.id
  );
  const text = csv.toCsv(
    ['Reference no', 'Student ID', 'Last name', 'First name', 'Middle name', 'College', 'Program', 'Year level',
     'Purpose', 'Status', 'Signatures', 'Total offices', 'Requested', 'Completed'],
    rows.map((r) => [r.reference_no, r.id_number, r.last_name, r.first_name, r.middle_name, r.college, r.program,
      r.year_level, r.purpose, r.status, r.approved, r.total, r.created_at, r.completed_at])
  );
  await audit(req, 'REPORT_EXPORT', term.school_year + ' ' + term.semester);
  const file = ('clearance-report-' + term.school_year + '-' + term.semester).replace(/[^A-Za-z0-9-]+/g, '-');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + file + '.csv"' });
  res.send(text);
});

// ======================================================================
// AUDIT LOGS
// ======================================================================
router.get('/audit', async (req, res) => {
  const q = trim(req.query.q, 60);
  const cond = `(@q = '' OR a.action LIKE '%' || @q || '%' OR a.details LIKE '%' || @q || '%' OR u.email LIKE '%' || @q || '%')`;
  const total = (await db.get(
    `SELECT COUNT(*) AS n FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE ${cond}`, { q }
  )).n;
  const pg = paging(req, total, 30);
  const rows = await db.all(
    `SELECT a.*, u.first_name, u.last_name, u.email
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     WHERE ${cond} ORDER BY a.id DESC LIMIT @lim OFFSET @off`,
    { q, lim: 30, off: pg.offset }
  );

  res.render('admin/audit', {
    title: 'Audit Logs', active: 'audit', rows, total, q,
    page: pg.page, pages: pg.pages, qs: qsWithout(req, 'page'),
  });
});

// ======================================================================
// SETTINGS
// ======================================================================
async function readSettings() {
  const s = {};
  (await all('SELECT key, value FROM settings')).forEach((r) => { s[r.key] = r.value; });
  return s;
}
const demoCount = async () => (await one('SELECT COUNT(*) AS n FROM users WHERE email LIKE ?', DEMO_LIKE)).n;

router.get('/settings', async (req, res) => {
  res.render('admin/settings', {
    title: 'Settings', active: 'settings', values: await readSettings(), errors: {}, demoCount: await demoCount(),
  });
});

router.post('/settings', async (req, res) => {
  const v = {
    university_name: trim(req.body.university_name, 120),
    university_address: trim(req.body.university_address, 160),
    clearance_footer: trim(req.body.clearance_footer, 250),
    enforce_term_dates: req.body.enforce_term_dates ? '1' : '0',
  };
  const errors = {};
  if (v.university_name.length < 3) errors.university_name = 'Enter the university name.';
  if (v.university_address.length < 3) errors.university_address = 'Enter the address.';

  if (Object.keys(errors).length) {
    return res.status(422).render('admin/settings', {
      title: 'Settings', active: 'settings', values: { ...(await readSettings()), ...v }, errors,
      demoCount: await demoCount(),
    });
  }
  await db.batch(
    Object.entries(v).map(([k, val]) => ({
      sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      args: [k, val],
    }))
  );
  await audit(req, 'SETTINGS_UPDATE', 'Settings saved');
  req.flash('success', 'Settings saved. They appear on new clearance forms and PDFs.');
  res.redirect('/admin/settings');
});

router.post('/settings/purge-demo', async (req, res) => {
  if (String(req.body.confirm || '').trim() !== 'DELETE DEMO') {
    req.flash('error', 'Type DELETE DEMO exactly to confirm.');
    return res.redirect('/admin/settings');
  }
  const realAdmins = (await one(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active' AND email NOT LIKE ?", DEMO_LIKE
  )).n;
  if (!realAdmins) {
    req.flash('error', 'Create your own administrator account first (Users, Add user). Otherwise you would be locked out.');
    return res.redirect('/admin/settings');
  }

  const files = (await all(
    'SELECT signature_path FROM users WHERE email LIKE ? AND signature_path IS NOT NULL', DEMO_LIKE
  )).map((r) => r.signature_path);

  // Dependent rows are removed explicitly, so this never depends on cascade settings.
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
    const info = await t.run('DELETE FROM users WHERE email LIKE ?', DEMO_LIKE);
    return info.changes;
  });
  for (const f of files) await sig.removeIfUnused(f);

  await audit(req, 'DEMO_PURGE', removed + ' demo accounts removed');
  req.flash('success', removed + ' demo accounts were removed.');
  res.redirect('/admin/settings');
});

module.exports = router;
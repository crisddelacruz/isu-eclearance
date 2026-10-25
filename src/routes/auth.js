const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../config/database');
const audit = require('../utils/audit');
const { guestOnly, homeFor } = require('../middleware/auth');

const router = express.Router();

// A fake hash, so "unknown user" and "wrong password" take the same time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

// Max 10 FAILED logins per 15 minutes per IP address.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    req.flash('error', 'Too many failed login attempts. Please wait 15 minutes and try again.');
    res.redirect('/login');
  },
});

// ---------------- LOGIN ----------------
router.get('/login', guestOnly, (req, res) => {
  res.render('auth/login', {
    title: 'Log in',
    values: {},
    formError: '',
    loggedOut: req.query.loggedout === '1',
  });
});

router.post('/login', guestOnly, loginLimiter, (req, res) => {
  const identifier = (req.body.identifier || '').trim();
  const password = req.body.password || '';

  const fail = (msg) =>
    res.status(401).render('auth/login', {
      title: 'Log in',
      values: { identifier },
      formError: msg,
      loggedOut: false,
    });

  if (!identifier || !password) {
    return fail('Please enter your email or ID number and your password.');
  }

  const user = db
    .prepare('SELECT * FROM users WHERE email = ? OR lower(id_number) = lower(?)')
    .get(identifier, identifier);

  const passwordOk = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);

  if (!user || !passwordOk) {
    audit(req, 'LOGIN_FAILED', 'Identifier: ' + identifier, null);
    return fail('Incorrect email/ID number or password.');
  }
  if (user.status === 'disabled') {
    return fail('This account has been disabled. Please contact the system administrator.');
  }
  if (user.status === 'pending') {
    return fail('Your account is still waiting for approval.');
  }

  const returnTo = req.session.returnTo;

  // New session ID on login (prevents session fixation attacks)
  req.session.regenerate((err) => {
    if (err) {
      console.error(err);
      return fail('Something went wrong. Please try again.');
    }
    req.session.userId = user.id;
    db.prepare("UPDATE users SET last_login_at = datetime('now','localtime') WHERE id = ?").run(user.id);
    audit(req, 'LOGIN', 'Logged in', user.id);

    const safeReturn =
      returnTo && returnTo.startsWith('/' + user.role + '/') ? returnTo : homeFor(user.role);
    res.redirect(safeReturn);
  });
});

// ---------------- REGISTER (students only) ----------------
function lookups() {
  return {
    colleges: db.prepare('SELECT id, code, name FROM colleges WHERE is_active = 1 ORDER BY name').all(),
    programs: db
      .prepare('SELECT id, college_id, code, name FROM programs WHERE is_active = 1 ORDER BY name')
      .all(),
  };
}

router.get('/register', guestOnly, (req, res) => {
  res.render('auth/register', { title: 'Create account', values: {}, errors: {}, ...lookups() });
});

router.post('/register', guestOnly, (req, res) => {
  const b = req.body;
  const v = {
    id_number: (b.id_number || '').trim(),
    first_name: (b.first_name || '').trim(),
    middle_name: (b.middle_name || '').trim(),
    last_name: (b.last_name || '').trim(),
    suffix: (b.suffix || '').trim(),
    email: (b.email || '').trim().toLowerCase(),
    college_id: parseInt(b.college_id, 10) || '',
    program_id: parseInt(b.program_id, 10) || '',
    year_level: parseInt(b.year_level, 10) || '',
  };
  const password = b.password || '';
  const confirm = b.confirm_password || '';
  const errors = {};

  // ID number
  if (!/^[A-Za-z0-9-]{4,20}$/.test(v.id_number)) {
    errors.id_number = 'Use 4 to 20 characters: letters, numbers, and dashes only.';
  } else if (db.prepare('SELECT 1 FROM users WHERE lower(id_number) = lower(?)').get(v.id_number)) {
    errors.id_number = 'This ID number is already registered. Try logging in instead.';
  }

  // Names
  if (!v.first_name) errors.first_name = 'First name is required.';
  else if (v.first_name.length > 60) errors.first_name = 'First name is too long.';
  if (!v.last_name) errors.last_name = 'Last name is required.';
  else if (v.last_name.length > 60) errors.last_name = 'Last name is too long.';
  if (v.middle_name.length > 60) errors.middle_name = 'Middle name is too long.';
  if (v.suffix.length > 10) errors.suffix = 'Suffix is too long.';

  // Email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) {
    errors.email = 'Enter a valid email address.';
  } else if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(v.email)) {
    errors.email = 'This email is already registered. Try logging in instead.';
  }

  // College and program
  const college = v.college_id && db.prepare('SELECT id FROM colleges WHERE id = ?').get(v.college_id);
  if (!college) errors.college_id = 'Please select your college.';
  const program = v.program_id && db.prepare('SELECT id, college_id FROM programs WHERE id = ?').get(v.program_id);
  if (!program) errors.program_id = 'Please select your program.';
  else if (college && program.college_id !== college.id) {
    errors.program_id = 'That program does not belong to the selected college.';
  }

  // Year level
  if (!(v.year_level >= 1 && v.year_level <= 6)) errors.year_level = 'Please select your year level.';

  // Password
  if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
  else if (password.length > 72) errors.password = 'Password must be 72 characters or fewer.';
  else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    errors.password = 'Password must contain both letters and numbers.';
  }
  if (!errors.password && password !== confirm) errors.confirm_password = 'Passwords do not match.';

  if (Object.keys(errors).length) {
    return res.status(422).render('auth/register', {
      title: 'Create account', values: v, errors, ...lookups(),
    });
  }

  try {
    const info = db
      .prepare(`
        INSERT INTO users
          (role, id_number, email, password_hash, first_name, middle_name, last_name, suffix,
           college_id, program_id, year_level, status)
        VALUES ('student', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `)
      .run(
        v.id_number, v.email, bcrypt.hashSync(password, 10),
        v.first_name, v.middle_name || null, v.last_name, v.suffix || null,
        v.college_id, v.program_id, v.year_level
      );
    audit(req, 'REGISTER', 'New student account: ' + v.id_number, info.lastInsertRowid);
    req.flash('success', 'Account created successfully. You can now log in.');
    res.redirect('/login');
  } catch (err) {
    console.error(err);
    errors.email = 'Could not create the account. The email or ID number may already be in use.';
    res.status(422).render('auth/register', {
      title: 'Create account', values: v, errors, ...lookups(),
    });
  }
});

// ---------------- LOGOUT ----------------
router.post('/logout', (req, res) => {
  const uid = req.session.userId;
  if (uid) audit(req, 'LOGOUT', 'Logged out', uid);
  req.session.destroy(() => {
    res.clearCookie('isu.sid');
    res.redirect('/login?loggedout=1');
  });
});

module.exports = router;
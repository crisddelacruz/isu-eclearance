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

router.post('/login', guestOnly, loginLimiter, async (req, res) => {
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

  const user = await db.get(
    'SELECT * FROM users WHERE email = ? OR lower(id_number) = lower(?)',
    identifier, identifier
  );

  const passwordOk = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

  if (!user || !passwordOk) {
    await audit(req, 'LOGIN_FAILED', 'Identifier: ' + identifier, null);
    return fail('Incorrect email/ID number or password.');
  }
  if (user.status === 'disabled') {
    return fail('This account has been disabled. Please contact the system administrator.');
  }
  if (user.status === 'pending') {
    return fail('Your account is still waiting for approval.');
  }

  const returnTo = req.session.returnTo;

  // A brand-new session object on login. The cookie holds the user id and the
  // session version, so a later password change signs every old cookie out.
  req.session = { userId: user.id, v: user.session_version || 0 };

  await db.run("UPDATE users SET last_login_at = datetime('now','+8 hours') WHERE id = ?", user.id);
  await audit(req, 'LOGIN', 'Logged in', user.id);

  const safeReturn =
    returnTo && returnTo.startsWith('/' + user.role + '/') ? returnTo : homeFor(user.role);
  res.redirect(safeReturn);
});

// ---------------- REGISTER (students only) ----------------
async function lookups() {
  return {
    colleges: await db.all('SELECT id, code, name FROM colleges WHERE is_active = 1 ORDER BY name'),
    programs: await db.all('SELECT id, college_id, code, name FROM programs WHERE is_active = 1 ORDER BY name'),
  };
}

router.get('/register', guestOnly, async (req, res) => {
  res.render('auth/register', { title: 'Create account', values: {}, errors: {}, ...(await lookups()) });
});

router.post('/register', guestOnly, async (req, res) => {
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
  } else if (await db.get('SELECT 1 AS x FROM users WHERE lower(id_number) = lower(?)', v.id_number)) {
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
  } else if (await db.get('SELECT 1 AS x FROM users WHERE email = ?', v.email)) {
    errors.email = 'This email is already registered. Try logging in instead.';
  }

  // College and program
  const college = v.college_id ? await db.get('SELECT id FROM colleges WHERE id = ?', v.college_id) : null;
  if (!college) errors.college_id = 'Please select your college.';
  const program = v.program_id ? await db.get('SELECT id, college_id FROM programs WHERE id = ?', v.program_id) : null;
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
      title: 'Create account', values: v, errors, ...(await lookups()),
    });
  }

  try {
    const info = await db.run(
      `INSERT INTO users
         (role, id_number, email, password_hash, first_name, middle_name, last_name, suffix,
          college_id, program_id, year_level, status)
       VALUES ('student', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      v.id_number, v.email, await bcrypt.hash(password, 10),
      v.first_name, v.middle_name || null, v.last_name, v.suffix || null,
      v.college_id, v.program_id, v.year_level
    );
    await audit(req, 'REGISTER', 'New student account: ' + v.id_number, info.lastId);
    req.flash('success', 'Account created successfully. You can now log in.');
    res.redirect('/login');
  } catch (err) {
    console.error(err);
    errors.email = 'Could not create the account. The email or ID number may already be in use.';
    res.status(422).render('auth/register', {
      title: 'Create account', values: v, errors, ...(await lookups()),
    });
  }
});

// ---------------- LOGOUT ----------------
router.post('/logout', async (req, res) => {
  const uid = req.session && req.session.userId;
  if (uid) await audit(req, 'LOGOUT', 'Logged out', uid);
  req.session = null; // clears the cookie
  res.redirect('/login?loggedout=1');
});

module.exports = router;
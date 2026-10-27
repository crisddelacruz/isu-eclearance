const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../config/database');
const audit = require('../utils/audit');
const pw = require('../utils/password');
const { enabled: mailOn, sendMail } = require('../utils/mailer');
const { baseUrl } = require('../utils/url');
const { guestOnly } = require('../middleware/auth');

const router = express.Router();

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const TOKEN_RE = /^[a-f0-9]{64}$/;
const ONE_HOUR = 60 * 60 * 1000;

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method !== 'POST',
  handler: (req, res) => {
    req.flash('error', 'Too many requests. Please wait 15 minutes and try again.');
    res.redirect('/forgot');
  },
});

async function findValid(token) {
  if (!TOKEN_RE.test(token)) return null;
  return (
    (await db.get(
      `SELECT pr.id, pr.user_id, u.first_name FROM password_resets pr
       JOIN users u ON u.id = pr.user_id AND u.status = 'active'
       WHERE pr.token_hash = ? AND pr.expires_at > ?`,
      hashToken(token), Date.now()
    )) || null
  );
}

// ---------- Ask for a link ----------
router.get('/forgot', guestOnly, (req, res) => {
  res.render('auth/forgot', { title: 'Forgot password' });
});

router.post('/forgot', guestOnly, limiter, async (req, res) => {
  if (!mailOn) {
    req.flash('error', 'Password reset by email is not available. Please contact the system administrator.');
    return res.redirect('/forgot');
  }
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 150);

  await db.run('DELETE FROM password_resets WHERE expires_at < ?', Date.now());

  const user = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? await db.get("SELECT id, first_name FROM users WHERE email = ? AND status = 'active'", email)
    : null;

  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    await db.run('DELETE FROM password_resets WHERE user_id = ?', user.id);
    await db.run(
      'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      user.id, hashToken(token), Date.now() + ONE_HOUR
    );
    await audit(req, 'PASSWORD_RESET_REQUEST', 'Reset link sent', user.id);
    await sendMail(
      email,
      'Reset your ISU eClearance password',
      'Hello ' + user.first_name + ',\n\n' +
        'We received a request to reset your password. Open this link within 1 hour:\n\n' +
        baseUrl() + '/reset/' + token + '\n\n' +
        'If you did not ask for this, ignore this email. Your password will not change.'
    );
  }

  // The same message either way, so nobody can find out which emails are registered.
  req.flash('success', 'If an account exists for that email, a reset link has been sent. Check your inbox and spam folder.');
  res.redirect('/login');
});

// ---------- Use the link ----------
router.get('/reset/:token', async (req, res) => {
  res.render('auth/reset', { title: 'Reset password', valid: !!(await findValid(req.params.token)) });
});

router.post('/reset/:token', async (req, res) => {
  const found = await findValid(req.params.token);
  if (!found) return res.status(400).render('auth/reset', { title: 'Reset password', valid: false });

  const next = String(req.body.new_password || '');
  const confirm = String(req.body.confirm_password || '');
  const problem = pw.check(next) || (next !== confirm ? 'The passwords do not match.' : '');
  if (problem) {
    req.flash('error', problem);
    return res.redirect('/reset/' + req.params.token);
  }

  const hash = await bcrypt.hash(next, 10);
  await db.tx(async (t) => {
    // Raising session_version logs the user out of every device.
    await t.run(
      `UPDATE users SET password_hash = ?, must_change_password = 0,
              session_version = session_version + 1, updated_at = datetime('now','+8 hours')
       WHERE id = ?`,
      hash, found.user_id
    );
    await t.run('DELETE FROM password_resets WHERE user_id = ?', found.user_id);
  });

  await audit(req, 'PASSWORD_RESET_DONE', 'Password reset by email link', found.user_id);
  req.flash('success', 'Your password was changed. You can now log in.');
  res.redirect('/login');
});

module.exports = router;
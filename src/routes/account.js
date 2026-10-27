const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const audit = require('../utils/audit');
const pw = require('../utils/password');
const { requireAuth, homeFor } = require('../middleware/auth');

const router = express.Router();

router.get('/account/password', requireAuth, (req, res) => {
  res.render('account/password', {
    title: 'Change Password',
    active: '',
    forced: !!req.user.must_change_password,
  });
});

router.post('/account/password', requireAuth, async (req, res) => {
  const current = req.body.current_password || '';
  const next = req.body.new_password || '';
  const confirm = req.body.confirm_password || '';
  const row = await db.get('SELECT password_hash, session_version FROM users WHERE id = ?', req.user.id);

  const fail = (msg) => {
    req.flash('error', msg);
    res.redirect('/account/password');
  };

  if (!(await bcrypt.compare(current, row.password_hash))) return fail('Your current password is incorrect.');
  const problem = pw.check(next);
  if (problem) return fail(problem);
  if (next !== confirm) return fail('The new passwords do not match.');
  if (await bcrypt.compare(next, row.password_hash)) return fail('Your new password must be different from the current one.');

  // Raising the session version signs this user out on every OTHER device.
  await db.run(
    `UPDATE users SET password_hash = ?, must_change_password = 0,
            session_version = session_version + 1, updated_at = datetime('now','+8 hours')
     WHERE id = ?`,
    await bcrypt.hash(next, 10), req.user.id
  );
  req.session.v = row.session_version + 1; // this device stays logged in
  await audit(req, 'PASSWORD_CHANGE', 'Password changed');
  req.flash('success', 'Your password was changed.');
  res.redirect(homeFor(req.user.role));
});

module.exports = router;
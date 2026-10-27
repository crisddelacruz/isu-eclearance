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

router.post('/account/password', requireAuth, (req, res) => {
  const current = req.body.current_password || '';
  const next = req.body.new_password || '';
  const confirm = req.body.confirm_password || '';
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);

  const fail = (msg) => {
    req.flash('error', msg);
    res.redirect('/account/password');
  };

  if (!bcrypt.compareSync(current, row.password_hash)) return fail('Your current password is incorrect.');
  const problem = pw.check(next);
  if (problem) return fail(problem);
  if (next !== confirm) return fail('The new passwords do not match.');
  if (bcrypt.compareSync(next, row.password_hash)) return fail('Your new password must be different from the current one.');

  db.prepare(
    "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now','localtime') WHERE id = ?"
  ).run(bcrypt.hashSync(next, 10), req.user.id);
  audit(req, 'PASSWORD_CHANGE', 'Password changed');
  req.flash('success', 'Your password was changed.');
  res.redirect(homeFor(req.user.role));
});

module.exports = router;
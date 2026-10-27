const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('../config/database');
const audit = require('../utils/audit');
const sig = require('../utils/signature');
const S = require('../utils/signatory');
const signing = require('../utils/signing');
const { sheetFor } = require('../utils/clearance');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('signatory')); // every page below is for signatories only

// Pending count for the sidebar badge
router.use((req, res, next) => {
  res.locals.pendingCount = S.countPending(req.user);
  next();
});

const notFound = (res) =>
  res.status(404).render('error', {
    title: 'Not found', code: 404, heading: 'Not found',
    message: 'We could not find what you were looking for.',
  });

// ============ DASHBOARD ============
router.get('/dashboard', (req, res) => {
  res.render('signatory/dashboard', {
    title: 'Signatory Dashboard', active: 'dashboard',
    stats: S.stats(req.user),
    recent: S.pendingFor(req.user, { limit: 8 }),
    notifications: db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 5')
      .all(req.user.id),
  });
});

// ============ PENDING REQUESTS ============
router.get('/requests', (req, res) => {
  const search = String(req.query.q || '').trim().slice(0, 60);
  res.render('signatory/requests', {
    title: 'Pending Requests', active: 'pending',
    search, rows: S.pendingFor(req.user, { search, limit: 100 }),
  });
});

// Approve many lines at once
router.post('/requests/approve-selected', (req, res) => {
  let ids = req.body.item_ids ? [].concat(req.body.item_ids) : [];
  ids = [...new Set(ids.map((n) => parseInt(n, 10)).filter(Boolean))].slice(0, 100);

  if (!ids.length) {
    req.flash('error', 'Please tick at least one request first.');
    return res.redirect('/signatory/requests');
  }
  if (!req.user.signature_path) {
    req.flash('error', 'Set up your e-signature first. It is needed to approve requests.');
    return res.redirect('/signatory/signature');
  }

  let done = 0;
  let skipped = 0;
  ids.forEach((id) => {
    const r = signing.approveItem(req.user, id);
    if (r.ok) {
      done++;
      audit(req, 'ITEM_APPROVE', 'Line #' + id + ' (bulk)');
    } else skipped++;
  });

  if (done) req.flash('success', done + ' request' + (done === 1 ? '' : 's') + ' approved and signed.');
  if (skipped) req.flash('error', skipped + ' request' + (skipped === 1 ? ' was' : 's were') + ' skipped because ' + (skipped === 1 ? 'it is' : 'they are') + ' no longer waiting for you.');
  res.redirect('/signatory/requests');
});

// Review one line (with the full clearance form)
router.get('/requests/:id', (req, res) => {
  const itemId = parseInt(req.params.id, 10);
  const found = itemId ? S.findItem(req.user, itemId) : null;
  if (!found) return notFound(res);

  const sheet = sheetFor(found.item.request_id);
  if (!sheet) return notFound(res);

  res.render('signatory/request-detail', {
    title: 'Review Request', active: 'pending',
    item: found.item, canAct: found.canAct, sheet,
  });
});

router.post('/requests/:id/approve', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = id ? signing.approveItem(req.user, id) : { error: 'Request not found.' };

  if (r.error === 'no_signature') {
    req.flash('error', 'Set up your e-signature first. It is needed to approve requests.');
    return res.redirect('/signatory/signature');
  }
  if (r.error) {
    req.flash('error', r.error);
    return res.redirect('/signatory/requests');
  }
  audit(req, 'ITEM_APPROVE', 'Line #' + id);
  req.flash(
    'success',
    'Approved. Your e-signature was placed on the clearance.' + (r.completed ? ' This was the last office, so the clearance is now complete.' : '')
  );
  res.redirect('/signatory/requests');
});

router.post('/requests/:id/return', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const remarks = String(req.body.remarks || '').trim();

  if (remarks.length < 5 || remarks.length > 300) {
    req.flash('error', 'Please explain what the student must settle (5 to 300 characters).');
    return res.redirect('/signatory/requests/' + id);
  }
  const r = id ? signing.returnItem(req.user, id, remarks) : { error: 'Request not found.' };
  if (r.error) {
    req.flash('error', r.error);
    return res.redirect('/signatory/requests');
  }
  audit(req, 'ITEM_RETURN', 'Line #' + id);
  req.flash('success', 'The request was returned to the student with your remarks.');
  res.redirect('/signatory/requests');
});

// ============ HISTORY ============
router.get('/history', (req, res) => {
  res.render('signatory/history', {
    title: 'Signed History', active: 'history', rows: S.historyFor(req.user),
  });
});

// ============ E-SIGNATURE ============
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1 }, // 1 MB
  fileFilter: (req, file, cb) => {
    if (['image/png', 'image/jpeg'].includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only PNG or JPG images are allowed.'));
  },
});

// Runs multer and turns its errors into friendly messages.
function handleUpload(req, res, next) {
  upload.single('signature')(req, res, (err) => {
    if (!err) return next();
    let msg = err.message || 'Upload failed. Please try again.';
    if (err.code === 'LIMIT_FILE_SIZE') msg = 'The image is too large. The maximum size is 1 MB.';
    else if (err instanceof multer.MulterError) msg = 'Upload failed. Please choose a PNG or JPG image.';
    req.flash('error', msg);
    res.redirect('/signatory/signature');
  });
}

// Saves a verified image as the signatory's signature.
function applySignature(req, buffer, type, how) {
  const name = sig.saveFile(buffer, type);
  const old = req.user.signature_path;
  db.prepare(`
    UPDATE users
    SET signature_path = ?, signature_updated_at = datetime('now','localtime'),
        updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(name, req.user.id);
  if (old) sig.removeIfUnused(old); // keeps files that old clearances still use
  audit(req, 'SIGNATURE_SAVE', how + ' (' + type + ')');
}

router.get('/signature', (req, res) => {
  res.render('signatory/signature', { title: 'My E-Signature', active: 'signature' });
});

router.post('/signature/upload', handleUpload, (req, res) => {
  if (!req.file) {
    req.flash('error', 'Please choose an image file first.');
    return res.redirect('/signatory/signature');
  }
  const type = sig.detectType(req.file.buffer);
  if (!type) {
    req.flash('error', 'That file is not a valid PNG or JPG image.');
    return res.redirect('/signatory/signature');
  }
  applySignature(req, req.file.buffer, type, 'upload');
  req.flash('success', 'Your e-signature was saved.');
  res.redirect('/signatory/signature');
});

// Drawn signature (sent by JavaScript as a PNG data URL)
router.post('/signature/draw', (req, res) => {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String((req.body && req.body.image) || ''));
  if (!m) return res.status(400).json({ error: 'The signature image is not valid.' });

  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 400 * 1024) return res.status(400).json({ error: 'The signature image is too large.' });
  if (sig.detectType(buf) !== 'png') return res.status(400).json({ error: 'The signature image is not valid.' });

  applySignature(req, buf, 'png', 'drawn');
  req.flash('success', 'Your drawn signature was saved.');
  res.json({ ok: true });
});

router.post('/signature/delete', (req, res) => {
  const old = req.user.signature_path;
  if (!old) {
    req.flash('error', 'You do not have a saved signature.');
    return res.redirect('/signatory/signature');
  }
  db.prepare(`
    UPDATE users SET signature_path = NULL, signature_updated_at = NULL,
           updated_at = datetime('now','localtime') WHERE id = ?
  `).run(req.user.id);
  sig.removeIfUnused(old);
  audit(req, 'SIGNATURE_REMOVE', 'Signature removed');
  req.flash('success', 'Your e-signature was removed.');
  res.redirect('/signatory/signature');
});

// ============ NOTIFICATIONS ============
router.get('/notifications', (req, res) => {
  const list = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .all(req.user.id);
  res.render('signatory/notifications', { title: 'Notifications', active: 'notifications', list });
});

router.post('/notifications/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.redirect('/signatory/notifications');
});

router.post('/notifications/:id/read', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const n = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (n) db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
  const safe = n && n.link && n.link.startsWith('/signatory/') ? n.link : '/signatory/notifications';
  res.redirect(safe);
});

// ============ PROFILE ============
router.get('/profile', (req, res) => {
  res.render('signatory/profile', { title: 'My Profile', active: 'profile' });
});

router.post('/profile', (req, res) => {
  const phone = (req.body.phone || '').trim();
  if (phone && !/^[0-9+\-\s()]{7,20}$/.test(phone)) {
    req.flash('error', 'Enter a valid phone number, or leave it empty.');
    return res.redirect('/signatory/profile');
  }
  db.prepare("UPDATE users SET phone = ?, updated_at = datetime('now','localtime') WHERE id = ?")
    .run(phone || null, req.user.id);
  audit(req, 'PROFILE_UPDATE', 'Phone updated');
  req.flash('success', 'Your profile was updated.');
  res.redirect('/signatory/profile');
});

router.post('/password', (req, res) => {
  const current = req.body.current_password || '';
  const next = req.body.new_password || '';
  const confirm = req.body.confirm_password || '';
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  const fail = (msg) => {
    req.flash('error', msg);
    res.redirect('/signatory/profile');
  };

  if (!bcrypt.compareSync(current, row.password_hash)) return fail('Your current password is incorrect.');
  if (next.length < 8) return fail('New password must be at least 8 characters.');
  if (next.length > 72) return fail('New password must be 72 characters or fewer.');
  if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) return fail('New password must contain both letters and numbers.');
  if (next !== confirm) return fail('The new passwords do not match.');
  if (bcrypt.compareSync(next, row.password_hash)) return fail('Your new password must be different from the current one.');

  db.prepare(
    "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now','localtime') WHERE id = ?"
  ).run(bcrypt.hashSync(next, 10), req.user.id);
  audit(req, 'PASSWORD_CHANGE', 'Password changed');
  req.flash('success', 'Your password was changed.');
  res.redirect('/signatory/profile');
});

module.exports = router;
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const audit = require('../utils/audit');
const { notify, notifySignatories } = require('../utils/notify');
const { PURPOSES, getCurrentTerm, requestsFor, itemsFor, sheetFor, createClearance } = require('../utils/clearance');
const { requireRole } = require('../middleware/auth');
const termWindow = require('../utils/termwindow');

const router = express.Router();
router.use(requireRole('student')); // every page below is for students only

const notFound = (res) =>
  res.status(404).render('error', {
    title: 'Not found', code: 404, heading: 'Not found',
    message: 'We could not find what you were looking for.',
  });

const hasRequest = (studentId, termId) =>
  !!db.prepare('SELECT 1 FROM clearance_requests WHERE student_id = ? AND term_id = ?').get(studentId, termId);

function ownRequest(req) {
  const id = parseInt(req.params.id, 10);
  if (!id) return null;
  return requestsFor(req.user.id).find((r) => r.id === id) || null;
}

// ============ DASHBOARD ============
router.get('/dashboard', (req, res) => {
  const term = getCurrentTerm();
  const current = term ? requestsFor(req.user.id).filter((r) => r.term_id === term.id) : [];
  const activeRequest = current.find((r) => r.status === 'in_progress') || current[0] || null;
  const items = activeRequest ? itemsFor(activeRequest.id) : [];
  const subjectCount = term
    ? db.prepare('SELECT COUNT(*) AS n FROM enrollments WHERE student_id = ? AND term_id = ?').get(req.user.id, term.id).n
    : 0;
  const notifications = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 5')
    .all(req.user.id);

  res.render('student/dashboard', {
    title: 'Student Dashboard', active: 'dashboard',
    term, activeRequest, items, subjectCount, notifications,
  });
});

// ============ CLEARANCE ============
router.get('/clearance', (req, res) => {
  const term = getCurrentTerm();
  const requests = requestsFor(req.user.id);
  const taken = term ? requests.filter((r) => r.term_id === term.id).map((r) => r.purpose) : [];
  const subjectCount = term
    ? db.prepare('SELECT COUNT(*) AS n FROM enrollments WHERE student_id = ? AND term_id = ?').get(req.user.id, term.id).n
    : 0;

  res.render('student/clearance', {
    title: 'My Clearance', active: 'clearance',
    term, requests, taken, subjectCount, purposes: PURPOSES,
  });
});

router.post('/clearance/request', (req, res) => {
  const term = getCurrentTerm();
  if (!term) {
    req.flash('error', 'There is no active academic term right now.');
    return res.redirect('/student/clearance');
  }
   const closed = termWindow.problem(term);
  if (closed) {
    req.flash('error', closed);
    return res.redirect('/student/clearance');
  }
  const result = createClearance(req.user, term, (req.body.purpose || '').trim());
  if (result.error) {
    req.flash('error', result.error);
    return res.redirect('/student/clearance');
  }
  audit(req, 'CLEARANCE_REQUEST', 'Request #' + result.id + ' (' + req.body.purpose + ')');
  notify(
    req.user.id,
    'Clearance request created',
    'Your ' + req.body.purpose + ' clearance is now waiting for the offices to sign.',
    '/student/clearance/' + result.id
  );
  notifySignatories(result.id, null, 'New clearance request'); // tell the offices
  req.flash('success', 'Your clearance request was created. Each office will review it online.');
  res.redirect('/student/clearance/' + result.id);
});

router.get('/clearance/:id', (req, res) => {
  const request = ownRequest(req);
  if (!request) return notFound(res);
  res.render('student/clearance-detail', {
    title: 'Clearance Details', active: 'clearance',
    request, items: itemsFor(request.id), sheet: sheetFor(request.id),
  });
});

// Student fixed the problem and asks the office to review again
router.post('/clearance/:id/items/:itemId/resubmit', (req, res) => {
  const request = ownRequest(req);
  if (!request) return notFound(res);
  const back = '/student/clearance/' + request.id;

  if (request.status !== 'in_progress') {
    req.flash('error', 'This clearance can no longer be changed.');
    return res.redirect(back);
  }
  const itemId = parseInt(req.params.itemId, 10);
  const item = db
    .prepare(`
      SELECT ci.*, e.instructor_id
      FROM clearance_items ci LEFT JOIN enrollments e ON e.id = ci.enrollment_id
      WHERE ci.id = ? AND ci.request_id = ?
    `)
    .get(itemId, request.id);

  if (!item || item.status !== 'rejected') {
    req.flash('error', 'That line is not waiting for your action.');
    return res.redirect(back);
  }

  // Back to pending. Instructor lines return to the subject's instructor;
  // office lines are matched to a signatory again when someone signs.
  db.prepare(`
    UPDATE clearance_items
    SET status = 'pending', remarks = NULL, acted_at = NULL,
        signed_name = NULL, signed_position = NULL, signature_path = NULL, signatory_id = ?
    WHERE id = ?
  `).run(item.instructor_id || null, item.id);

  audit(req, 'ITEM_RESUBMIT', 'Line #' + item.id + ' of request #' + request.id);
  notifySignatories(request.id, item.id, 'Review requested');
  req.flash('success', 'Done. The office was notified to review your request again.');
  res.redirect(back);
});

router.post('/clearance/:id/cancel', (req, res) => {
  const request = ownRequest(req);
  if (!request) return notFound(res);
  if (request.approved > 0) {
    req.flash('error', 'This request cannot be cancelled because an office has already signed it.');
    return res.redirect('/student/clearance/' + request.id);
  }
  db.prepare('DELETE FROM clearance_requests WHERE id = ? AND student_id = ?').run(request.id, req.user.id);
  audit(req, 'CLEARANCE_CANCEL', 'Request #' + request.id);
  req.flash('success', 'Your clearance request was cancelled. You can create a new one.');
  res.redirect('/student/clearance');
});

// ============ SUBJECTS ============
router.get('/subjects', (req, res) => {
  const term = getCurrentTerm();
  let subjects = [];
  let locked = false;
  if (term) {
    subjects = db
      .prepare(`
        SELECT e.*, iu.first_name AS i_first, iu.last_name AS i_last
        FROM enrollments e LEFT JOIN users iu ON iu.id = e.instructor_id
        WHERE e.student_id = ? AND e.term_id = ? ORDER BY e.subject_code
      `)
      .all(req.user.id, term.id);
    locked = hasRequest(req.user.id, term.id);
  }
  const instructors = db
    .prepare(`
      SELECT u.id, u.first_name, u.last_name, c.code AS college_code
      FROM users u
      JOIN offices o ON o.id = u.office_id
      LEFT JOIN colleges c ON c.id = u.college_id
      WHERE u.role = 'signatory' AND o.code = 'INSTR' AND u.status = 'active'
      ORDER BY (u.college_id = ?) DESC, u.last_name, u.first_name
    `)
    .all(req.user.college_id);

  res.render('student/subjects', {
    title: 'My Subjects', active: 'subjects', term, subjects, locked, instructors,
  });
});

router.post('/subjects', (req, res) => {
  const term = getCurrentTerm();
  if (!term) {
    req.flash('error', 'There is no active academic term right now.');
    return res.redirect('/student/subjects');
  }
  if (hasRequest(req.user.id, term.id)) {
    req.flash('error', 'You already requested a clearance, so your subjects are locked.');
    return res.redirect('/student/subjects');
  }

  const code = (req.body.subject_code || '').trim().toUpperCase();
  const title = (req.body.subject_title || '').trim();
  const instructorId = parseInt(req.body.instructor_id, 10);

  if (!/^[A-Z0-9 .-]{2,20}$/.test(code)) {
    req.flash('error', 'Enter a valid subject code (2 to 20 characters), for example IT 301.');
    return res.redirect('/student/subjects');
  }
  if (title.length < 3 || title.length > 100) {
    req.flash('error', 'Subject title must be 3 to 100 characters.');
    return res.redirect('/student/subjects');
  }
  const instructor = db
    .prepare(`
      SELECT u.id FROM users u JOIN offices o ON o.id = u.office_id
      WHERE u.id = ? AND u.role = 'signatory' AND o.code = 'INSTR' AND u.status = 'active'
    `)
    .get(instructorId);
  if (!instructor) {
    req.flash('error', 'Please select a valid instructor.');
    return res.redirect('/student/subjects');
  }
  const dup = db
    .prepare('SELECT 1 FROM enrollments WHERE student_id = ? AND term_id = ? AND subject_code = ?')
    .get(req.user.id, term.id, code);
  if (dup) {
    req.flash('error', 'You already added ' + code + ' for this term.');
    return res.redirect('/student/subjects');
  }

  db.prepare(
    'INSERT INTO enrollments (student_id, term_id, subject_code, subject_title, instructor_id) VALUES (?, ?, ?, ?, ?)'
  ).run(req.user.id, term.id, code, title, instructor.id);
  audit(req, 'SUBJECT_ADD', code);
  req.flash('success', code + ' was added.');
  res.redirect('/student/subjects');
});

router.post('/subjects/:id/delete', (req, res) => {
  const term = getCurrentTerm();
  if (term && hasRequest(req.user.id, term.id)) {
    req.flash('error', 'Your subjects are locked because you already requested a clearance.');
    return res.redirect('/student/subjects');
  }
  const id = parseInt(req.params.id, 10);
  db.prepare('DELETE FROM enrollments WHERE id = ? AND student_id = ?').run(id, req.user.id);
  audit(req, 'SUBJECT_REMOVE', 'Enrollment #' + id);
  req.flash('success', 'Subject removed.');
  res.redirect('/student/subjects');
});

// ============ NOTIFICATIONS ============
router.get('/notifications', (req, res) => {
  const list = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .all(req.user.id);
  res.render('student/notifications', { title: 'Notifications', active: 'notifications', list });
});

router.post('/notifications/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.redirect('/student/notifications');
});

router.post('/notifications/:id/read', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const n = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (n) db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
  const safeLink = n && n.link && n.link.startsWith('/student/') ? n.link : '/student/notifications';
  res.redirect(safeLink);
});

// ============ PROFILE ============
router.get('/profile', (req, res) => {
  res.render('student/profile', { title: 'My Profile', active: 'profile' });
});

router.post('/profile', (req, res) => {
  const phone = (req.body.phone || '').trim();
  if (phone && !/^[0-9+\-\s()]{7,20}$/.test(phone)) {
    req.flash('error', 'Enter a valid phone number, or leave it empty.');
    return res.redirect('/student/profile');
  }
  db.prepare("UPDATE users SET phone = ?, updated_at = datetime('now','localtime') WHERE id = ?")
    .run(phone || null, req.user.id);
  audit(req, 'PROFILE_UPDATE', 'Phone updated');
  req.flash('success', 'Your profile was updated.');
  res.redirect('/student/profile');
});

router.post('/password', (req, res) => {
  const current = req.body.current_password || '';
  const next = req.body.new_password || '';
  const confirm = req.body.confirm_password || '';

  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  const fail = (msg) => {
    req.flash('error', msg);
    res.redirect('/student/profile');
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
  res.redirect('/student/profile');
});

module.exports = router;
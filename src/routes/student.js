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

const NOW = "datetime('now','+8 hours')";

const notFound = (res) =>
  res.status(404).render('error', {
    title: 'Not found', code: 404, heading: 'Not found',
    message: 'We could not find what you were looking for.',
  });

async function hasRequest(studentId, termId) {
  return !!(await db.get(
    'SELECT 1 AS x FROM clearance_requests WHERE student_id = ? AND term_id = ?', studentId, termId
  ));
}

async function subjectCount(studentId, termId) {
  return (await db.get(
    'SELECT COUNT(*) AS n FROM enrollments WHERE student_id = ? AND term_id = ?', studentId, termId
  )).n;
}

async function ownRequest(req) {
  const id = parseInt(req.params.id, 10);
  if (!id) return null;
  return (await requestsFor(req.user.id)).find((r) => r.id === id) || null;
}

// ============ DASHBOARD ============
router.get('/dashboard', async (req, res) => {
  const term = await getCurrentTerm();
  const current = term ? (await requestsFor(req.user.id)).filter((r) => r.term_id === term.id) : [];
  const activeRequest = current.find((r) => r.status === 'in_progress') || current[0] || null;
  const items = activeRequest ? await itemsFor(activeRequest.id) : [];
  const count = term ? await subjectCount(req.user.id, term.id) : 0;
  const notifications = await db.all(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 5', req.user.id
  );

  res.render('student/dashboard', {
    title: 'Student Dashboard', active: 'dashboard',
    term, activeRequest, items, subjectCount: count, notifications,
  });
});

// ============ CLEARANCE ============
router.get('/clearance', async (req, res) => {
  const term = await getCurrentTerm();
  const requests = await requestsFor(req.user.id);
  const taken = term ? requests.filter((r) => r.term_id === term.id).map((r) => r.purpose) : [];
  const count = term ? await subjectCount(req.user.id, term.id) : 0;

  res.render('student/clearance', {
    title: 'My Clearance', active: 'clearance',
    term, requests, taken, subjectCount: count, purposes: PURPOSES,
  });
});

router.post('/clearance/request', async (req, res) => {
  const term = await getCurrentTerm();
  if (!term) {
    req.flash('error', 'There is no active academic term right now.');
    return res.redirect('/student/clearance');
  }
  const closed = await termWindow.problem(term);
  if (closed) {
    req.flash('error', closed);
    return res.redirect('/student/clearance');
  }
  const purpose = (req.body.purpose || '').trim();
  const result = await createClearance(req.user, term, purpose);
  if (result.error) {
    req.flash('error', result.error);
    return res.redirect('/student/clearance');
  }
  await audit(req, 'CLEARANCE_REQUEST', 'Request #' + result.id + ' (' + purpose + ')');
  await notify(
    req.user.id,
    'Clearance request created',
    'Your ' + purpose + ' clearance is now waiting for the offices to sign.',
    '/student/clearance/' + result.id
  );
  await notifySignatories(result.id, null, 'New clearance request'); // tell the offices
  req.flash('success', 'Your clearance request was created. Each office will review it online.');
  res.redirect('/student/clearance/' + result.id);
});

router.get('/clearance/:id', async (req, res) => {
  const request = await ownRequest(req);
  if (!request) return notFound(res);
  res.render('student/clearance-detail', {
    title: 'Clearance Details', active: 'clearance',
    request, items: await itemsFor(request.id), sheet: await sheetFor(request.id),
  });
});

// Student fixed the problem and asks the office to review again
router.post('/clearance/:id/items/:itemId/resubmit', async (req, res) => {
  const request = await ownRequest(req);
  if (!request) return notFound(res);
  const back = '/student/clearance/' + request.id;

  if (request.status !== 'in_progress') {
    req.flash('error', 'This clearance can no longer be changed.');
    return res.redirect(back);
  }
  const itemId = parseInt(req.params.itemId, 10);
  const item = await db.get(
    `SELECT ci.*, e.instructor_id
     FROM clearance_items ci LEFT JOIN enrollments e ON e.id = ci.enrollment_id
     WHERE ci.id = ? AND ci.request_id = ?`, itemId, request.id
  );

  if (!item || item.status !== 'rejected') {
    req.flash('error', 'That line is not waiting for your action.');
    return res.redirect(back);
  }

  // Back to pending. Instructor lines return to the subject's instructor;
  // office lines are matched to a signatory again when someone signs.
  await db.run(
    `UPDATE clearance_items
     SET status = 'pending', remarks = NULL, acted_at = NULL,
         signed_name = NULL, signed_position = NULL, signature_path = NULL, signatory_id = ?
     WHERE id = ?`, item.instructor_id || null, item.id
  );

  await audit(req, 'ITEM_RESUBMIT', 'Line #' + item.id + ' of request #' + request.id);
  await notifySignatories(request.id, item.id, 'Review requested');
  req.flash('success', 'Done. The office was notified to review your request again.');
  res.redirect(back);
});

router.post('/clearance/:id/cancel', async (req, res) => {
  const request = await ownRequest(req);
  if (!request) return notFound(res);
  if (request.approved > 0) {
    req.flash('error', 'This request cannot be cancelled because an office has already signed it.');
    return res.redirect('/student/clearance/' + request.id);
  }
  await db.tx(async (t) => {
    await t.run('DELETE FROM clearance_items WHERE request_id = ?', request.id);
    await t.run('DELETE FROM clearance_requests WHERE id = ? AND student_id = ?', request.id, req.user.id);
  });
  await audit(req, 'CLEARANCE_CANCEL', 'Request #' + request.id);
  req.flash('success', 'Your clearance request was cancelled. You can create a new one.');
  res.redirect('/student/clearance');
});

// ============ SUBJECTS ============
router.get('/subjects', async (req, res) => {
  const term = await getCurrentTerm();
  let subjects = [];
  let locked = false;
  if (term) {
    subjects = await db.all(
      `SELECT e.*, iu.first_name AS i_first, iu.last_name AS i_last
       FROM enrollments e LEFT JOIN users iu ON iu.id = e.instructor_id
       WHERE e.student_id = ? AND e.term_id = ? ORDER BY e.subject_code`, req.user.id, term.id
    );
    locked = await hasRequest(req.user.id, term.id);
  }
  const instructors = await db.all(
    `SELECT u.id, u.first_name, u.last_name, c.code AS college_code
     FROM users u
     JOIN offices o ON o.id = u.office_id
     LEFT JOIN colleges c ON c.id = u.college_id
     WHERE u.role = 'signatory' AND o.code = 'INSTR' AND u.status = 'active'
     ORDER BY (u.college_id = ?) DESC, u.last_name, u.first_name`, req.user.college_id
  );

  res.render('student/subjects', {
    title: 'My Subjects', active: 'subjects', term, subjects, locked, instructors,
  });
});

router.post('/subjects', async (req, res) => {
  const term = await getCurrentTerm();
  if (!term) {
    req.flash('error', 'There is no active academic term right now.');
    return res.redirect('/student/subjects');
  }
  if (await hasRequest(req.user.id, term.id)) {
    req.flash('error', 'You already requested a clearance, so your subjects are locked.');
    return res.redirect('/student/subjects');
  }

  const code = (req.body.subject_code || '').trim().toUpperCase();
  const title = (req.body.subject_title || '').trim();
  const instructorId = parseInt(req.body.instructor_id, 10) || 0;

  if (!/^[A-Z0-9 .-]{2,20}$/.test(code)) {
    req.flash('error', 'Enter a valid subject code (2 to 20 characters), for example IT 301.');
    return res.redirect('/student/subjects');
  }
  if (title.length < 3 || title.length > 100) {
    req.flash('error', 'Subject title must be 3 to 100 characters.');
    return res.redirect('/student/subjects');
  }
  const instructor = await db.get(
    `SELECT u.id FROM users u JOIN offices o ON o.id = u.office_id
     WHERE u.id = ? AND u.role = 'signatory' AND o.code = 'INSTR' AND u.status = 'active'`, instructorId
  );
  if (!instructor) {
    req.flash('error', 'Please select a valid instructor.');
    return res.redirect('/student/subjects');
  }
  const dup = await db.get(
    'SELECT 1 AS x FROM enrollments WHERE student_id = ? AND term_id = ? AND subject_code = ?',
    req.user.id, term.id, code
  );
  if (dup) {
    req.flash('error', 'You already added ' + code + ' for this term.');
    return res.redirect('/student/subjects');
  }

  await db.run(
    'INSERT INTO enrollments (student_id, term_id, subject_code, subject_title, instructor_id) VALUES (?, ?, ?, ?, ?)',
    req.user.id, term.id, code, title, instructor.id
  );
  await audit(req, 'SUBJECT_ADD', code);
  req.flash('success', code + ' was added.');
  res.redirect('/student/subjects');
});

router.post('/subjects/:id/delete', async (req, res) => {
  const term = await getCurrentTerm();
  if (term && (await hasRequest(req.user.id, term.id))) {
    req.flash('error', 'Your subjects are locked because you already requested a clearance.');
    return res.redirect('/student/subjects');
  }
  const id = parseInt(req.params.id, 10) || 0;
  await db.run('DELETE FROM enrollments WHERE id = ? AND student_id = ?', id, req.user.id);
  await audit(req, 'SUBJECT_REMOVE', 'Enrollment #' + id);
  req.flash('success', 'Subject removed.');
  res.redirect('/student/subjects');
});

// ============ NOTIFICATIONS ============
router.get('/notifications', async (req, res) => {
  const list = await db.all(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id
  );
  res.render('student/notifications', { title: 'Notifications', active: 'notifications', list });
});

router.post('/notifications/read-all', async (req, res) => {
  await db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', req.user.id);
  res.redirect('/student/notifications');
});

router.post('/notifications/:id/read', async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const n = await db.get('SELECT * FROM notifications WHERE id = ? AND user_id = ?', id, req.user.id);
  if (n) await db.run('UPDATE notifications SET is_read = 1 WHERE id = ?', id);
  const safeLink = n && n.link && n.link.startsWith('/student/') ? n.link : '/student/notifications';
  res.redirect(safeLink);
});

// ============ PROFILE ============
router.get('/profile', (req, res) => {
  res.render('student/profile', { title: 'My Profile', active: 'profile' });
});

router.post('/profile', async (req, res) => {
  const phone = (req.body.phone || '').trim();
  if (phone && !/^[0-9+\-\s()]{7,20}$/.test(phone)) {
    req.flash('error', 'Enter a valid phone number, or leave it empty.');
    return res.redirect('/student/profile');
  }
  await db.run(`UPDATE users SET phone = ?, updated_at = ${NOW} WHERE id = ?`, phone || null, req.user.id);
  await audit(req, 'PROFILE_UPDATE', 'Phone updated');
  req.flash('success', 'Your profile was updated.');
  res.redirect('/student/profile');
});

router.post('/password', async (req, res) => {
  const current = req.body.current_password || '';
  const next = req.body.new_password || '';
  const confirm = req.body.confirm_password || '';

  const row = await db.get('SELECT password_hash, session_version FROM users WHERE id = ?', req.user.id);
  const fail = (msg) => {
    req.flash('error', msg);
    res.redirect('/student/profile');
  };

  if (!(await bcrypt.compare(current, row.password_hash))) return fail('Your current password is incorrect.');
  if (next.length < 8) return fail('New password must be at least 8 characters.');
  if (next.length > 72) return fail('New password must be 72 characters or fewer.');
  if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) return fail('New password must contain both letters and numbers.');
  if (next !== confirm) return fail('The new passwords do not match.');
  if (await bcrypt.compare(next, row.password_hash)) return fail('Your new password must be different from the current one.');

  await db.run(
    `UPDATE users SET password_hash = ?, must_change_password = 0,
            session_version = session_version + 1, updated_at = ${NOW} WHERE id = ?`,
    await bcrypt.hash(next, 10), req.user.id
  );
  req.session.v = row.session_version + 1; // this device stays logged in
  await audit(req, 'PASSWORD_CHANGE', 'Password changed');
  req.flash('success', 'Your password was changed.');
  res.redirect('/student/profile');
});

module.exports = router;
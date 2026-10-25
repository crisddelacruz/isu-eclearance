const crypto = require('crypto');
const db = require('../config/database');

const PURPOSES = ['End of Semester', 'Graduation', 'Transfer', 'Leave of Absence', 'Honorable Dismissal'];

function getCurrentTerm() {
  return db.prepare('SELECT * FROM academic_terms WHERE is_current = 1').get() || null;
}

// All clearance requests of a student, newest first, with progress numbers.
function requestsFor(studentId) {
  const rows = db
    .prepare(`
      SELECT r.*, t.school_year, t.semester,
        (SELECT COUNT(*) FROM clearance_items WHERE request_id = r.id) AS total,
        (SELECT COUNT(*) FROM clearance_items WHERE request_id = r.id AND status = 'approved') AS approved,
        (SELECT COUNT(*) FROM clearance_items WHERE request_id = r.id AND status = 'pending') AS pending,
        (SELECT COUNT(*) FROM clearance_items WHERE request_id = r.id AND status = 'rejected') AS rejected
      FROM clearance_requests r
      JOIN academic_terms t ON t.id = r.term_id
      WHERE r.student_id = ?
      ORDER BY r.id DESC
    `)
    .all(studentId);
  rows.forEach((r) => {
    r.percent = r.total ? Math.round((r.approved / r.total) * 100) : 0;
  });
  return rows;
}

// The signing lines of one clearance request, in signing order.
function itemsFor(requestId) {
  return db
    .prepare(`
      SELECT ci.*, o.name AS office_name, o.scope AS office_scope,
             e.subject_code, e.subject_title,
             TRIM(iu.first_name || ' ' || iu.last_name) AS instructor_name
      FROM clearance_items ci
      JOIN offices o ON o.id = ci.office_id
      LEFT JOIN enrollments e ON e.id = ci.enrollment_id
      LEFT JOIN users iu ON iu.id = e.instructor_id
      WHERE ci.request_id = ?
      ORDER BY o.sort_order, e.subject_code
    `)
    .all(requestId);
}

// Creates a clearance request and all its signing lines.
// Returns { id } on success or { error } with a message for the student.
function createClearance(student, term, purpose) {
  if (!PURPOSES.includes(purpose)) return { error: 'Please choose a valid purpose.' };

  const exists = db
    .prepare('SELECT 1 FROM clearance_requests WHERE student_id = ? AND term_id = ? AND purpose = ?')
    .get(student.id, term.id, purpose);
  if (exists) return { error: 'You already have a clearance request for this purpose in this term.' };

  const offices = db
    .prepare('SELECT * FROM offices WHERE is_active = 1 AND is_required = 1 ORDER BY sort_order')
    .all();
  const enrollments = db
    .prepare('SELECT * FROM enrollments WHERE student_id = ? AND term_id = ? ORDER BY subject_code')
    .all(student.id, term.id);

  if (offices.some((o) => o.scope === 'instructor')) {
    if (!enrollments.length) {
      return { error: 'Add your subjects first. Each subject needs an instructor to sign it.' };
    }
    if (enrollments.some((e) => !e.instructor_id)) {
      return { error: 'Some of your subjects have no instructor. Please fix them under My Subjects.' };
    }
  }

  const run = db.transaction(() => {
    const info = db
      .prepare(`
        INSERT INTO clearance_requests (reference_no, verification_code, student_id, term_id, purpose)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        'TMP-' + crypto.randomBytes(6).toString('hex'),
        crypto.randomBytes(5).toString('hex').toUpperCase(),
        student.id, term.id, purpose
      );
    const id = Number(info.lastInsertRowid);

    const reference = `ISU-${new Date().getFullYear()}-${String(id).padStart(6, '0')}`;
    db.prepare('UPDATE clearance_requests SET reference_no = ? WHERE id = ?').run(reference, id);

    const addItem = db.prepare(
      'INSERT INTO clearance_items (request_id, office_id, enrollment_id, signatory_id) VALUES (?, ?, ?, ?)'
    );
    offices.forEach((o) => {
      if (o.scope === 'instructor') {
        enrollments.forEach((e) => addItem.run(id, o.id, e.id, e.instructor_id));
      } else {
        // University, college, and program offices are matched to a signatory
        // at signing time (Phase 6), so signatory_id stays empty here.
        addItem.run(id, o.id, null, null);
      }
    });
    return id;
  });

  return { id: run() };
}

module.exports = { PURPOSES, getCurrentTerm, requestsFor, itemsFor, createClearance };
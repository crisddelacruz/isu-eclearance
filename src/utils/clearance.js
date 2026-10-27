const crypto = require('crypto');
const db = require('../config/database');

const PURPOSES = ['End of Semester', 'Graduation', 'Transfer', 'Leave of Absence', 'Honorable Dismissal'];

async function getCurrentTerm() {
  return (await db.get('SELECT * FROM academic_terms WHERE is_current = 1')) || null;
}

// All clearance requests of a student, newest first, with progress numbers.
async function requestsFor(studentId) {
  const rows = await db.all(
    `SELECT r.*, t.school_year, t.semester,
       (SELECT COUNT(*) FROM clearance_items WHERE request_id = r.id) AS total,
       (SELECT COUNT(*) FROM clearance_items WHERE request_id = r.id AND status = 'approved') AS approved,
       (SELECT COUNT(*) FROM clearance_items WHERE request_id = r.id AND status = 'pending') AS pending,
       (SELECT COUNT(*) FROM clearance_items WHERE request_id = r.id AND status = 'rejected') AS rejected
     FROM clearance_requests r
     JOIN academic_terms t ON t.id = r.term_id
     WHERE r.student_id = ?
     ORDER BY r.id DESC`, studentId
  );
  rows.forEach((r) => {
    r.percent = r.total ? Math.round((r.approved / r.total) * 100) : 0;
  });
  return rows;
}

// The signing lines of one clearance request, in signing order.
function itemsFor(requestId) {
  return db.all(
    `SELECT ci.*, o.name AS office_name, o.scope AS office_scope,
            e.subject_code, e.subject_title,
            TRIM(iu.first_name || ' ' || iu.last_name) AS instructor_name
     FROM clearance_items ci
     JOIN offices o ON o.id = ci.office_id
     LEFT JOIN enrollments e ON e.id = ci.enrollment_id
     LEFT JOIN users iu ON iu.id = e.instructor_id
     WHERE ci.request_id = ?
     ORDER BY o.sort_order, e.subject_code`, requestId
  );
}

// Everything the printed clearance template needs.
async function sheetFor(requestId) {
  const request = await db.get(
    `SELECT r.*, t.school_year, t.semester
     FROM clearance_requests r JOIN academic_terms t ON t.id = r.term_id
     WHERE r.id = ?`, requestId
  );
  if (!request) return null;

  const student = await db.get(
    `SELECT u.id, u.id_number, u.first_name, u.middle_name, u.last_name, u.suffix, u.year_level,
            c.name AS college_name, p.name AS program_name, p.code AS program_code
     FROM users u
     LEFT JOIN colleges c ON c.id = u.college_id
     LEFT JOIN programs p ON p.id = u.program_id
     WHERE u.id = ?`, request.student_id
  );

  const settings = {};
  (await db.all('SELECT key, value FROM settings')).forEach((s) => { settings[s.key] = s.value; });

  return { request, student, items: await itemsFor(requestId), settings };
}

// Creates a clearance request and all its signing lines.
// Returns { id } on success or { error } with a message for the student.
async function createClearance(student, term, purpose) {
  if (!PURPOSES.includes(purpose)) return { error: 'Please choose a valid purpose.' };

  const exists = await db.get(
    'SELECT 1 AS x FROM clearance_requests WHERE student_id = ? AND term_id = ? AND purpose = ?',
    student.id, term.id, purpose
  );
  if (exists) return { error: 'You already have a clearance request for this purpose in this term.' };

  const offices = await db.all(
    'SELECT * FROM offices WHERE is_active = 1 AND is_required = 1 ORDER BY sort_order'
  );
  const enrollments = await db.all(
    'SELECT * FROM enrollments WHERE student_id = ? AND term_id = ? ORDER BY subject_code',
    student.id, term.id
  );

  if (offices.some((o) => o.scope === 'instructor')) {
    if (!enrollments.length) {
      return { error: 'Add your subjects first. Each subject needs an instructor to sign it.' };
    }
    if (enrollments.some((e) => !e.instructor_id)) {
      return { error: 'Some of your subjects have no instructor. Please fix them under My Subjects.' };
    }
  }

  const id = await db.tx(async (t) => {
    const info = await t.run(
      `INSERT INTO clearance_requests (reference_no, verification_code, student_id, term_id, purpose)
       VALUES (?, ?, ?, ?, ?)`,
      'TMP-' + crypto.randomBytes(6).toString('hex'),
      crypto.randomBytes(5).toString('hex').toUpperCase(),
      student.id, term.id, purpose
    );
    const rid = info.lastId;

    const year = new Date(Date.now() + 8 * 3600 * 1000).getUTCFullYear();
    await t.run('UPDATE clearance_requests SET reference_no = ? WHERE id = ?',
      `ISU-${year}-${String(rid).padStart(6, '0')}`, rid);

    for (const o of offices) {
      if (o.scope === 'instructor') {
        for (const e of enrollments) {
          await t.run(
            'INSERT INTO clearance_items (request_id, office_id, enrollment_id, signatory_id) VALUES (?, ?, ?, ?)',
            rid, o.id, e.id, e.instructor_id
          );
        }
      } else {
        // University, college, and program offices are matched to a signatory
        // when someone signs, so signatory_id stays empty here.
        await t.run(
          'INSERT INTO clearance_items (request_id, office_id, enrollment_id, signatory_id) VALUES (?, ?, NULL, NULL)',
          rid, o.id
        );
      }
    }
    return rid;
  });

  return { id };
}

module.exports = { PURPOSES, getCurrentTerm, requestsFor, itemsFor, sheetFor, createClearance };
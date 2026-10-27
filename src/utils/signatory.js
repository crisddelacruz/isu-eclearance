const db = require('../config/database');

// Finds the clearance lines that wait for ONE signatory.
//   instructor : the line was assigned to this exact instructor
//   university : the signatory's office matches
//   college    : office matches AND the student is in the signatory's college
//   program    : office matches AND the student is in the signatory's program
const MATCH = `
  FROM clearance_items ci
  JOIN clearance_requests r ON r.id = ci.request_id
  JOIN users s ON s.id = r.student_id
  JOIN offices o ON o.id = ci.office_id
  JOIN academic_terms t ON t.id = r.term_id
  LEFT JOIN programs p ON p.id = s.program_id
  LEFT JOIN enrollments e ON e.id = ci.enrollment_id
  WHERE r.status = 'in_progress'
    AND ci.status = 'pending'
    AND (
         (o.scope = 'instructor' AND ci.signatory_id = @uid)
      OR (o.scope = 'university' AND ci.office_id = @office)
      OR (o.scope = 'college'    AND ci.office_id = @office AND s.college_id = @college)
      OR (o.scope = 'program'    AND ci.office_id = @office AND s.program_id = @program)
    )
    AND (@search = ''
         OR s.last_name  LIKE '%' || @search || '%'
         OR s.first_name LIKE '%' || @search || '%'
         OR s.id_number  LIKE '%' || @search || '%')
`;

function params(user, search) {
  return {
    uid: user.id,
    office: user.office_id || -1,
    college: user.college_id || -1,
    program: user.program_id || -1,
    search: search || '',
  };
}

// Pending lines for this signatory, oldest request first.
function pendingFor(user, { search = '', limit = 50 } = {}) {
  return db
    .prepare(`
      SELECT ci.id AS item_id, r.id AS request_id, r.reference_no, r.purpose,
             r.created_at AS requested_at,
             s.id_number, s.last_name || ', ' || s.first_name AS student_name, s.year_level,
             p.code AS program_code,
             o.name AS office_name, o.scope AS office_scope,
             e.subject_code, e.subject_title,
             t.school_year, t.semester
      ${MATCH}
      ORDER BY r.created_at ASC, ci.id ASC
      LIMIT @limit
    `)
    .all({ ...params(user, search), limit });
}

function countPending(user) {
  return db.prepare(`SELECT COUNT(*) AS n ${MATCH}`).get(params(user, '')).n;
}

// One line that this signatory is allowed to act on right now (or undefined).
function findActionable(user, itemId) {
  return db
    .prepare(`
      SELECT ci.id AS item_id, ci.request_id, ci.status, ci.remarks, ci.acted_at,
             r.reference_no, r.purpose, r.student_id,
             s.id_number, s.last_name || ', ' || s.first_name AS student_name, s.year_level,
             p.code AS program_code,
             o.name AS office_name, o.scope AS office_scope,
             e.subject_code, e.subject_title,
             t.school_year, t.semester, r.created_at AS requested_at
      ${MATCH}
      AND ci.id = @item
    `)
    .get({ ...params(user, ''), item: itemId });
}

// A line the signatory may open: either waiting for them, or already acted on by them.
function findItem(user, itemId) {
  const act = findActionable(user, itemId);
  if (act) return { item: act, canAct: true };

  const own = db
    .prepare(`
      SELECT ci.id AS item_id, ci.request_id, ci.status, ci.remarks, ci.acted_at,
             r.reference_no, r.purpose, r.student_id, r.created_at AS requested_at,
             s.id_number, s.last_name || ', ' || s.first_name AS student_name, s.year_level,
             p.code AS program_code,
             o.name AS office_name, o.scope AS office_scope,
             e.subject_code, e.subject_title,
             t.school_year, t.semester
      FROM clearance_items ci
      JOIN clearance_requests r ON r.id = ci.request_id
      JOIN users s ON s.id = r.student_id
      JOIN offices o ON o.id = ci.office_id
      JOIN academic_terms t ON t.id = r.term_id
      LEFT JOIN programs p ON p.id = s.program_id
      LEFT JOIN enrollments e ON e.id = ci.enrollment_id
      WHERE ci.id = ? AND ci.signatory_id = ?
    `)
    .get(itemId, user.id);
  return own ? { item: own, canAct: false } : null;
}

// Numbers for the dashboard tiles.
function stats(user) {
  const out = { pending: countPending(user), approved: 0, rejected: 0 };
  db.prepare(`
    SELECT status, COUNT(*) AS n FROM clearance_items
    WHERE signatory_id = ? AND status IN ('approved','rejected') GROUP BY status
  `).all(user.id).forEach((r) => { out[r.status] = r.n; });
  return out;
}

// Everything this signatory already acted on, newest first.
function historyFor(user, limit = 100) {
  return db
    .prepare(`
      SELECT ci.id, ci.status, ci.remarks, ci.acted_at,
             r.reference_no, r.purpose,
             s.id_number, s.last_name || ', ' || s.first_name AS student_name,
             o.name AS office_name, e.subject_code
      FROM clearance_items ci
      JOIN clearance_requests r ON r.id = ci.request_id
      JOIN users s ON s.id = r.student_id
      JOIN offices o ON o.id = ci.office_id
      LEFT JOIN enrollments e ON e.id = ci.enrollment_id
      WHERE ci.signatory_id = ? AND ci.status IN ('approved','rejected')
      ORDER BY ci.acted_at DESC, ci.id DESC
      LIMIT ?
    `)
    .all(user.id, limit);
}

module.exports = { pendingFor, countPending, findActionable, findItem, stats, historyFor };
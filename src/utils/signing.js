const db = require('../config/database');
const { findActionable } = require('./signatory');
const { notify } = require('./notify');

// "Juan S. Dela Cruz Jr." as printed under the signature
function signerName(u) {
  const mi = u.middle_name && u.middle_name.trim() ? u.middle_name.trim()[0] + '.' : '';
  return [u.first_name, mi, u.last_name, u.suffix].filter(Boolean).join(' ');
}

// Approves ONE line for this signatory and stamps their e-signature on it.
// Returns { ok: true, completed } or { error }.
function approveItem(user, itemId) {
  if (!user.signature_path) return { error: 'no_signature' };

  const run = db.transaction(() => {
    const item = findActionable(user, itemId);
    if (!item) return { error: 'This request is no longer waiting for you.' };

    // The signature file name is COPIED onto the line, so changing your
    // signature later never changes a clearance you already signed.
    db.prepare(`
      UPDATE clearance_items
      SET status = 'approved', signatory_id = ?, acted_at = datetime('now','localtime'),
          remarks = NULL, signed_name = ?, signed_position = ?, signature_path = ?
      WHERE id = ? AND status = 'pending'
    `).run(
      user.id, signerName(user), user.position_title || user.office_name || '',
      user.signature_path, item.item_id
    );

    const left = db
      .prepare("SELECT COUNT(*) AS n FROM clearance_items WHERE request_id = ? AND status != 'approved'")
      .get(item.request_id).n;

    const what = item.office_name + (item.subject_code ? ' (' + item.subject_code + ')' : '');
    notify(
      item.student_id,
      what + ' signed your clearance',
      'Your ' + item.purpose + ' clearance was approved by ' + what + '.',
      '/student/clearance/' + item.request_id
    );

    let completed = false;
    if (left === 0) {
      db.prepare(`
        UPDATE clearance_requests
        SET status = 'completed', completed_at = datetime('now','localtime') WHERE id = ?
      `).run(item.request_id);
      notify(
        item.student_id,
        'Your clearance is complete',
        'Every office has signed your ' + item.purpose + ' clearance. You can now use it.',
        '/student/clearance/' + item.request_id
      );
      completed = true;
    }
    return { ok: true, item, completed };
  });

  return run();
}

// Returns ONE line to the student with remarks.
function returnItem(user, itemId, remarks) {
  const run = db.transaction(() => {
    const item = findActionable(user, itemId);
    if (!item) return { error: 'This request is no longer waiting for you.' };

    db.prepare(`
      UPDATE clearance_items
      SET status = 'rejected', signatory_id = ?, acted_at = datetime('now','localtime'), remarks = ?
      WHERE id = ? AND status = 'pending'
    `).run(user.id, remarks, item.item_id);

    const what = item.office_name + (item.subject_code ? ' (' + item.subject_code + ')' : '');
    notify(
      item.student_id,
      what + ' returned your clearance',
      'Remarks: ' + remarks,
      '/student/clearance/' + item.request_id
    );
    return { ok: true, item };
  });

  return run();
}

module.exports = { approveItem, returnItem };
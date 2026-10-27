const db = require('../config/database');
const { findActionable } = require('./signatory');
const { notify } = require('./notify');

// "Juan S. Dela Cruz Jr." as printed under the signature
function signerName(u) {
  const mi = u.middle_name && u.middle_name.trim() ? u.middle_name.trim()[0] + '.' : '';
  return [u.first_name, mi, u.last_name, u.suffix].filter(Boolean).join(' ');
}

const NOW = "datetime('now','+8 hours')";

// Approves ONE line for this signatory and stamps their e-signature on it.
// Returns { ok: true, completed } or { error }.
async function approveItem(user, itemId) {
  if (!user.signature_path) return { error: 'no_signature' };

  const out = await db.tx(async (t) => {
    const item = await findActionable(user, itemId, t);
    if (!item) return { error: 'This request is no longer waiting for you.' };

    // The signature file name is COPIED onto the line, so changing your
    // signature later never changes a clearance you already signed.
    const upd = await t.run(
      `UPDATE clearance_items
       SET status = 'approved', signatory_id = ?, acted_at = ${NOW},
           remarks = NULL, signed_name = ?, signed_position = ?, signature_path = ?
       WHERE id = ? AND status = 'pending'`,
      user.id, signerName(user), user.position_title || user.office_name || '',
      user.signature_path, item.item_id
    );
    if (!upd.changes) return { error: 'This request is no longer waiting for you.' };

    const left = (await t.get(
      "SELECT COUNT(*) AS n FROM clearance_items WHERE request_id = ? AND status != 'approved'",
      item.request_id
    )).n;

    let completed = false;
    if (left === 0) {
      await t.run(
        `UPDATE clearance_requests SET status = 'completed', completed_at = ${NOW} WHERE id = ?`,
        item.request_id
      );
      completed = true;
    }
    return { ok: true, item, completed };
  });

  if (out.ok) {
    const item = out.item;
    const what = item.office_name + (item.subject_code ? ' (' + item.subject_code + ')' : '');
    await notify(
      item.student_id,
      what + ' signed your clearance',
      'Your ' + item.purpose + ' clearance was approved by ' + what + '.',
      '/student/clearance/' + item.request_id
    );
    if (out.completed) {
      await notify(
        item.student_id,
        'Your clearance is complete',
        'Every office has signed your ' + item.purpose + ' clearance. You can now use it.',
        '/student/clearance/' + item.request_id
      );
    }
  }
  return out;
}

// Returns ONE line to the student with remarks.
async function returnItem(user, itemId, remarks) {
  const out = await db.tx(async (t) => {
    const item = await findActionable(user, itemId, t);
    if (!item) return { error: 'This request is no longer waiting for you.' };

    const upd = await t.run(
      `UPDATE clearance_items
       SET status = 'rejected', signatory_id = ?, acted_at = ${NOW}, remarks = ?
       WHERE id = ? AND status = 'pending'`,
      user.id, remarks, item.item_id
    );
    if (!upd.changes) return { error: 'This request is no longer waiting for you.' };
    return { ok: true, item };
  });

  if (out.ok) {
    const item = out.item;
    const what = item.office_name + (item.subject_code ? ' (' + item.subject_code + ')' : '');
    await notify(
      item.student_id,
      what + ' returned your clearance',
      'Remarks: ' + remarks,
      '/student/clearance/' + item.request_id
    );
  }
  return out;
}

module.exports = { approveItem, returnItem };
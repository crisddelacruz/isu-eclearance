const db = require('../config/database');
const { enabled: mailOn, sendMail } = require('./mailer');
const { baseUrl } = require('./url');

const insert = db.prepare(
  'INSERT INTO notifications (user_id, title, message, link) VALUES (?, ?, ?, ?)'
);
const findUser = db.prepare("SELECT email, first_name FROM users WHERE id = ? AND status = 'active'");

// Sends an in-app notification (and an email if SMTP is set up).
// Never crashes the app if it fails.
function notify(userId, title, message, link) {
  try {
    insert.run(userId, title, message || null, link || null);
  } catch (err) {
    console.error('Notify failed:', err.message);
    return;
  }

  if (!mailOn) return;
  try {
    const u = findUser.get(userId);
    if (!u || /@isu-demo\.local$/i.test(u.email)) return;
    const body =
      'Hello ' + u.first_name + ',\n\n' +
      title + '\n' + (message ? message + '\n' : '') +
      '\nOpen ISU eClearance: ' + baseUrl() + (link || '/dashboard') +
      '\n\n(This is an automatic message from ISU eClearance.)';
    sendMail(u.email, '[ISU eClearance] ' + title, body); // not awaited, errors are handled inside
  } catch (err) {
    console.error('Notify email failed:', err.message);
  }
}

// Tells every signatory who must sign a pending line of this request.
// If itemId is given, only that one line is considered.
function notifySignatories(requestId, itemId, title) {
  try {
    const info = db
      .prepare(`
        SELECT r.purpose, s.first_name, s.last_name
        FROM clearance_requests r JOIN users s ON s.id = r.student_id
        WHERE r.id = ?
      `)
      .get(requestId);
    if (!info) return;

    const people = db
      .prepare(`
        SELECT DISTINCT u.id
        FROM clearance_items ci
        JOIN clearance_requests r ON r.id = ci.request_id
        JOIN users s ON s.id = r.student_id
        JOIN offices o ON o.id = ci.office_id
        JOIN users u ON u.role = 'signatory' AND u.status = 'active' AND (
             (o.scope = 'instructor' AND u.id = ci.signatory_id)
          OR (o.scope = 'university' AND u.office_id = ci.office_id)
          OR (o.scope = 'college'    AND u.office_id = ci.office_id AND u.college_id = s.college_id)
          OR (o.scope = 'program'    AND u.office_id = ci.office_id AND u.program_id = s.program_id)
        )
        WHERE ci.request_id = @request AND ci.status = 'pending'
          AND (@item IS NULL OR ci.id = @item)
      `)
      .all({ request: requestId, item: itemId || null });

    people.forEach((p) =>
      notify(
        p.id,
        title || 'New clearance request',
        info.first_name + ' ' + info.last_name + ' is waiting for your signature (' + info.purpose + ').',
        '/signatory/requests'
      )
    );
  } catch (err) {
    console.error('notifySignatories failed:', err.message);
  }
}

module.exports = { notify, notifySignatories };
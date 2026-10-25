const db = require('../config/database');

const insert = db.prepare(
  'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)'
);

// Records who did what. Never crashes the app if logging fails.
function audit(req, action, details, userId) {
  try {
    const uid = userId || (req.session && req.session.userId) || null;
    insert.run(uid, action, details || null, req.ip || null);
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
}

module.exports = audit;
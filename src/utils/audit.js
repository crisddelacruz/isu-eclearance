const db = require('../config/database');

// Records who did what. Never crashes the app if logging fails.
// Always use:  await audit(req, 'ACTION', 'details');
async function audit(req, action, details, userId) {
  try {
    const uid = userId || (req.session && req.session.userId) || null;
    await db.run(
      'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      uid, action, details || null, req.ip || null
    );
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
}

module.exports = audit;
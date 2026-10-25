const db = require('../config/database');

const insert = db.prepare(
  'INSERT INTO notifications (user_id, title, message, link) VALUES (?, ?, ?, ?)'
);

// Sends an in-app notification. Never crashes the app if it fails.
function notify(userId, title, message, link) {
  try {
    insert.run(userId, title, message || null, link || null);
  } catch (err) {
    console.error('Notify failed:', err.message);
  }
}

module.exports = { notify };
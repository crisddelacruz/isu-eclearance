const express = require('express');
const db = require('../config/database');
const sig = require('../utils/signature');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Signature images are private. Only these people may see an image:
//   admin      : any signature
//   owner      : their own current signature
//   student    : signatures printed on their own clearance
//   signatory  : their own, or any signature already printed on a clearance
router.get('/files/signature/:name', requireAuth, async (req, res) => {
  const name = req.params.name;
  const u = req.user;
  let allowed = false;

  if (sig.NAME_RE.test(name)) {
    if (u.role === 'admin') allowed = true;
    else if (u.signature_path === name) allowed = true;
    else if (u.role === 'student') {
      allowed = !!(await db.get(
        `SELECT 1 AS x FROM clearance_items ci
         JOIN clearance_requests r ON r.id = ci.request_id
         WHERE ci.signature_path = ? AND r.student_id = ? LIMIT 1`, name, u.id
      ));
    } else if (u.role === 'signatory') {
      allowed = !!(await db.get('SELECT 1 AS x FROM clearance_items WHERE signature_path = ? LIMIT 1', name));
    }
  }

  const file = allowed ? await sig.getFile(name) : null;
  if (!file) {
    return res.status(404).render('error', {
      title: 'Not found', code: 404, heading: 'Not found',
      message: 'We could not find what you were looking for.',
    });
  }

  res.set({
    'Content-Type': file.mime,
    'Content-Length': file.buffer.length,
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(file.buffer);
});

module.exports = router;
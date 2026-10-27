const express = require('express');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const db = require('../config/database');
const { sheetFor } = require('../utils/clearance');
const { verifyUrlFor } = require('../utils/url');

const router = express.Router();

// Verification codes are 10 characters (0-9, A-F).
const CODE_RE = /^[A-F0-9]{10}$/;

const limiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).render('error', {
      title: 'Too many attempts', code: 429, heading: 'Too many attempts',
      message: 'Please wait a few minutes and try again.',
    }),
});

async function findRequestId(code) {
  if (!CODE_RE.test(code)) return null;
  const row = await db.get('SELECT id FROM clearance_requests WHERE verification_code = ?', code);
  return row ? row.id : null;
}

// "2026-00123" becomes "20******23"
function maskId(id) {
  if (!id) return '-';
  if (id.length <= 4) return '****';
  return id.slice(0, 2) + '*'.repeat(id.length - 4) + id.slice(-2);
}

// ---------- Verify page (type a code) ----------
router.get('/verify', limiter, (req, res) => {
  const code = String(req.query.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code) return res.redirect('/verify/' + code);
  res.render('verify/index', { title: 'Verify a Clearance' });
});

// ---------- QR image (public) ----------
router.get('/verify/:code/qr.png', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  if (!(await findRequestId(code))) return res.status(404).end();
  const png = await QRCode.toBuffer(verifyUrlFor(code), { type: 'png', width: 300, margin: 1, errorCorrectionLevel: 'M' });
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
  res.end(png);
});

// ---------- Result page (public) ----------
router.get('/verify/:code', limiter, async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const id = await findRequestId(code);
  const sheet = id ? await sheetFor(id) : null;

  res.status(sheet ? 200 : 404).render('verify/result', {
    title: 'Verification Result',
    code,
    sheet,
    maskedId: sheet ? maskId(sheet.student.id_number) : '',
  });
});

module.exports = router;
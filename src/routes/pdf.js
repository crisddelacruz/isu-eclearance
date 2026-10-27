const express = require('express');
const db = require('../config/database');
const audit = require('../utils/audit');
const { sheetFor } = require('../utils/clearance');
const { buildClearancePdf } = require('../utils/pdf');
const { verifyUrlFor } = require('../utils/url');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Students download the PDF of their OWN completed clearance.
router.get('/student/clearance/:id/pdf', requireRole('student'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const own = id
      ? db
          .prepare('SELECT id, status, reference_no, verification_code FROM clearance_requests WHERE id = ? AND student_id = ?')
          .get(id, req.user.id)
      : null;

    if (!own) {
      return res.status(404).render('error', {
        title: 'Not found', code: 404, heading: 'Not found',
        message: 'We could not find what you were looking for.',
      });
    }
    if (own.status !== 'completed') {
      req.flash('error', 'You can download the PDF once every office has signed your clearance.');
      return res.redirect('/student/clearance/' + own.id);
    }

    const pdf = await buildClearancePdf(sheetFor(own.id), verifyUrlFor(own.verification_code));
    audit(req, 'CLEARANCE_PDF', 'Request #' + own.id);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdf.length,
      'Content-Disposition': 'attachment; filename="ISU-Clearance-' + own.reference_no + '.pdf"',
      'Cache-Control': 'private, no-store',
    });
    res.end(pdf);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
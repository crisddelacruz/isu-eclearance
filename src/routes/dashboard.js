const express = require('express');
const { requireAuth, requireRole, homeFor } = require('../middleware/auth');

const router = express.Router();

// /dashboard sends each person to the right dashboard for their role
router.get('/dashboard', requireAuth, (req, res) => res.redirect(homeFor(req.user.role)));

// Temporary placeholder pages. We replace them with real dashboards later.
router.get('/student/dashboard', requireRole('student'), (req, res) => {
  res.render('dashboard-placeholder', {
    title: 'Student Dashboard',
    phaseNote: 'The full student dashboard is built in Phase 5.',
  });
});

router.get('/signatory/dashboard', requireRole('signatory'), (req, res) => {
  res.render('dashboard-placeholder', {
    title: 'Signatory Dashboard',
    phaseNote: 'The full signatory dashboard is built in Phase 6.',
  });
});

router.get('/admin/dashboard', requireRole('admin'), (req, res) => {
  res.render('dashboard-placeholder', {
    title: 'Admin Dashboard',
    phaseNote: 'The full admin dashboard is built in Phase 9.',
  });
});

module.exports = router;
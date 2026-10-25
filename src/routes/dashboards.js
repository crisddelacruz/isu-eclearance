const express = require('express');
const { requireAuth, requireRole, homeFor } = require('../middleware/auth');

const router = express.Router();

// /dashboard sends each person to the right dashboard for their role
router.get('/dashboard', requireAuth, (req, res) => res.redirect(homeFor(req.user.role)));

// Temporary placeholder pages. We replace them in later phases.
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
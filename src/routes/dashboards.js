const express = require('express');
const { requireAuth, homeFor } = require('../middleware/auth');

const router = express.Router();

// /dashboard sends each person to the right dashboard for their role
router.get('/dashboard', requireAuth, (req, res) => res.redirect(homeFor(req.user.role)));

module.exports = router;
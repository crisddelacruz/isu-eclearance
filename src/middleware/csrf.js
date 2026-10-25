const crypto = require('crypto');

// Blocks forged form submissions from other websites.
module.exports = function csrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const sent =
    (req.body && req.body._csrf) || req.get('x-csrf-token') || req.query._csrf || '';
  const a = Buffer.from(String(sent));
  const b = Buffer.from(req.session.csrfToken);

  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();

  res.status(403).render('error', {
    title: 'Security check failed',
    code: 403,
    heading: 'Security check failed',
    message: 'Your form expired or was invalid. Please go back, refresh the page, and try again.',
  });
};
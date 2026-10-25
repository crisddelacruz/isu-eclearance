const db = require('../config/database');

const HOME = {
  student: '/student/dashboard',
  signatory: '/signatory/dashboard',
  admin: '/admin/dashboard',
};
const homeFor = (role) => HOME[role] || '/login';

const findUser = db.prepare(`
  SELECT u.*,
         c.code AS college_code, c.name AS college_name,
         p.code AS program_code, p.name AS program_name,
         o.code AS office_code,  o.name AS office_name, o.scope AS office_scope
  FROM users u
  LEFT JOIN colleges c ON c.id = u.college_id
  LEFT JOIN programs p ON p.id = u.program_id
  LEFT JOIN offices  o ON o.id = u.office_id
  WHERE u.id = ?
`);
const countUnread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0');

// Runs on every request: finds the logged-in user (if any).
function loadUser(req, res, next) {
  req.user = null;
  res.locals.currentUser = null;
  res.locals.unreadCount = 0;
  const id = req.session.userId;
  if (id) {
    const u = findUser.get(id);
    if (u && u.status === 'active') {
      delete u.password_hash; // never expose the hash to pages
      req.user = u;
      res.locals.currentUser = u;
      res.locals.unreadCount = countUnread.get(u.id).n;
    } else {
      delete req.session.userId; // user was deleted or disabled
    }
  }
  next();
}

// Must be logged in.
function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  req.flash('error', 'Please log in to continue.');
  res.redirect('/login');
}

// Must be logged in AND have one of the given roles.
function requireRole(...roles) {
  return [
    requireAuth,
    (req, res, next) => {
      if (roles.includes(req.user.role)) return next();
      res.status(403).render('error', {
        title: 'Access denied',
        code: 403,
        heading: 'Access denied',
        message: 'You do not have permission to open this page.',
      });
    },
  ];
}

// Login/register pages are only for visitors who are NOT logged in.
function guestOnly(req, res, next) {
  if (req.user) return res.redirect(homeFor(req.user.role));
  next();
}

module.exports = { loadUser, requireAuth, requireRole, guestOnly, homeFor };
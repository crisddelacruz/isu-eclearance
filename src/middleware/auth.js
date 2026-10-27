const db = require('../config/database');

const HOME = {
  student: '/student/dashboard',
  signatory: '/signatory/dashboard',
  admin: '/admin/dashboard',
};
const homeFor = (role) => HOME[role] || '/login';

// Runs on every request: finds the logged-in user (if any).
// The cookie holds the user id and a "session version". If the version no longer
// matches, the user was signed out by a password change or an admin action.
async function loadUser(req, res, next) {
  req.user = null;
  res.locals.currentUser = null;
  res.locals.unreadCount = 0;

  const id = req.session.userId;
  if (!id) return next();

  try {
    const u = await db.get(
      `SELECT u.*,
              c.code AS college_code, c.name AS college_name,
              p.code AS program_code, p.name AS program_name,
              o.code AS office_code,  o.name AS office_name, o.scope AS office_scope,
              (SELECT COUNT(*) FROM notifications n WHERE n.user_id = u.id AND n.is_read = 0) AS unread
       FROM users u
       LEFT JOIN colleges c ON c.id = u.college_id
       LEFT JOIN programs p ON p.id = u.program_id
       LEFT JOIN offices  o ON o.id = u.office_id
       WHERE u.id = ?`, id
    );

    if (u && u.status === 'active' && u.session_version === (req.session.v || 0)) {
      delete u.password_hash; // never expose the hash to pages
      res.locals.unreadCount = u.unread;
      req.user = u;
      res.locals.currentUser = u;
    } else {
      delete req.session.userId;
      delete req.session.v;
    }
    next();
  } catch (err) {
    next(err);
  }
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
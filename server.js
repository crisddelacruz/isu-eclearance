require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieSession = require('cookie-session');

const db = require('./src/config/database');
const icon = require('./src/utils/icons');
const fmt = require('./src/utils/format');
const mailer = require('./src/utils/mailer');
const { baseUrl } = require('./src/utils/url');
const flash = require('./src/middleware/flash');
const csrf = require('./src/middleware/csrf');
const { loadUser, homeFor } = require('./src/middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';
const secret = process.env.SESSION_SECRET || '';

if (!secret || (isProd && secret.includes('change-this'))) {
  throw new Error('Set a strong SESSION_SECRET in your environment variables.');
}
if (isProd && !/^https:\/\//i.test(baseUrl())) {
  console.warn('WARNING: APP_URL should start with https:// in production (QR codes and email links use it).');
}
if (isProd) app.set('trust proxy', 1); // Vercel and other proxies

// Local development only: create the tables in the local file database.
// On Turso the tables are created once by "npm run seed:prod".
if (db.isFile) db.initSchema().catch((err) => console.error('Schema setup failed:', err.message));

// ---------- View engine ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------- Security headers ----------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'script-src-attr': ["'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': isProd ? [] : null,
      },
    },
    hsts: isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '600kb' })); // drawn signatures arrive as JSON

// ---------- Static files (on Vercel, /public is served by its CDN) ----------
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Global template variables ----------
app.use((req, res, next) => {
  res.locals.appName = process.env.APP_NAME || 'ISU eClearance';
  res.locals.appUrl = baseUrl();
  res.locals.isDev = !isProd;
  res.locals.mailEnabled = mailer.enabled;
  res.locals.icon = icon;
  res.locals.fmtDate = fmt.fmtDate;
  res.locals.fmtDateTime = fmt.fmtDateTime;
  res.locals.pillClass = fmt.pillClass;
  res.locals.statusLabel = fmt.statusLabel;
  next();
});

// ---------- Health check (no session needed) ----------
app.get('/health', async (req, res) => {
  const colleges = (await db.get('SELECT COUNT(*) AS n FROM colleges')).n;
  const programs = (await db.get('SELECT COUNT(*) AS n FROM programs')).n;
  res.json({
    status: 'ok',
    app: res.locals.appName,
    database: { type: db.isFile ? 'local file' : 'turso', colleges, programs },
    time: new Date().toISOString(),
  });
});

// ---------- Sessions: a signed cookie (no session table) ----------
app.use(
  cookieSession({
    name: 'isu.sess',
    keys: [secret],
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd, // requires HTTPS in production
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  })
);

app.use(flash);
app.use(csrf);
app.use(loadUser);

// ---------- Rate limits ----------
// On serverless hosting each instance counts separately, so these are a
// second line of defence. Add firewall rules in Vercel as well (Phase 12F).
const tooMany = (req, res) =>
  res.status(429).render('error', {
    title: 'Too many requests', code: 429, heading: 'Too many requests',
    message: 'Please wait a few minutes and try again.',
  });

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
    handler: tooMany,
  })
);
app.use(
  '/register',
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method !== 'POST',
    handler: tooMany,
  })
);

// Accounts created or reset by an admin must choose their own password first.
app.use((req, res, next) => {
  if (req.user && req.user.must_change_password &&
      req.path !== '/account/password' && req.path !== '/logout') {
    return res.redirect('/account/password');
  }
  next();
});

// ---------- Routes ----------
app.get('/', async (req, res) => {
  if (req.user) return res.redirect(homeFor(req.user.role));

  const [colleges, offices, programs] = await Promise.all([
    db.all('SELECT code, name, dean_name, email FROM colleges WHERE is_active = 1 ORDER BY name'),
    db.all('SELECT name, description FROM offices WHERE is_active = 1 ORDER BY sort_order'),
    db.get('SELECT COUNT(*) AS n FROM programs WHERE is_active = 1'),
  ]);
  res.render('index', {
    title: 'Online Clearance System', colleges, offices, programCount: programs.n,
  });
});

app.use(require('./src/routes/auth'));
app.use(require('./src/routes/reset'));
app.use(require('./src/routes/account'));
app.use(require('./src/routes/dashboards'));
app.use(require('./src/routes/files'));
app.use(require('./src/routes/verify'));
app.use(require('./src/routes/pdf'));
app.use('/student', require('./src/routes/student'));
app.use('/signatory', require('./src/routes/signatory'));
app.use('/admin', require('./src/routes/admin'));

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Page not found',
    code: 404,
    heading: 'Page not found',
    message: 'The page you are looking for does not exist or has been moved.',
  });
});

// ---------- Error handler ----------
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render('error', {
    title: 'Server error',
    code: 500,
    heading: 'Something went wrong',
    message: isProd ? 'An unexpected error occurred. Please try again later.' : err.message,
  });
});

// ---------- Start (local) / export (Vercel) ----------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✔ ${process.env.APP_NAME || 'ISU eClearance'} running at http://localhost:${PORT}`);
    console.log('✔ Database:', db.isFile ? 'local file (' + db.url + ')' : 'Turso (remote)');
    console.log(mailer.enabled ? '✔ Email is ON' : '• Email is OFF (set SMTP_HOST to turn it on)');
  });
}

module.exports = app;
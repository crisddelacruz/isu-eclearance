require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);

const db = require('./src/config/database'); // connects + creates tables
const icon = require('./src/utils/icons');
const fmt = require('./src/utils/format');
const mailer = require('./src/utils/mailer');
const { runBackup } = require('./src/utils/backup');
const { baseUrl } = require('./src/utils/url');
const flash = require('./src/middleware/flash');
const csrf = require('./src/middleware/csrf');
const { loadUser, homeFor } = require('./src/middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';
const secret = process.env.SESSION_SECRET || '';

if (!secret || (isProd && secret.includes('change-this'))) {
  throw new Error('Set a strong SESSION_SECRET in your .env file.');
}
if (isProd && !/^https:\/\//i.test(baseUrl())) {
  console.warn('WARNING: APP_URL should start with https:// in production (QR codes and email links use it).');
}
if (isProd) app.set('trust proxy', 1); // when behind a reverse proxy (Nginx, etc.)

// ---------- View engine ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------- Security headers ----------
// Scripts may only come from this site. Inline event attributes (onclick="...")
// are still allowed because some buttons use them.
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

// ---------- Static files ----------
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Global template variables ----------
app.use((req, res, next) => {
  res.locals.appName = process.env.APP_NAME || 'ISU eClearance';
  res.locals.appUrl = baseUrl(); // public address (used for verification links)
  res.locals.isDev = !isProd;
  res.locals.mailEnabled = mailer.enabled;
  res.locals.icon = icon; // <%- icon('home') %>
  res.locals.fmtDate = fmt.fmtDate; // <%= fmtDate(row.created_at) %>
  res.locals.fmtDateTime = fmt.fmtDateTime;
  res.locals.pillClass = fmt.pillClass; // <%= pillClass('approved') %>
  res.locals.statusLabel = fmt.statusLabel;
  next();
});

// ---------- Health check (no session needed) ----------
app.get('/health', (req, res) => {
  const colleges = db.prepare('SELECT COUNT(*) AS n FROM colleges').get().n;
  const programs = db.prepare('SELECT COUNT(*) AS n FROM programs').get().n;
  res.json({
    status: 'ok',
    app: res.locals.appName,
    database: { colleges, programs },
    time: new Date().toISOString(),
  });
});

// ---------- Sessions (stored in the SQLite database) ----------
app.use(
  session({
    name: 'isu.sid',
    store: new SqliteStore({
      client: db,
      expired: { clear: true, intervalMs: 15 * 60 * 1000 },
    }),
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd, // requires HTTPS in production
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    },
  })
);

app.use(flash);
app.use(csrf);
app.use(loadUser);

// ---------- Rate limits ----------
const tooMany = (req, res) =>
  res.status(429).render('error', {
    title: 'Too many requests', code: 429, heading: 'Too many requests',
    message: 'Please wait a few minutes and try again.',
  });

// Every form submission (GET pages are not counted). Generous, because
// many students share the campus network address.
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

// Creating accounts: stricter
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
app.get('/', (req, res) => {
  if (req.user) return res.redirect(homeFor(req.user.role));

  const colleges = db
    .prepare('SELECT code, name, dean_name, email FROM colleges WHERE is_active = 1 ORDER BY name')
    .all();
  const offices = db
    .prepare('SELECT name, description FROM offices WHERE is_active = 1 ORDER BY sort_order')
    .all();
  const programCount = db.prepare('SELECT COUNT(*) AS n FROM programs WHERE is_active = 1').get().n;

  res.render('index', { title: 'Online Clearance System', colleges, offices, programCount });
});

app.use(require('./src/routes/auth'));
app.use(require('./src/routes/reset')); // forgot / reset password
app.use(require('./src/routes/account'));
app.use(require('./src/routes/dashboards'));
app.use(require('./src/routes/files'));
app.use(require('./src/routes/verify')); // public: verify a clearance
app.use(require('./src/routes/pdf')); // student PDF download
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

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`✔ ${process.env.APP_NAME} running at http://localhost:${PORT}`);
  console.log(mailer.enabled ? '✔ Email is ON' : '• Email is OFF (set SMTP_HOST in .env to turn it on)');

  // Daily backup: once at start-up (if today's is missing), then re-checked every 6 hours.
  if (process.env.BACKUP_ENABLED !== '0') {
    const tick = () =>
      runBackup()
        .then((r) => { if (!r.skipped) console.log('✔ Backup saved to', r.dir); })
        .catch((err) => console.error('Backup failed:', err.message));
    setTimeout(tick, 5000);
    setInterval(tick, 6 * 60 * 60 * 1000).unref();
  }
});
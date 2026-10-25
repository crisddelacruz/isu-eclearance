require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);

const db = require('./src/config/database'); // connects + creates tables
const icon = require('./src/utils/icons');
const fmt = require('./src/utils/format');
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
if (isProd) app.set('trust proxy', 1); // when behind a reverse proxy (Nginx, etc.)

// ---------- View engine ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------- Security & parsing ----------
app.use(helmet({ contentSecurityPolicy: false })); // tightened in the final phase
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---------- Static files ----------
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Global template variables ----------
app.use((req, res, next) => {
  res.locals.appName = process.env.APP_NAME || 'ISU eClearance';
  res.locals.isDev = !isProd;
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
app.use(require('./src/routes/dashboards'));
app.use('/student', require('./src/routes/student'));

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
});
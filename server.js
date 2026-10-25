require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const db = require('./src/config/database'); // connects + creates tables

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- View engine ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------- Security & parsing ----------
app.use(
  helmet({
    contentSecurityPolicy: false, // we will tighten this in the final phase
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---------- Static files (css, js, images) ----------
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Global template variables ----------
app.use((req, res, next) => {
  res.locals.appName = process.env.APP_NAME || 'ISU eClearance';
  next();
});

// ---------- Routes ----------
app.get('/', (req, res) => {
  res.render('index', { title: 'Setup Check' });
});

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

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).send('404 - Page not found');
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`✔ ${process.env.APP_NAME} running at http://localhost:${PORT}`);
});
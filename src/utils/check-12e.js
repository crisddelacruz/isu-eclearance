require('dotenv').config();
process.env.NODE_ENV = 'development';
const db = require('../config/database');
const app = require('../../server');

let fails = 0;
const ok = (cond, label) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
  if (!cond) fails++;
};

// A tiny browser: keeps cookies between requests.
function browser(base) {
  const jar = {};
  const store = (res) => {
    (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (v === '') delete jar[k]; else jar[k] = v;
    });
  };
  const header = () => Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
  return {
    async get(path) {
      const res = await fetch(base + path, { redirect: 'manual', headers: { cookie: header() } });
      store(res);
      return { status: res.status, loc: res.headers.get('location'), text: await res.text() };
    },
    async post(path, body) {
      const res = await fetch(base + path, {
        method: 'POST', redirect: 'manual',
        headers: { cookie: header(), 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
      });
      store(res);
      return { status: res.status, loc: res.headers.get('location'), text: await res.text() };
    },
  };
}
const csrfOf = (html) => (/name="_csrf" value="([a-f0-9]+)"/.exec(html) || [])[1];

async function login(b, who, pass) {
  const page = await b.get('/login');
  return b.post('/login', { _csrf: csrfOf(page.text), identifier: who, password: pass });
}

async function main() {
  if (!db.isFile) throw new Error('Run this against the LOCAL file database only.');
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;

  try {
    const anon = browser(base);
    const home = await anon.get('/');
    ok(home.status === 200 && /ISU eClearance/.test(home.text), 'landing page loads from the database');
    ok((await anon.get('/login')).status === 200, 'login page loads');
    const ver = await anon.get('/verify');
    ok(ver.status === 200 && /Verify a clearance/.test(ver.text), 'verify page loads (the fixed file)');
    ok((await anon.get('/verify/ABCDEF1234')).status === 404, 'unknown verification code gives 404');
    const health = await anon.get('/health');
    ok(/"status":"ok"/.test(health.text) && /"colleges":10/.test(health.text), 'health check shows 10 colleges');
    ok((await anon.get('/student/dashboard')).loc === '/login', 'a visitor is sent to the login page');

    // Wrong password
    const bad = await login(browser(base), 'student@isu-demo.local', 'wrong-pass1');
    ok(bad.status === 401, 'wrong password is refused');

    // Student
    const stu = browser(base);
    const r1 = await login(stu, 'student@isu-demo.local', 'Demo@12345');
    ok(r1.status === 302 && r1.loc === '/student/dashboard', 'student logs in and is sent to the student dashboard');
    const dash = await stu.get('/student/dashboard');
    ok(dash.status === 200 && /Welcome, Juan/.test(dash.text), 'student dashboard shows the right student');
    ok((await stu.get('/admin/dashboard')).status === 403, 'a student cannot open the admin area');
    ok((await stu.get('/signatory/dashboard')).status === 403, 'a student cannot open the signatory area');

    // Request a clearance through the real form
    const page = await stu.get('/student/clearance');
    const made = await stu.post('/student/clearance/request', { _csrf: csrfOf(page.text), purpose: 'End of Semester' });
    ok(made.status === 302 && /\/student\/clearance\/\d+/.test(made.loc), 'student requests a clearance');
    const detail = await stu.get(made.loc);
    ok(detail.status === 200 && /0 of 12 signatures/.test(detail.text), 'clearance page shows 0 of 12 signatures');

    // Signatory: sees the request, queue count is right
    const lib = browser(base);
    await login(lib, 'library@isu-demo.local', 'Demo@12345');
    const q = await lib.get('/signatory/requests');
    ok(q.status === 200 && /Dela Cruz/.test(q.text), 'Library signatory sees the student in the queue');

    // Admin
    const adm = browser(base);
    const ra = await login(adm, 'admin@isu-demo.local', 'Admin@12345');
    ok(ra.loc === '/admin/dashboard', 'admin logs in');
    for (const p of ['/admin/dashboard', '/admin/users', '/admin/offices', '/admin/terms', '/admin/reports', '/admin/audit', '/admin/settings']) {
      const r = await adm.get(p);
      ok(r.status === 200, 'admin page opens: ' + p);
    }
    ok((await adm.get('/admin/reports/export.csv')).status === 200, 'report CSV export works');

    // Signing a user out everywhere: raise the session version
    const stu2 = browser(base);
    await login(stu2, 'student@isu-demo.local', 'Demo@12345');
    ok((await stu2.get('/student/dashboard')).status === 200, 'second device is logged in');
    await db.run("UPDATE users SET session_version = session_version + 1 WHERE email = 'student@isu-demo.local'");
    const after = await stu2.get('/student/dashboard');
    ok(after.status === 302 && after.loc === '/login', 'raising session_version signs the old cookie out');

    // A tampered cookie is rejected
    const t = browser(base);
    await t.get('/login');
    ok((await t.post('/login', { identifier: 'x', password: 'y' })).status === 403, 'a form without a security token is refused');
  } finally {
    server.close();
  }

  console.log(fails ? '\n' + fails + ' check(s) FAILED.' : '\nAll checks passed.');
  console.log('Run "npm run db:reset" to clear this test data.');
}

main()
  .then(() => process.exit(fails ? 1 : 0))
  .catch((err) => {
    console.error('Check crashed:', err);
    process.exit(1);
  });
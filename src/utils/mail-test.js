require('dotenv').config();
const { enabled, sendMail } = require('./mailer');

const to = process.argv[2];
if (!enabled) {
  console.log('Email is OFF. Fill in SMTP_HOST (and the other SMTP_ lines) in .env first.');
  process.exit(1);
}
if (!to) {
  console.log('Usage: npm run mail:test you@example.com');
  process.exit(1);
}
sendMail(to, 'ISU eClearance test email', 'If you can read this, email is working.').then((ok) => {
  console.log(ok ? 'Sent. Check the inbox (and spam folder).' : 'Failed. See the error above.');
  process.exit(ok ? 0 : 1);
});
const nodemailer = require('nodemailer');

const enabled = !!process.env.SMTP_HOST;
let transport = null;

if (enabled) {
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

// Sends a plain-text email. Never throws: resolves true or false.
async function sendMail(to, subject, text) {
  if (!enabled) return false;
  try {
    await transport.sendMail({
      from: process.env.MAIL_FROM || 'ISU eClearance <no-reply@localhost>',
      to,
      subject: String(subject).replace(/[\r\n]+/g, ' ').slice(0, 150),
      text,
    });
    return true;
  } catch (err) {
    console.error('Mail failed:', err.message);
    return false;
  }
}

module.exports = { enabled, sendMail };
// Builds the public address that goes inside the QR code and emails.
function baseUrl() {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL
    : '';
  const fallback = vercel || 'http://localhost:' + (process.env.PORT || 3000);
  return String(process.env.APP_URL || fallback).replace(/\/+$/, '');
}

const verifyUrlFor = (code) => baseUrl() + '/verify/' + code;

module.exports = { baseUrl, verifyUrlFor };
// Builds the public address that goes inside the QR code.
function baseUrl() {
  const fallback = 'http://localhost:' + (process.env.PORT || 3000);
  return String(process.env.APP_URL || fallback).replace(/\/+$/, '');
}

const verifyUrlFor = (code) => baseUrl() + '/verify/' + code;

module.exports = { baseUrl, verifyUrlFor };
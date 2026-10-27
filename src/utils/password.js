const crypto = require('crypto');

// Returns an error message, or '' if the password is acceptable.
function check(p) {
  p = String(p || '');
  if (p.length < 8) return 'Password must be at least 8 characters.';
  if (p.length > 72) return 'Password must be 72 characters or fewer.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Password must contain both letters and numbers.';
  return '';
}

// A random temporary password such as "KmQxTe4827" (no look-alike characters).
function generateTemp() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const pick = (s) => s[crypto.randomInt(s.length)];
  const chars = [];
  for (let i = 0; i < 6; i++) chars.push(pick(letters));
  for (let i = 0; i < 4; i++) chars.push(pick(digits));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

module.exports = { check, generateTemp };
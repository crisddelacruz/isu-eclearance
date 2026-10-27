const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/database');

// Signatures live OUTSIDE the public folder. They are only served through
// a route that checks who is asking (see src/routes/files.js).
const DIR = path.resolve(__dirname, '../../data/signatures');
fs.mkdirSync(DIR, { recursive: true });

const NAME_RE = /^[a-f0-9]{32}\.(png|jpg)$/;

// Looks at the real bytes of the file, not its name.
function detectType(buf) {
  if (!buf || buf.length < 12) return null;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.subarray(0, 8).equals(png)) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  return null;
}

// Saves the image under a random name and returns that name.
function saveFile(buf, type) {
  const name = crypto.randomBytes(16).toString('hex') + '.' + type;
  fs.writeFileSync(path.join(DIR, name), buf);
  return name;
}

// Deletes a file only if no user and no clearance still uses it.
function removeIfUnused(name) {
  if (!name || !NAME_RE.test(name)) return;
  const usedByClearance = db.prepare('SELECT 1 FROM clearance_items WHERE signature_path = ? LIMIT 1').get(name);
  const usedByUser = db.prepare('SELECT 1 FROM users WHERE signature_path = ? LIMIT 1').get(name);
  if (usedByClearance || usedByUser) return;
  try {
    fs.unlinkSync(path.join(DIR, name));
  } catch (err) {
    /* already gone, fine */
  }
}

module.exports = { DIR, NAME_RE, detectType, saveFile, removeIfUnused };
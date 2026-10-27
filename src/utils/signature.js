const crypto = require('crypto');
const db = require('../config/database');

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
async function saveFile(buf, type) {
  const name = crypto.randomBytes(16).toString('hex') + '.' + type;
  await db.run(
    'INSERT INTO signatures (name, mime, data) VALUES (?, ?, ?)',
    name, type === 'png' ? 'image/png' : 'image/jpeg', buf.toString('base64')
  );
  return name;
}

// Returns { mime, buffer } or null.
async function getFile(name) {
  if (!NAME_RE.test(String(name))) return null;
  const row = await db.get('SELECT mime, data FROM signatures WHERE name = ?', name);
  return row ? { mime: row.mime, buffer: Buffer.from(row.data, 'base64') } : null;
}

// Deletes an image only if no user and no clearance still uses it.
async function removeIfUnused(name) {
  if (!name || !NAME_RE.test(name)) return;
  const byClearance = await db.get('SELECT 1 AS x FROM clearance_items WHERE signature_path = ? LIMIT 1', name);
  const byUser = await db.get('SELECT 1 AS x FROM users WHERE signature_path = ? LIMIT 1', name);
  if (byClearance || byUser) return;
  await db.run('DELETE FROM signatures WHERE name = ?', name);
}

module.exports = { NAME_RE, detectType, saveFile, getFile, removeIfUnused };
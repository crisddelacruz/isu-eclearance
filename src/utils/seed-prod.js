require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const baseStatements = require('../config/seed-base');
const pw = require('./password');

// Usage: npm run seed:prod -- admin@isu.edu.ph "First name" "Last name"
const [email, first, last] = process.argv.slice(2);
if (!email || !first || !last || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.log('Usage: npm run seed:prod -- admin@isu.edu.ph "First name" "Last name"');
  process.exit(1);
}

async function main() {
  await db.initSchema();
  await db.batch(baseStatements());
  console.log('✔ Colleges, programs, offices, term, and settings are ready.');

  const exists = await db.get('SELECT 1 AS x FROM users WHERE email = ?', email.toLowerCase());
  if (exists) {
    console.log('• An account with that email already exists, so no new admin was created.');
    return;
  }
  const temp = pw.generateTemp();
  await db.run(
    `INSERT INTO users (role, email, password_hash, first_name, last_name, position_title, status, must_change_password)
     VALUES ('admin', ?, ?, ?, ?, 'System Administrator', 'active', 1)`,
    email.toLowerCase(), bcrypt.hashSync(temp, 10), first, last
  );
  console.log('✔ Admin account created.');
  console.log('  Email             :', email.toLowerCase());
  console.log('  Temporary password:', temp);
  console.log('  Copy it now. It is shown only once, and you must change it at first login.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed:', err.message);
    process.exit(1);
  });
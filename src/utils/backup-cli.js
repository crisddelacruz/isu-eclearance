require('dotenv').config();
const { runBackup } = require('./backup');

runBackup({ force: true })
  .then((r) => {
    console.log('Backup saved to:', r.dir);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Backup failed:', err.message);
    process.exit(1);
  });
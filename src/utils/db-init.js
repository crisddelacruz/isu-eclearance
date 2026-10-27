require('dotenv').config();
const db = require('../config/database');

db.initSchema()
  .then(() => {
    console.log('✔ Tables are ready (' + (db.isFile ? 'local file: ' + db.url : 'Turso, remote') + ').');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Failed:', err.message);
    process.exit(1);
  });
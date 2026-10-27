// PM2 keeps the app running and restarts it if it crashes.
// Keep instances at 1: the SQLite database and the daily backup timer
// are designed for a single process.
module.exports = {
  apps: [
    {
      name: 'isu-eclearance',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '400M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
const db = require('../config/database');
const { fmtDate } = require('./format');

// Today's date in Philippine time (the server may run in UTC).
function todayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

async function enforced() {
  const row = await db.get("SELECT value FROM settings WHERE key = 'enforce_term_dates'");
  return !!row && row.value === '1';
}

// Returns a message for the student if requests are closed, or '' if they may proceed.
async function problem(term) {
  if (!term || !(await enforced())) return '';
  const t = todayStr();
  if (term.clearance_open_date && t < term.clearance_open_date) {
    return 'Clearance requests open on ' + fmtDate(term.clearance_open_date) + '.';
  }
  if (term.clearance_deadline && t > term.clearance_deadline) {
    return 'The clearance deadline (' + fmtDate(term.clearance_deadline) + ') has passed. Please contact the administrator.';
  }
  return '';
}

module.exports = { problem };
const db = require('../config/database');
const { fmtDate } = require('./format');

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function enforced() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'enforce_term_dates'").get();
  return !!row && row.value === '1';
}

// Returns a message for the student if requests are closed, or '' if they may proceed.
function problem(term) {
  if (!term || !enforced()) return '';
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
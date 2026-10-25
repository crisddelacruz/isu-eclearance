// Small helpers for showing dates and statuses in pages.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parse(s) {
  if (!s) return null;
  let str = String(s).trim();
  if (str.length === 10) str += 'T00:00:00'; // date only
  else str = str.replace(' ', 'T');
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(s) {
  const d = parse(s);
  return d ? `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : '—';
}

function fmtDateTime(s) {
  const d = parse(s);
  if (!d) return '—';
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${fmtDate(s)}, ${h}:${m} ${ampm}`;
}

const PILL = {
  pending: 'pill-pending',
  approved: 'pill-approved',
  rejected: 'pill-rejected',
  in_progress: 'pill-progress',
  completed: 'pill-approved',
  cancelled: 'pill-rejected',
};
const pillClass = (status) => PILL[status] || 'pill-pending';
const statusLabel = (status) =>
  String(status || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

module.exports = { fmtDate, fmtDateTime, pillClass, statusLabel };
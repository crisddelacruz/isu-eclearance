// Tiny CSV reader/writer (no extra packages needed).

function cell(v) {
  let s = v == null ? '' : String(v);
  // Stops spreadsheet programs from running text that starts like a formula.
  if (/^[=+\-@]/.test(s) && isNaN(Number(s))) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(headers, rows) {
  const out = [headers.map(cell).join(',')];
  rows.forEach((r) => out.push(r.map(cell).join(',')));
  return '\uFEFF' + out.join('\r\n') + '\r\n'; // BOM so Excel reads accents correctly
}

// Returns an array of rows (each row is an array of text cells).
function parse(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cur); cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

module.exports = { toCsv, parse };
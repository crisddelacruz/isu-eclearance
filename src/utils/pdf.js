const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const sig = require('./signature');
const { fmtDate } = require('./format');

const GREEN = '#006a3a';
const DARK = '#004d2a';
const INK = '#111111';
const GREY = '#555555';
const LINE = '#777777';
const LOGO = path.resolve(__dirname, '../../public/images/isu-logo.jpg');
const YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year', '6th Year'];

// A4 page: 595 x 842 points. Content area is 515 wide.
const L = 40;
const W = 515;
const TOP = 30;
const LIMIT = 812; // lowest y we are allowed to draw at
const ROW = 40;
const COLS = [28, 188, 215, 84]; // No., Office, Signature, Date  (sum = 515)
const XS = [L, L + COLS[0], L + COLS[0] + COLS[1], L + COLS[0] + COLS[1] + COLS[2]];

// Draws ONE line of text. Shrinks the font (down to "min") if it is too wide,
// and as a last resort cuts the text with "...".
function line(doc, text, x, y, w, o = {}) {
  const size = o.size || 9;
  const floor = o.min || size;
  let s = size;
  let t = String(text == null ? '' : text);
  doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(s);
  while (s > floor && doc.widthOfString(t) > w) {
    s -= 0.5;
    doc.fontSize(s);
  }
  if (doc.widthOfString(t) > w) {
    while (t.length > 1 && doc.widthOfString(t + '...') > w) t = t.slice(0, -1);
    t += '...';
  }
  doc.fillColor(o.color || INK).text(t, x, y, {
    width: w, align: o.align || 'left', lineBreak: false, characterSpacing: o.spacing || 0,
  });
}

// The signature cell: image, line, printed name, position.
function drawSignature(doc, it, x, y, w) {
  let drew = false;
  if (it.signature_path && sig.NAME_RE.test(it.signature_path)) {
    const file = path.join(sig.DIR, it.signature_path);
    if (fs.existsSync(file)) {
      try {
        doc.image(file, x + (w - 110) / 2, y + 2, { fit: [110, 19], align: 'center', valign: 'bottom' });
        drew = true;
      } catch (err) {
        console.error('PDF: could not draw signature', it.signature_path, err.message);
      }
    }
  }
  if (!drew) line(doc, '(e-signed)', x, y + 10, w, { size: 7, color: GREY, align: 'center' });

  doc.moveTo(x + 14, y + 22).lineTo(x + w - 14, y + 22).lineWidth(0.6).strokeColor('#222222').stroke();
  line(doc, String(it.signed_name || '').toUpperCase(), x + 6, y + 24, w - 12, { size: 6.8, bold: true, min: 5.5, align: 'center' });
  line(doc, it.signed_position || '', x + 6, y + 32, w - 12, { size: 6, color: GREY, min: 5, align: 'center' });
}

// Builds the clearance PDF and returns it as a Buffer.
async function buildClearancePdf(sheet, verifyUrl) {
  const R = sheet.request;
  const S = sheet.student;
  const st = sheet.settings || {};
  const items = sheet.items;

  const qr = await QRCode.toBuffer(verifyUrl, { type: 'png', width: 240, margin: 1, errorCorrectionLevel: 'M' });

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: TOP, left: L, right: L, bottom: 10 },
    info: {
      Title: 'Student Clearance ' + R.reference_no,
      Author: st.university_name || 'Isabela State University',
      Subject: R.purpose + ' clearance',
    },
  });

  const chunks = [];
  const finished = new Promise((resolve, reject) => {
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // ---------- Header ----------
  let y = TOP;
  try {
    doc.image(LOGO, L, y, { fit: [60, 60] });
  } catch (err) {
    console.error('PDF: logo missing', err.message);
  }
  const hx = L + 70;
  const hw = W - 140;
  line(doc, 'Republic of the Philippines', hx, y + 4, hw, { size: 8, color: GREY, align: 'center' });
  line(doc, (st.university_name || 'Isabela State University').toUpperCase(), hx, y + 16, hw, { size: 15, bold: true, color: DARK, align: 'center', min: 11 });
  line(doc, st.university_address || 'Echague, Isabela, Philippines', hx, y + 36, hw, { size: 8.5, color: GREY, align: 'center' });

  doc.image(qr, L + W - 60, y, { fit: [60, 60] });
  line(doc, 'Scan to verify', L + W - 64, y + 62, 64, { size: 6, color: GREY, align: 'center' });

  y = TOP + 74;
  doc.strokeColor(GREEN).lineWidth(1.5).moveTo(L, y).lineTo(L + W, y).stroke();
  doc.lineWidth(0.5).moveTo(L, y + 3).lineTo(L + W, y + 3).stroke();

  // ---------- Title ----------
  y += 10;
  line(doc, 'STUDENT CLEARANCE', L, y, W, { size: 13, bold: true, color: GREEN, align: 'center', spacing: 3 });
  line(doc, R.purpose + ' - ' + R.semester + ', S.Y. ' + R.school_year, L, y + 18, W, { size: 9, color: GREY, align: 'center' });

  // ---------- Student information ----------
  y += 38;
  const fullName = [S.last_name + ',', S.first_name, S.middle_name, S.suffix].filter(Boolean).join(' ');
  const pairs = [
    ['Name of student', fullName, 'Student ID number', S.id_number || '-'],
    ['Program', S.program_name || '-', 'Year level', S.year_level ? YEARS[S.year_level - 1] : '-'],
    ['College', S.college_name || '-', 'Date requested', fmtDate(R.created_at)],
  ];
  const colW = (W - 16) / 2;
  pairs.forEach((p, i) => {
    const ry = y + i * 24;
    [[p[0], p[1], L], [p[2], p[3], L + colW + 16]].forEach(([label, value, x]) => {
      line(doc, label.toUpperCase(), x, ry, colW, { size: 6.2, color: GREY });
      line(doc, value, x, ry + 8, colW, { size: 9.5, bold: true, min: 6.5 });
      doc.moveTo(x, ry + 21).lineTo(x + colW, ry + 21).lineWidth(0.5).strokeColor('#888888').stroke();
    });
  });

  // ---------- Table ----------
  function tableHead(yy) {
    doc.lineWidth(0.5).rect(L, yy, W, 18).fillAndStroke('#e9f3ed', LINE);
    ['No.', 'Office / Requirement', 'Signature over printed name', 'Date'].forEach((t, i) => {
      line(doc, t.toUpperCase(), XS[i] + 2, yy + 6, COLS[i] - 4, { size: 6.8, bold: true, color: DARK, align: 'center', min: 5.5 });
    });
    doc.strokeColor(LINE).lineWidth(0.5);
    for (let i = 1; i < 4; i++) doc.moveTo(XS[i], yy).lineTo(XS[i], yy + 18).stroke();
    return yy + 18;
  }

  y = tableHead(y + 78);

  items.forEach((it, i) => {
    if (y + ROW > LIMIT) {
      doc.addPage();
      y = tableHead(TOP);
    }
    doc.lineWidth(0.5).strokeColor(LINE);
    XS.forEach((x, k) => doc.rect(x, y, COLS[k], ROW).stroke());

    line(doc, i + 1, XS[0], y + 16, COLS[0], { size: 9, align: 'center' });

    const name = it.office_name + (it.subject_code ? ' - ' + it.subject_code : '');
    if (it.subject_title) {
      line(doc, name, XS[1] + 6, y + 11, COLS[1] - 12, { size: 8.5, bold: true, min: 6.5 });
      line(doc, it.subject_title, XS[1] + 6, y + 23, COLS[1] - 12, { size: 7.5, color: GREY, min: 6 });
    } else {
      line(doc, name, XS[1] + 6, y + 15, COLS[1] - 12, { size: 8.5, bold: true, min: 6.5 });
    }

    if (it.status === 'approved') {
      drawSignature(doc, it, XS[2], y, COLS[2]);
      line(doc, fmtDate(it.acted_at), XS[3], y + 16, COLS[3], { size: 8, align: 'center' });
    } else if (it.status === 'rejected') {
      line(doc, 'RETURNED', XS[2], y + 16, COLS[2], { size: 8, bold: true, color: '#a3161b', align: 'center' });
    } else {
      line(doc, 'Awaiting signature', XS[2], y + 16, COLS[2], { size: 8, color: '#999999', align: 'center' });
    }
    y += ROW;
  });

  // ---------- Result bar and footer ----------
  if (y + 80 > LIMIT) {
    doc.addPage();
    y = TOP;
  }
  y += 10;
  const cleared = R.status === 'completed';
  const color = cleared ? GREEN : '#c9a227';
  doc.roundedRect(L, y, W, 30, 4).lineWidth(1.5).strokeColor(color).stroke();
  line(doc, cleared ? 'CLEARED' : 'NOT YET CLEARED', L, y + 5, W, { size: 11, bold: true, color, align: 'center', spacing: 3 });
  line(
    doc,
    cleared ? 'All offices have signed - ' + fmtDate(R.completed_at) : 'Waiting for the remaining offices to sign',
    L, y + 19, W, { size: 7.5, color: GREY, align: 'center' }
  );

  line(doc, 'Reference no.: ' + R.reference_no, L, y + 38, W / 2, { size: 8, bold: true });
  line(doc, 'Verification code: ' + R.verification_code, L + W / 2, y + 38, W / 2, { size: 8, bold: true, align: 'right' });
  line(doc, 'Verify online: ' + verifyUrl, L, y + 49, W, { size: 7, color: GREEN, min: 5.5 });
  line(doc, st.clearance_footer || '', L, y + 59, W, { size: 6.5, color: GREY, min: 5.5 });

  doc.end();
  return finished;
}

module.exports = { buildClearancePdf };
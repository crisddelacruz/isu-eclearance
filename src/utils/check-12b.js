require('dotenv').config();
const db = require('../config/database');
const clearance = require('./clearance');
const S = require('./signatory');
const signing = require('./signing');
const sig = require('./signature');
const { notifySignatories } = require('./notify');
const termWindow = require('./termwindow');
const { buildClearancePdf } = require('./pdf');

let fails = 0;
const ok = (cond, label) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
  if (!cond) fails++;
};

// A tiny valid 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function main() {
  if (!db.isFile) throw new Error('Run this against the LOCAL file database only.');

  const student = await db.get("SELECT * FROM users WHERE email = 'student@isu-demo.local'");
  const term = await clearance.getCurrentTerm();
  ok(!!student && !!term, 'demo student and current term found');

  // 1. Create a clearance
  await db.run('DELETE FROM clearance_requests WHERE student_id = ?', student.id);
  const made = await clearance.createClearance(student, term, 'End of Semester');
  ok(!!made.id, 'createClearance returned an id');
  const reqs = await clearance.requestsFor(student.id);
  ok(reqs.length === 1 && reqs[0].total === 12, 'request has 12 signing lines');
  ok(/^ISU-\d{4}-\d{6}$/.test(reqs[0].reference_no), 'reference number looks right: ' + reqs[0].reference_no);

  // 2. Notify signatories
  await notifySignatories(made.id, null, 'New clearance request');
  const lib = await db.get("SELECT * FROM users WHERE email = 'library@isu-demo.local'");
  const note = await db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?', lib.id);
  ok(note.n === 1, 'Library signatory was notified');

  // 3. Queues
  ok((await S.countPending(lib)) === 1, 'Library has 1 pending request');
  const inst1 = await db.get("SELECT * FROM users WHERE email = 'instructor1@isu-demo.local'");
  const inst2 = await db.get("SELECT * FROM users WHERE email = 'instructor2@isu-demo.local'");
  ok((await S.countPending(inst1)) === 1 && (await S.countPending(inst2)) === 1, 'each instructor sees only their own subject');

  // 4. Approve needs a signature
  const noSig = await signing.approveItem(lib, (await S.pendingFor(lib))[0].item_id);
  ok(noSig.error === 'no_signature', 'approve is refused without an e-signature');

  // 5. Save a signature, approve
  const name = await sig.saveFile(PNG, sig.detectType(PNG));
  ok(sig.NAME_RE.test(name), 'signature saved in the database as ' + name);
  await db.run('UPDATE users SET signature_path = ? WHERE id = ?', name, lib.id);
  const libWithSig = await db.get('SELECT * FROM users WHERE id = ?', lib.id);
  const item = (await S.pendingFor(libWithSig))[0];
  const res = await signing.approveItem(libWithSig, item.item_id);
  ok(res.ok === true, 'approve succeeded');
  ok((await S.countPending(libWithSig)) === 0, 'Library queue is now empty');

  // 6. Cannot approve twice
  const twice = await signing.approveItem(libWithSig, item.item_id);
  ok(!!twice.error && twice.error !== 'no_signature', 'second approve is refused');

  // 7. Return a line
  const cash = await db.get("SELECT * FROM users WHERE email = 'cashier@isu-demo.local'");
  const cashItem = (await S.pendingFor(cash))[0];
  const ret = await signing.returnItem(cash, cashItem.item_id, 'Please pay the laboratory fee.');
  ok(ret.ok === true, 'return succeeded');
  const stu = await db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?', student.id);
  ok(stu.n >= 2, 'student received notifications');

  // 8. Sheet and PDF
  const sheet = await clearance.sheetFor(made.id);
  ok(sheet && sheet.items.length === 12 && sheet.student.last_name === 'Dela Cruz', 'sheetFor returns the form data');
  const pdf = await buildClearancePdf(sheet, 'http://localhost:3000/verify/' + sheet.request.verification_code);
  ok(pdf.length > 5000 && pdf.subarray(0, 4).toString() === '%PDF', 'PDF built with the signature from the database (' + pdf.length + ' bytes)');

  // 9. Signature image retrieval
  const got = await sig.getFile(name);
  ok(got && got.mime === 'image/png' && got.buffer.equals(PNG), 'signature image reads back byte for byte');

  // 10. Transaction rollback
  let rolled = false;
  try {
    await db.tx(async (t) => {
      await t.run("INSERT INTO settings (key, value) VALUES ('rollback_test', '1')");
      throw new Error('boom');
    });
  } catch (e) { rolled = true; }
  const leftover = await db.get("SELECT 1 AS x FROM settings WHERE key = 'rollback_test'");
  ok(rolled && !leftover, 'a failed transaction is rolled back');

  // 11. Term window (off by default)
  ok((await termWindow.problem(term)) === '', 'term dates are not enforced by default');

  console.log(fails ? '\n' + fails + ' check(s) FAILED.' : '\nAll checks passed.');
  console.log('Run "npm run db:reset" to clear this test data.');
}

main()
  .then(() => process.exit(fails ? 1 : 0))
  .catch((err) => {
    console.error('Check crashed:', err);
    process.exit(1);
  });
const XLSX = require('xlsx');
const path = require('path');

const SOURCE_PATH = path.join(__dirname, 'data', 'SOURCE.XLS');

async function importSource(filePath, db) {
  filePath = filePath || SOURCE_PATH;

  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  // Clear and re-import
  db.run('DELETE FROM traders');

  let count = 0;
  for (const t of rows) {
    db.run(
      `INSERT INTO traders (name, cr, pan, tel, aadhar, padd, ppla, pin, pstate, pst_code, ifsc, acctnum)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(t.NAME || '').trim(),
        String(t.CR || '').trim(),
        String(t.PAN || '').trim(),
        String(t.TEL || '').trim().replace(/\.0$/, ''),
        String(t.AADHAR || '').trim().replace(/\.0$/, ''),
        String(t.PADD || '').trim(),
        String(t.PPLA || '').trim(),
        String(t.PIN || '').trim().replace(/\.0$/, ''),
        String(t.PSTATE || '').trim(),
        String(t.PST_CODE || '').trim(),
        String(t.IFSC || '').trim(),
        String(t.ACCTNUM || '').trim(),
      ]
    );
    count++;
  }

  return count;
}

module.exports = { importSource };

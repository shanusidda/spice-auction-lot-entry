const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');

function resolveSourcePath() {
  // Prefer .xlsx (modern OOXML format that exceljs supports natively).
  // Fall back to .XLS only with a clear error — exceljs cannot parse the legacy binary format.
  for (const name of ['SOURCE.xlsx', 'SOURCE.XLSX', 'SOURCE.xls', 'SOURCE.XLS']) {
    const p = path.join(DATA_DIR, name);
    if (fs.existsSync(p)) return p;
  }
  return path.join(DATA_DIR, 'SOURCE.xlsx');
}

function getCell(row, header, headerIndex) {
  const idx = headerIndex[header];
  if (!idx) return '';
  const v = row.getCell(idx).value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.text) return v.text;        // rich text
    if (v.result != null) return v.result; // formula
    if (v.hyperlink) return v.hyperlink;
  }
  return v;
}

async function importSource(filePath, db) {
  filePath = filePath || resolveSourcePath();

  if (/\.xls$/i.test(filePath)) {
    throw new Error('Legacy .xls files are not supported. Re-save SOURCE as SOURCE.xlsx.');
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('No worksheet found in ' + filePath);

  // Build header → column-index map from row 1
  const headerRow = sheet.getRow(1);
  const headerIndex = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const key = String(cell.value || '').trim().toUpperCase();
    if (key) headerIndex[key] = colNumber;
  });

  // Clear and re-import
  db.run('DELETE FROM traders');

  let count = 0;
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (!row || !row.hasValues) continue;

    const name = String(getCell(row, 'NAME', headerIndex) || '').trim();
    if (!name) continue; // skip blank rows

    db.run(
      `INSERT INTO traders (name, cr, pan, tel, aadhar, padd, ppla, pin, pstate, pst_code, ifsc, acctnum, whatsapp, email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        String(getCell(row, 'CR', headerIndex) || '').trim(),
        String(getCell(row, 'PAN', headerIndex) || '').trim(),
        String(getCell(row, 'TEL', headerIndex) || '').trim().replace(/\.0$/, ''),
        String(getCell(row, 'AADHAR', headerIndex) || '').trim().replace(/\.0$/, ''),
        String(getCell(row, 'PADD', headerIndex) || '').trim(),
        String(getCell(row, 'PPLA', headerIndex) || '').trim(),
        String(getCell(row, 'PIN', headerIndex) || '').trim().replace(/\.0$/, ''),
        String(getCell(row, 'PSTATE', headerIndex) || '').trim(),
        String(getCell(row, 'PST_CODE', headerIndex) || '').trim(),
        String(getCell(row, 'IFSC', headerIndex) || '').trim(),
        String(getCell(row, 'ACCTNUM', headerIndex) || '').trim(),
        String(getCell(row, 'WHATSAPP', headerIndex) || '').trim().replace(/\.0$/, ''),
        String(getCell(row, 'EMAIL', headerIndex) || '').trim(),
      ]
    );
    count++;
  }

  return count;
}

module.exports = { importSource };

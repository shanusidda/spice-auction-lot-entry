const ExcelJS = require('exceljs');
const { DBFFile } = require('dbffile');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { getDb } = require('./db');

const EXPORT_COLUMNS = [
  { key: 'ano',           header: 'ANO',        width: 8,  labelKey: null },
  { key: 'date',          header: 'DATE',       width: 12, labelKey: null },
  { key: 'lot_no',        header: 'LOT',        width: 8,  labelKey: 'lot_no' },
  { key: 'crop',          header: 'CROP',       width: 8,  labelKey: null },
  { key: 'grade',         header: 'GRADE',      width: 8,  labelKey: 'grade' },
  { key: 'crpt',          header: 'CRPT',       width: 8,  labelKey: null },
  { key: 'branch',        header: 'BR',         width: 18, labelKey: null },
  { key: 'name',          header: 'NAME',       width: 30, labelKey: 'seller' },
  { key: 'padd',          header: 'PADD',       width: 50, labelKey: null },
  { key: 'ppla',          header: 'PPLA',       width: 20, labelKey: null },
  { key: 'pin',           header: 'PPIN',       width: 10, labelKey: null },
  { key: 'pstate',        header: 'PSTATE',     width: 12, labelKey: null },
  { key: 'pst_code',      header: 'PST_CODE',   width: 10, labelKey: null },
  { key: 'cr',            header: 'CR',         width: 28, labelKey: 'gstin' },
  { key: 'pan',           header: 'PAN',        width: 14, labelKey: null },
  { key: 'tel',           header: 'TEL',        width: 16, labelKey: null },
  { key: 'aadhar',        header: 'AADHAR',     width: 16, labelKey: null },
  { key: 'bags',          header: 'BAG',        width: 8,  labelKey: 'bags' },
  { key: 'litre',         header: 'LITRE',      width: 8,  labelKey: 'litre_wt' },
  { key: 'qty',           header: 'NET_WT',     width: 10, labelKey: 'net_wt' },
  { key: 'sample_weight', header: 'SAMPLE_WT',  width: 10, labelKey: 'sample_wt' },
  { key: 'gross_weight',  header: 'GROSS_WT',   width: 10, labelKey: 'gross_wt' },
  { key: 'moisture',      header: 'MOISTURE',   width: 8,  labelKey: 'moisture' },
  { key: 'state',         header: 'STATE',      width: 14, labelKey: null },
];

function getLabels() {
  const db = getDb();
  try {
    const row = db.get("SELECT value FROM config WHERE type = 'labels' LIMIT 1");
    if (row) return JSON.parse(row.value);
  } catch(e) {}
  return {};
}

function fmtDate(d) {
  if (!d) return '';
  const p = d.split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : d;
}

function getExportData(auctionId) {
  const db = getDb();
  const rows = db.all(`
    SELECT
      a.ano, a.date, l.lot_no, NULL as crop, l.grade,
      a.crop_type as crpt, l.branch, t.name, t.padd, t.ppla,
      t.pin, t.pstate, t.pst_code, t.cr, t.pan, t.tel, t.aadhar,
      l.bags, l.litre, l.qty, l.sample_weight, l.gross_weight, l.moisture, l.state
    FROM lots l
    JOIN auctions a ON a.id = l.auction_id
    LEFT JOIN traders t ON t.id = l.trader_id
    WHERE l.auction_id = ?
    ORDER BY CAST(l.lot_no AS INTEGER) ASC, l.lot_no ASC
  `, [auctionId]);
  // Format all fields for export consistency (XLSX + DBF)
  return rows.map(r => ({
    ...r,
    ano: String(r.ano || ''),
    date: r.date || '',  // keep raw YYYY-MM-DD, format per-export
    lot_no: String(r.lot_no || ''),
    crop: '',
    grade: String(r.grade || ''),
    pin: String(r.pin || ''),
    pst_code: String(r.pst_code || ''),
    bags: Number(r.bags) || 0,
    litre: String(r.litre || ''),
    qty: Number(Number(r.qty || 0).toFixed(3)),
    sample_weight: Number(Number(r.sample_weight || 0).toFixed(3)),
    gross_weight: Number(Number(r.gross_weight || r.qty || 0).toFixed(3)),
    moisture: r.moisture != null ? Number(Number(r.moisture).toFixed(1)) : 0,
  }));
}

/**
 * Export to XLSX — writes to buffer, returns { buffer, fileName }
 */
async function exportXlsx(auctionId) {
  const rows = getExportData(auctionId);
  if (rows.length === 0) throw new Error('No lots found for this auction');

  const db = getDb();
  const auction = db.get('SELECT * FROM auctions WHERE id = ?', [auctionId]);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('CPA1');

  const labels = getLabels();
  sheet.columns = EXPORT_COLUMNS.map(col => ({
    header: (col.labelKey && labels[col.labelKey]) ? labels[col.labelKey].toUpperCase() : col.header,
    key: col.key, width: col.width,
  }));

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern', pattern: 'solid',
    fgColor: { argb: 'FFE8F5E9' },
  };

  // Find column indices for formatting
  const dateColIdx = EXPORT_COLUMNS.findIndex(c => c.key === 'date') + 1;
  const qtyColIdx = EXPORT_COLUMNS.findIndex(c => c.key === 'qty') + 1;
  const sampleColIdx = EXPORT_COLUMNS.findIndex(c => c.key === 'sample_weight') + 1;
  const grossColIdx = EXPORT_COLUMNS.findIndex(c => c.key === 'gross_weight') + 1;

  for (const row of rows) {
    const added = sheet.addRow(row);
    // Date → short date format
    if (dateColIdx > 0 && row.date) {
      const parts = row.date.split('-');
      if (parts.length === 3) {
        added.getCell(dateColIdx).value = new Date(parts[0], parts[1] - 1, parts[2]);
        added.getCell(dateColIdx).numFmt = 'DD/MM/YYYY';
      }
    }
    // Qty, Sample, Gross → always 3 decimal places
    if (qtyColIdx > 0) added.getCell(qtyColIdx).numFmt = '0.000';
    if (sampleColIdx > 0) added.getCell(sampleColIdx).numFmt = '0.000';
    if (grossColIdx > 0) added.getCell(grossColIdx).numFmt = '0.000';
  }

  const fileName = `AUCTION_${auction.ano}_${auction.date.replace(/-/g, '')}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();

  return { buffer, fileName, rowCount: rows.length };
}

/**
 * Export to DBF — writes to temp file, returns { filePath, fileName, cleanup }
 */
async function exportDbf(auctionId) {
  const rows = getExportData(auctionId);
  if (rows.length === 0) throw new Error('No lots found for this auction');

  const db = getDb();
  const auction = db.get('SELECT * FROM auctions WHERE id = ?', [auctionId]);

  const labels = getLabels();
  // Helper: get label, uppercase, max 10 chars (DBF limit)
  function dbfName(labelKey, fallback) {
    const lbl = (labelKey && labels[labelKey]) ? labels[labelKey] : fallback;
    return lbl.toUpperCase().replace(/[^A-Z0-9_]/g, '_').substring(0, 10);
  }

  const fieldDescriptors = [
    { name: 'ANO',                           type: 'C', size: 10 },
    { name: 'DATE',                          type: 'D', size: 8  },
    { name: dbfName('lot_no', 'LOT'),        type: 'C', size: 20 },
    { name: 'CROP',                          type: 'C', size: 10 },
    { name: dbfName('grade', 'GRADE'),       type: 'C', size: 10 },
    { name: 'CRPT',                          type: 'C', size: 10 },
    { name: 'BR',                            type: 'C', size: 30 },
    { name: dbfName('seller', 'NAME'),       type: 'C', size: 50 },
    { name: 'PADD',                          type: 'C', size: 80 },
    { name: 'PPLA',                          type: 'C', size: 30 },
    { name: 'PPIN',                          type: 'C', size: 10 },
    { name: 'PSTATE',                        type: 'C', size: 20 },
    { name: 'PST_CODE',                      type: 'C', size: 10 },
    { name: dbfName('gstin', 'CR'),          type: 'C', size: 40 },
    { name: 'PAN',                           type: 'C', size: 14 },
    { name: 'TEL',                           type: 'C', size: 20 },
    { name: 'AADHAR',                        type: 'C', size: 20 },
    { name: dbfName('bags', 'BAG'),          type: 'N', size: 6,  decimalPlaces: 0 },
    { name: dbfName('litre_wt', 'LITRE'),    type: 'C', size: 10 },
    { name: dbfName('net_wt', 'NET_WT'),     type: 'N', size: 12, decimalPlaces: 3 },
    { name: dbfName('sample_wt', 'SAMPLE_WT'), type: 'N', size: 12, decimalPlaces: 3 },
    { name: dbfName('gross_wt', 'GROSS_WT'), type: 'N', size: 12, decimalPlaces: 3 },
    { name: dbfName('moisture', 'MOISTURE'), type: 'N', size: 8,  decimalPlaces: 1 },
    { name: 'STATE',                         type: 'C', size: 20 },
  ];

  const fileName = `AUCTION_${auction.ano}_${auction.date.replace(/-/g, '')}.dbf`;
  // Use OS temp directory — auto cleaned up
  const filePath = path.join(os.tmpdir(), 'auction_export_' + Date.now() + '.dbf');

  const dbf = await DBFFile.create(filePath, fieldDescriptors);

  const records = rows.map(r => {
    const rec = {};
    rec['ANO'] = String(r.ano || '');
    rec['DATE'] = r.date ? new Date(r.date) : null;
    rec[dbfName('lot_no', 'LOT')] = String(r.lot_no || '');
    rec['CROP'] = '';
    rec[dbfName('grade', 'GRADE')] = String(r.grade || '');
    rec['CRPT'] = r.crpt || '';
    rec['BR'] = r.branch || '';
    rec[dbfName('seller', 'NAME')] = r.name || '';
    rec['PADD'] = r.padd || '';
    rec['PPLA'] = r.ppla || '';
    rec['PPIN'] = String(r.pin || '');
    rec['PSTATE'] = r.pstate || '';
    rec['PST_CODE'] = String(r.pst_code || '');
    rec[dbfName('gstin', 'CR')] = r.cr || '';
    rec['PAN'] = r.pan || '';
    rec['TEL'] = r.tel || '';
    rec['AADHAR'] = r.aadhar || '';
    rec[dbfName('bags', 'BAG')] = Number(r.bags) || 0;
    rec[dbfName('litre_wt', 'LITRE')] = String(r.litre || '');
    rec[dbfName('net_wt', 'NET_WT')] = Number(r.qty) || 0;
    rec[dbfName('sample_wt', 'SAMPLE_WT')] = Number(r.sample_weight) || 0;
    rec[dbfName('gross_wt', 'GROSS_WT')] = Number(r.gross_weight) || 0;
    rec[dbfName('moisture', 'MOISTURE')] = Number(r.moisture) || 0;
    rec['STATE'] = r.state || '';
    return rec;
  });

  await dbf.appendRecords(records);

  // Return filePath + cleanup function
  return {
    filePath,
    fileName,
    rowCount: rows.length,
    cleanup: () => { try { fs.unlinkSync(filePath); } catch(e) {} }
  };
}

module.exports = { exportXlsx, exportDbf, getExportData };

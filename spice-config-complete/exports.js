/**
 * exports.js — All export formats
 * Replaces: EXP.PRG (11 types), TALY.PRG, KOTALLY.PRG, BANKPAY export
 */

const ExcelJS = require('exceljs');

async function createExcelBuffer(sheetName, columns, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width || 15 }));
  
  // Header style
  ws.getRow(1).font = { bold: true, size: 10 };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E4DD' } };
  
  rows.forEach(r => ws.addRow(r));
  return wb.xlsx.writeBuffer();
}

// ── Export Type 1: Lot Slip (before trade) ───────────────────
async function exportLotSlip(db, auctionId, state) {
  const rows = db.all(
    `SELECT state, lot_no as lot, name, grade, bags as bag, qty, litre
     FROM lots WHERE auction_id = ? ${state ? 'AND state = ?' : ''}
     ORDER BY lot_no`, state ? [auctionId, state] : [auctionId]
  );
  const cols = [
    { header: 'STATE', key: 'state', width: 12 },
    { header: 'LOT', key: 'lot', width: 8 },
    { header: 'NAME', key: 'name', width: 30 },
    { header: 'GRADE', key: 'grade', width: 8 },
    { header: 'BAG', key: 'bag', width: 6 },
    { header: 'QTY', key: 'qty', width: 12 },
    { header: 'LITRE', key: 'litre', width: 10 },
  ];
  return createExcelBuffer('LotSlip', cols, rows);
}

// ── Export Type 2: Lot Slip After Trade (with price/buyer) ───
async function exportLotSlipAfter(db, auctionId, state) {
  const rows = db.all(
    `SELECT state, lot_no as lot, name, bags as bag, qty, price, amount, code
     FROM lots WHERE auction_id = ? ${state ? 'AND state = ?' : ''}
     ORDER BY lot_no`, state ? [auctionId, state] : [auctionId]
  );
  const cols = [
    { header: 'STATE', key: 'state', width: 12 },
    { header: 'LOT', key: 'lot', width: 8 },
    { header: 'NAME', key: 'name', width: 30 },
    { header: 'BAG', key: 'bag', width: 6 },
    { header: 'QTY', key: 'qty', width: 12 },
    { header: 'PRICE', key: 'price', width: 10 },
    { header: 'AMOUNT', key: 'amount', width: 14 },
    { header: 'CODE', key: 'code', width: 8 },
  ];
  return createExcelBuffer('LotSlipAfter', cols, rows);
}

// ── Export Type 3: Price List ─────────────────────────────────
async function exportPriceList(db, auctionId) {
  const rows = db.all(
    `SELECT lot_no as lot, bags as bag, qty, price, code, buyer as bidder
     FROM lots WHERE auction_id = ? ORDER BY lot_no`, [auctionId]
  );
  const cols = [
    { header: 'LOT', key: 'lot', width: 8 },
    { header: 'BAG', key: 'bag', width: 6 },
    { header: 'QTY', key: 'qty', width: 12 },
    { header: 'PRICE', key: 'price', width: 10 },
    { header: 'CODE', key: 'code', width: 8 },
    { header: 'BIDDER', key: 'bidder', width: 20 },
  ];
  return createExcelBuffer('PriceList', cols, rows);
}

// ── Export Type 4: Bank Payment (RTGS/NEFT format) ───────────
async function exportBankPayment(db, auctionId, cfg) {
  const { getBankPaymentData } = require('./calculations');
  const payments = getBankPaymentData(db, auctionId, cfg);
  const cols = [
    { header: 'TransactionType', key: 'transactionType', width: 16 },
    { header: 'BeneIFSCode', key: 'ifsc', width: 14 },
    { header: 'BeneAcctNo', key: 'accountNo', width: 20 },
    { header: 'BeneName', key: 'beneficiaryName', width: 30 },
    { header: 'BeneAddLine1', key: 'address1', width: 30 },
    { header: 'BeneAddLine2', key: 'address2', width: 20 },
    { header: 'BeneAddLine3', key: 'pin', width: 10 },
    { header: 'Amount', key: 'amount', width: 14 },
    { header: 'SendertoRcvrInfo', key: 'remarks', width: 50 },
  ];
  return createExcelBuffer('BankPayment', cols, payments);
}

// ── Export Type 5: Pooler-wise Register ───────────────────────
async function exportPoolerRegister(db, auctionId) {
  const rows = db.all(
    `SELECT state, lot_no as lot, name as poolername, branch as br, qty, price, amount, pqty, prate, puramt
     FROM lots WHERE auction_id = ? AND amount > 0
     ORDER BY name`, [auctionId]
  );
  const cols = [
    { header: 'STATE', key: 'state', width: 12 },
    { header: 'NAME', key: 'poolername', width: 30 },
    { header: 'BRANCH', key: 'br', width: 15 },
    { header: 'LOT', key: 'lot', width: 8 },
    { header: 'QTY', key: 'qty', width: 12 },
    { header: 'PRICE', key: 'price', width: 10 },
    { header: 'AMOUNT', key: 'amount', width: 14 },
    { header: 'PQTY', key: 'pqty', width: 12 },
    { header: 'PRATE', key: 'prate', width: 10 },
    { header: 'PURAMT', key: 'puramt', width: 14 },
  ];
  return createExcelBuffer('PoolerRegister', cols, rows);
}

// ── Export Type 6: Full File ─────────────────────────────────
async function exportFullFile(db, auctionId) {
  const rows = db.all(`SELECT * FROM lots WHERE auction_id = ? ORDER BY lot_no`, [auctionId]);
  const cols = [
    { header: 'STATE', key: 'state' }, { header: 'LOT', key: 'lot_no', width: 8 },
    { header: 'CROP', key: 'crop' }, { header: 'GRADE', key: 'grade' },
    { header: 'CRPT', key: 'crpt' }, { header: 'BRANCH', key: 'branch', width: 15 },
    { header: 'NAME', key: 'name', width: 30 }, { header: 'CR', key: 'cr', width: 25 },
    { header: 'PAN', key: 'pan' }, { header: 'TEL', key: 'tel' },
    { header: 'BAG', key: 'bags', width: 6 }, { header: 'QTY', key: 'qty', width: 12 },
    { header: 'PRICE', key: 'price', width: 10 }, { header: 'AMOUNT', key: 'amount', width: 14 },
    { header: 'CODE', key: 'code' }, { header: 'BUYER', key: 'buyer', width: 15 },
    { header: 'BUYER1', key: 'buyer1', width: 20 }, { header: 'SALE', key: 'sale' },
    { header: 'INVO', key: 'invo' }, { header: 'PQTY', key: 'pqty', width: 12 },
    { header: 'PRATE', key: 'prate', width: 10 }, { header: 'PURAMT', key: 'puramt', width: 14 },
    { header: 'COM', key: 'com' }, { header: 'CGST', key: 'cgst' },
    { header: 'SGST', key: 'sgst' }, { header: 'IGST', key: 'igst' },
    { header: 'ADVANCE', key: 'advance', width: 14 }, { header: 'BALANCE', key: 'balance', width: 14 },
  ];
  return createExcelBuffer('FullFile', cols, rows);
}

// ── Export Type 7: Collection/Lorry ──────────────────────────
async function exportCollection(db, auctionId) {
  const rows = db.all(
    `SELECT branch, name, cr, bags as bag, qty, litre, grade
     FROM lots WHERE auction_id = ? ORDER BY branch, name`, [auctionId]
  );
  const cols = [
    { header: 'BRANCH', key: 'branch', width: 15 },
    { header: 'NAME', key: 'name', width: 30 },
    { header: 'CR', key: 'cr', width: 25 },
    { header: 'BAG', key: 'bag', width: 6 },
    { header: 'QTY', key: 'qty', width: 12 },
    { header: 'LITRE', key: 'litre', width: 10 },
    { header: 'GRADE', key: 'grade', width: 8 },
  ];
  return createExcelBuffer('Collection', cols, rows);
}

// ── Export Type 8: Dealer List ────────────────────────────────
async function exportDealerList(db, auctionId) {
  const rows = db.all(
    `SELECT state, name, SUBSTR(cr, 7, 15) as gstin, 
      COUNT(lot_no) as lots, SUM(bags) as bags, SUM(qty) as qty
     FROM lots WHERE auction_id = ? AND cr LIKE '%GST%' AND amount > 0
     GROUP BY state, name, cr ORDER BY state, name`, [auctionId]
  );
  const cols = [
    { header: 'STATE', key: 'state', width: 12 },
    { header: 'NAME', key: 'name', width: 30 },
    { header: 'GSTIN', key: 'gstin', width: 18 },
    { header: 'LOTS', key: 'lots', width: 6 },
    { header: 'BAGS', key: 'bags', width: 6 },
    { header: 'QTY', key: 'qty', width: 12 },
  ];
  return createExcelBuffer('DealerList', cols, rows);
}

// ── Export Type 9: Sales & Taxes ─────────────────────────────
async function exportSalesTaxes(db, auctionId) {
  const rows = db.all(
    `SELECT state, sale, invo, buyer1 as tradername, bags as bag, qty, 
      amount as cardamom_cost, gunny as gunny_cost,
      cgst, sgst, igst, tcs, pava_hc as transport, ins as insurance, tot as total
     FROM invoices WHERE ano = (SELECT ano FROM auctions WHERE id = ?)
     ORDER BY sale, invo`, [auctionId]
  );
  const cols = [
    { header: 'STATE', key: 'state' }, { header: 'SALE', key: 'sale' },
    { header: 'INVO', key: 'invo' }, { header: 'TRADERNAME', key: 'tradername', width: 25 },
    { header: 'BAG', key: 'bag', width: 6 }, { header: 'QTY', key: 'qty', width: 12 },
    { header: 'CARDAMOM', key: 'cardamom_cost', width: 14 },
    { header: 'GUNNY', key: 'gunny_cost', width: 10 },
    { header: 'CGST', key: 'cgst', width: 12 }, { header: 'SGST', key: 'sgst', width: 12 },
    { header: 'IGST', key: 'igst', width: 12 }, { header: 'TCS', key: 'tcs', width: 10 },
    { header: 'TRANSPORT', key: 'transport', width: 10 },
    { header: 'INSURANCE', key: 'insurance', width: 10 },
    { header: 'TOTAL', key: 'total', width: 14 },
  ];
  return createExcelBuffer('SalesTaxes', cols, rows);
}

// ── Export: Payment Summary ──────────────────────────────────
async function exportPaymentSummary(db, auctionId) {
  const rows = db.all(
    `SELECT name as poolername, lot_no as lot, bags as bag, qty, price, amount,
      pqty, prate, puramt, advance as discount, balance as payable
     FROM lots WHERE auction_id = ? AND amount > 0
     ORDER BY state, name`, [auctionId]
  );
  const cols = [
    { header: 'POOLERNAME', key: 'poolername', width: 30 },
    { header: 'LOT', key: 'lot', width: 8 }, { header: 'BAG', key: 'bag', width: 6 },
    { header: 'QTY', key: 'qty', width: 12 }, { header: 'PRICE', key: 'price', width: 10 },
    { header: 'AMOUNT', key: 'amount', width: 14 }, { header: 'PQTY', key: 'pqty', width: 12 },
    { header: 'PRATE', key: 'prate', width: 10 }, { header: 'PURAMT', key: 'puramt', width: 14 },
    { header: 'DISCOUNT', key: 'discount', width: 14 },
    { header: 'PAYABLE', key: 'payable', width: 14 },
  ];
  return createExcelBuffer('Payment', cols, rows);
}

// ── Export: TDS Return ───────────────────────────────────────
async function exportTDSReturn(db, fromDate, toDate) {
  const { getTDSReturnData } = require('./calculations');
  const rows = getTDSReturnData(db, fromDate, toDate, 'invoice');
  const cols = [
    { header: 'INVOICE', key: 'invoice', width: 10 },
    { header: 'DATE', key: 'date', width: 12 },
    { header: 'NAME', key: 'name', width: 30 },
    { header: 'PAN', key: 'pan', width: 12 },
    { header: 'ASSESS_VALUE', key: 'assess_value', width: 14 },
    { header: 'TDS', key: 'tds', width: 12 },
  ];
  return createExcelBuffer('TDSReturn', cols, rows);
}

// ── Export: Tally format (TALY.PRG — purchase data for accounting)
async function exportTallyPurchase(db, auctionId) {
  const rows = db.all(
    `SELECT name, padd as add, ppla as place, cr as gstin, tel,
      lot_no as lot, bags as bag, pqty as qty, prate as price, puramt as amount,
      cgst, sgst, igst, advance as discount, puramt as bilamt
     FROM lots WHERE auction_id = ? AND amount > 0
      AND cr NOT LIKE 'GSTIN.%'
     ORDER BY name`, [auctionId]
  );
  const cols = [
    { header: 'NAME', key: 'name', width: 30 }, { header: 'ADD', key: 'add', width: 30 },
    { header: 'PLACE', key: 'place', width: 15 }, { header: 'GSTIN', key: 'gstin', width: 20 },
    { header: 'TEL', key: 'tel', width: 14 }, { header: 'LOT', key: 'lot', width: 8 },
    { header: 'BAG', key: 'bag', width: 6 }, { header: 'QTY', key: 'qty', width: 12 },
    { header: 'PRICE', key: 'price', width: 10 }, { header: 'AMOUNT', key: 'amount', width: 14 },
    { header: 'CGST', key: 'cgst', width: 12 }, { header: 'SGST', key: 'sgst', width: 12 },
    { header: 'IGST', key: 'igst', width: 12 }, { header: 'DISCOUNT', key: 'discount', width: 14 },
    { header: 'BILAMT', key: 'bilamt', width: 14 },
  ];
  return createExcelBuffer('TallyPurchase', cols, rows);
}

// ── Export: Sales Journal (JOUR.PRG) ────────────────────────
async function exportSalesJournal(db, fromDate, toDate, saleType) {
  const { getSalesJournal } = require('./calculations');
  const rows = getSalesJournal(db, fromDate, toDate, saleType);
  const cols = [
    { header: 'DATE', key: 'date', width: 12 },
    { header: 'SALE', key: 'sale', width: 6 },
    { header: 'INV#', key: 'invo', width: 8 },
    { header: 'BUYER', key: 'buyer', width: 8 },
    { header: 'TRADE NAME', key: 'buyer1', width: 30 },
    { header: 'GSTIN', key: 'gstin', width: 20 },
    { header: 'PLACE', key: 'place', width: 15 },
    { header: 'BAGS', key: 'bag', width: 6 },
    { header: 'QTY', key: 'qty', width: 12 },
    { header: 'CARDAMOM', key: 'cardamom', width: 14 },
    { header: 'GUNNY', key: 'gunny', width: 10 },
    { header: 'TRANSPORT', key: 'transport', width: 10 },
    { header: 'INSURANCE', key: 'insurance', width: 10 },
    { header: 'CGST', key: 'cgst', width: 10 },
    { header: 'SGST', key: 'sgst', width: 10 },
    { header: 'IGST', key: 'igst', width: 10 },
    { header: 'TCS', key: 'tcs', width: 10 },
    { header: 'ROUND', key: 'rund', width: 8 },
    { header: 'TOTAL', key: 'total', width: 14 },
  ];
  return createExcelBuffer('SalesJournal', cols, rows);
}

// ── Export: Purchase Journal (PUJOUR.PRG / PPUJOUR.PRG) ────
async function exportPurchaseJournal(db, fromDate, toDate, type) {
  const { getPurchaseJournal } = require('./calculations');
  const rows = getPurchaseJournal(db, fromDate, toDate, type);
  const cols = type === 'agri' ? [
    { header: 'DATE', key: 'date', width: 12 },
    { header: 'BILL#', key: 'bill_no', width: 8 },
    { header: 'NAME', key: 'name', width: 30 },
    { header: 'ADDRESS', key: 'address', width: 30 },
    { header: 'PLACE', key: 'place', width: 15 },
    { header: 'STATE', key: 'state', width: 12 },
    { header: 'CR', key: 'cr', width: 15 },
    { header: 'PAN', key: 'pan', width: 12 },
    { header: 'QTY', key: 'qty', width: 12 },
    { header: 'COST', key: 'cost', width: 14 },
    { header: 'IGST', key: 'igst', width: 10 },
    { header: 'NET', key: 'net', width: 14 },
  ] : [
    { header: 'DATE', key: 'date', width: 12 },
    { header: 'INV#', key: 'invoice_no', width: 8 },
    { header: 'NAME', key: 'name', width: 30 },
    { header: 'ADDRESS', key: 'address', width: 30 },
    { header: 'PLACE', key: 'place', width: 15 },
    { header: 'STATE', key: 'state', width: 12 },
    { header: 'GSTIN', key: 'gstin', width: 20 },
    { header: 'QTY', key: 'qty', width: 12 },
    { header: 'AMOUNT', key: 'amount', width: 14 },
    { header: 'CGST', key: 'cgst', width: 10 },
    { header: 'SGST', key: 'sgst', width: 10 },
    { header: 'IGST', key: 'igst', width: 10 },
    { header: 'ROUND', key: 'rund', width: 8 },
    { header: 'TOTAL', key: 'total', width: 14 },
    { header: 'TDS', key: 'tds', width: 10 },
  ];
  const name = type === 'agri' ? 'AgriBillJournal' : 'PurchaseJournal';
  return createExcelBuffer(name, cols, rows);
}

// ── Export: Praman CSV (Lot Slip in Praman auction platform format) ──
// Produces a CSV (NOT xlsx) matching the column layout required by Praman's
// lot-upload interface. Returns a Buffer of CSV text.
//
// Special rule (item #9): Grade 1 lots → Lot Company = 'ASP' on the CSV
// output only (doesn't change stored data). All other grades → 'ISPL'.
// Rationale: Grade 1 (pooler) lots are routed to ASP for tax/accounting
// reasons, but they still appear as ISPL lots in the local DB.
async function exportPramanCSV(db, auctionId, state) {
  const rows = db.all(
    `SELECT lot_no, branch, grade, name, cr, qty, litre, bags, tel
     FROM lots WHERE auction_id = ? ${state ? 'AND state = ?' : ''}
     ORDER BY CAST(lot_no AS INTEGER), lot_no`,
    state ? [auctionId, state] : [auctionId]
  );

  const header = [
    'Lot Number', 'Lot Company', 'Collection Centre', 'Planter/Dealer',
    'Planter Name', 'CRNO/SBL No', 'Quantity(Kg)', 'Litre Weight(Gms)',
    'Bags', 'Grade Type', 'Grade', 'Reserved Price', 'Auction Start Price(Rs)',
    'Immature Seeds(%)', 'Moisture Content(%)', 'Planter Mobile Number',
    'Youtube Video Link'
  ];

  // Escape a CSV field: wrap in quotes if it contains comma/quote/newline,
  // and double-up any embedded quotes. Undefined/null → empty.
  const csvEscape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };

  const lines = [header.join(',')];
  for (const r of rows) {
    // Grade 1 → ASP (intra-company transfer rule); else → ISPL
    const gradeStr = String(r.grade || '').trim();
    const lotCompany = (gradeStr === '1') ? 'ASP' : 'ISPL';

    // Planter/Dealer: 1 = Planter, 2 = Dealer — inferred from CR field.
    // CR starting with a state code (numeric 2-digit prefix) → GSTIN holder
    // → Dealer (2). Otherwise "CR." prefix or empty → Planter (1).
    const crStr = String(r.cr || '').trim();
    const isDealer = /^\d{2}/.test(crStr);
    const planterDealer = isDealer ? 2 : 1;

    // CRNO/SBL: Planter = "CR.", Dealer = the GSTIN itself
    const crnoSbl = isDealer ? crStr : 'CR.';

    lines.push([
      r.lot_no || '',
      lotCompany,
      r.branch || '',
      planterDealer,
      r.name || '',
      crnoSbl,
      r.qty || '',
      r.litre || '',
      r.bags || '',
      '', // Grade Type (not captured — blank as per sample)
      '', // Grade (Praman's own grade codes, not ours — blank)
      '', // Reserved Price (blank)
      '', // Auction Start Price (blank)
      '', // Immature Seeds (blank)
      '', // Moisture Content (blank)
      r.tel || '',
      '', // Youtube link (blank)
    ].map(csvEscape).join(','));
  }

  // CSV text → Buffer. Prefix with BOM so Excel on Windows opens with
  // UTF-8 correctly (otherwise accented characters break).
  return Buffer.from('\uFEFF' + lines.join('\r\n'), 'utf8');
}

// ── Export router ────────────────────────────────────────────
const EXPORT_TYPES = {
  lot_slip:       { fn: exportLotSlip,       name: 'LotSlip' },
  lot_slip_after: { fn: exportLotSlipAfter,  name: 'LotSlipAfter' },
  praman_csv:     { fn: exportPramanCSV,     name: 'PramanLotSlip', ext: 'csv', mime: 'text/csv' },
  price_list:     { fn: exportPriceList,     name: 'PriceList' },
  bank_payment:   { fn: exportBankPayment,   name: 'BankPayment', needsCfg: true },
  pooler_register:{ fn: exportPoolerRegister,name: 'PoolerRegister' },
  full_file:      { fn: exportFullFile,      name: 'FullFile' },
  collection:     { fn: exportCollection,    name: 'Collection' },
  dealer_list:    { fn: exportDealerList,    name: 'DealerList' },
  sales_taxes:    { fn: exportSalesTaxes,    name: 'SalesTaxes' },
  payment:        { fn: exportPaymentSummary,name: 'Payment' },
  tally_purchase: { fn: exportTallyPurchase, name: 'TallyPurchase' },
};

module.exports = {
  EXPORT_TYPES,
  exportLotSlip, exportLotSlipAfter, exportPramanCSV, exportPriceList, exportBankPayment,
  exportPoolerRegister, exportFullFile, exportCollection, exportDealerList,
  exportSalesTaxes, exportPaymentSummary, exportTDSReturn, exportTallyPurchase,
  exportSalesJournal, exportPurchaseJournal,
};

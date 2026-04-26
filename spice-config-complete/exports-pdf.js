/**
 * exports-pdf.js — PDF versions of all XLSX exports
 * Column structures match exports.js exactly, rendered as landscape A4 tables
 */

const PDFDocument = require('pdfkit');

// ── Generic table-to-PDF renderer ───────────────────────────
function renderTablePdf({ title, subtitle, columns, rows, totals }) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 24 });
  const buffers = [];
  doc.on('data', b => buffers.push(b));

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const m = 24;
  const usableW = pageW - m * 2;

  // Column widths proportional to exports.js width values.
  // Scale so the sum exactly matches usableW; enforce a small min and rescale.
  const totalWeight = columns.reduce((s, c) => s + (c.width || 12), 0);
  const MIN_COL = 22;
  let colWidths = columns.map(c => (c.width || 12) / totalWeight * usableW);
  // Bump narrow columns to MIN_COL, shrink wider cols proportionally to compensate
  const deficit = colWidths.reduce((s, w) => s + Math.max(0, MIN_COL - w), 0);
  if (deficit > 0) {
    const donatePool = colWidths.reduce((s, w) => s + Math.max(0, w - MIN_COL), 0);
    if (donatePool > 0) {
      colWidths = colWidths.map(w => {
        if (w < MIN_COL) return MIN_COL;
        const share = (w - MIN_COL) / donatePool;
        return w - deficit * share;
      });
    }
  }
  colWidths = colWidths.map(w => Math.max(MIN_COL, Math.floor(w)));
  // Final correction so widths sum exactly to usableW
  const diff = usableW - colWidths.reduce((s, w) => s + w, 0);
  colWidths[colWidths.length - 1] = Math.max(MIN_COL, colWidths[colWidths.length - 1] + diff);

  const colX = [m];
  for (let i = 0; i < colWidths.length - 1; i++) colX.push(colX[i] + colWidths[i]);

  const ROW_H = 13;
  const HEAD_H = 16;
  const TOP = m;
  const BODY_TOP_FIRST = TOP + 38 + (subtitle ? 14 : 0);
  let y;

  function isNumericCol(col) {
    const h = (col.header || '').toUpperCase();
    return /^(QTY|BAG|BAGS|PRICE|RATE|AMOUNT|PQTY|PRATE|PURAMT|CGST|SGST|IGST|TCS|TOTAL|DISCOUNT|PAYABLE|ADVANCE|BALANCE|LITRE|LOTS|TDS|ASSESS_VALUE|COST|NET|GUNNY|TRANSPORT|INSURANCE|CARDAMOM|CARDAMOM_COST|GUNNY_COST|ROUND|BILAMT|COM)$/.test(h);
  }

  function fmtCell(val, col) {
    if (val === null || val === undefined || val === '') return '';
    if (typeof val === 'number') {
      const h = (col.header || '').toUpperCase();
      if (h === 'QTY' || h === 'PQTY' || h === 'LITRE') return val.toFixed(3);
      if (Number.isInteger(val)) return String(val);
      return val.toFixed(2);
    }
    return String(val);
  }

  function drawHeader(firstPage) {
    if (firstPage) {
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#000')
         .text(title, m, TOP, { width: usableW, align: 'left' });
      doc.font('Helvetica').fontSize(8).fillColor('#555')
         .text(new Date().toLocaleString('en-GB'), m, TOP + 16, { width: usableW, align: 'right' });
      if (subtitle) {
        doc.font('Helvetica').fontSize(9).fillColor('#333')
           .text(subtitle, m, TOP + 28, { width: usableW, align: 'left' });
      }
      y = BODY_TOP_FIRST;
    } else {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#000')
         .text(`${title} (continued)`, m, TOP, { width: usableW, align: 'left' });
      y = TOP + 20;
    }

    doc.rect(m, y, usableW, HEAD_H).fillAndStroke('#E8E4DD', '#999');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(8);
    columns.forEach((c, i) => {
      doc.text(c.header, colX[i] + 3, y + 4, {
        width: colWidths[i] - 6,
        align: isNumericCol(c) ? 'right' : 'left',
        lineBreak: false,
        ellipsis: true,
      });
    });
    y += HEAD_H;
  }

  function drawRow(row, i) {
    if (i % 2 === 1) doc.rect(m, y, usableW, ROW_H).fill('#F7F5F2');
    doc.fillColor('#000').font('Helvetica').fontSize(7.5);
    columns.forEach((c, ci) => {
      doc.text(fmtCell(row[c.key], c), colX[ci] + 3, y + 3, {
        width: colWidths[ci] - 6,
        align: isNumericCol(c) ? 'right' : 'left',
        lineBreak: false,
        ellipsis: true,
      });
    });
    doc.moveTo(m, y + ROW_H).lineTo(m + usableW, y + ROW_H).lineWidth(0.25).strokeColor('#DDD').stroke();
    y += ROW_H;
  }

  drawHeader(true);

  rows.forEach((row, i) => {
    if (y + ROW_H > pageH - m - (totals ? ROW_H + 12 : 12)) {
      doc.addPage();
      drawHeader(false);
    }
    drawRow(row, i);
  });

  if (totals) {
    if (y + ROW_H + 12 > pageH - m) { doc.addPage(); drawHeader(false); }
    y += 2;
    doc.rect(m, y, usableW, ROW_H + 2).fillAndStroke('#FFF3CD', '#E0B020');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(8);
    columns.forEach((c, ci) => {
      const val = totals[c.key];
      if (val === undefined || val === null || val === '') return;
      doc.text(fmtCell(val, c), colX[ci] + 3, y + 4, {
        width: colWidths[ci] - 6,
        align: isNumericCol(c) ? 'right' : 'left',
        lineBreak: false,
        ellipsis: true,
      });
    });
    y += ROW_H + 2;
  }

  doc.fillColor('#888').font('Helvetica').fontSize(7)
     .text(`Rows: ${rows.length}`, m, pageH - m - 10, { width: usableW, align: 'left' });
  doc.text('Generated by Spice Config', m, pageH - m - 10, { width: usableW, align: 'right' });

  return new Promise(resolve => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.end();
  });
}

function sumKeys(rows, keys) {
  const out = {};
  keys.forEach(k => { out[k] = rows.reduce((s, r) => s + (Number(r[k]) || 0), 0); });
  return out;
}

// ── Column defs — must match exports.js columns exactly ─────
const COLS = {
  lot_slip: [
    { header: 'STATE', key: 'state', width: 12 },
    { header: 'LOT', key: 'lot', width: 8 },
    { header: 'NAME', key: 'name', width: 30 },
    { header: 'GRADE', key: 'grade', width: 8 },
    { header: 'BAG', key: 'bag', width: 6 },
    { header: 'QTY', key: 'qty', width: 12 },
    { header: 'LITRE', key: 'litre', width: 10 },
  ],
  lot_slip_after: [
    { header: 'STATE', key: 'state', width: 12 },
    { header: 'LOT', key: 'lot', width: 8 },
    { header: 'NAME', key: 'name', width: 30 },
    { header: 'BAG', key: 'bag', width: 6 },
    { header: 'QTY', key: 'qty', width: 12 },
    { header: 'PRICE', key: 'price', width: 10 },
    { header: 'AMOUNT', key: 'amount', width: 14 },
    { header: 'CODE', key: 'code', width: 8 },
  ],
  price_list: [
    { header: 'LOT', key: 'lot', width: 8 },
    { header: 'BAG', key: 'bag', width: 6 },
    { header: 'QTY', key: 'qty', width: 12 },
    { header: 'PRICE', key: 'price', width: 10 },
    { header: 'CODE', key: 'code', width: 8 },
    { header: 'BIDDER', key: 'bidder', width: 20 },
  ],
  bank_payment: [
    { header: 'TransactionType', key: 'transactionType', width: 16 },
    { header: 'BeneIFSCode', key: 'ifsc', width: 14 },
    { header: 'BeneAcctNo', key: 'accountNo', width: 20 },
    { header: 'BeneName', key: 'beneficiaryName', width: 30 },
    { header: 'BeneAddLine1', key: 'address1', width: 30 },
    { header: 'BeneAddLine2', key: 'address2', width: 20 },
    { header: 'BeneAddLine3', key: 'pin', width: 10 },
    { header: 'Amount', key: 'amount', width: 14 },
    { header: 'SendertoRcvrInfo', key: 'remarks', width: 50 },
  ],
  pooler_register: [
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
  ],
  full_file: [
    { header: 'STATE', key: 'state', width: 10 }, { header: 'LOT', key: 'lot_no', width: 8 },
    { header: 'CROP', key: 'crop', width: 8 }, { header: 'GRADE', key: 'grade', width: 8 },
    { header: 'CRPT', key: 'crpt', width: 8 }, { header: 'BRANCH', key: 'branch', width: 12 },
    { header: 'NAME', key: 'name', width: 24 }, { header: 'CR', key: 'cr', width: 18 },
    { header: 'PAN', key: 'pan', width: 12 }, { header: 'TEL', key: 'tel', width: 12 },
    { header: 'BAG', key: 'bags', width: 6 }, { header: 'QTY', key: 'qty', width: 10 },
    { header: 'PRICE', key: 'price', width: 10 }, { header: 'AMOUNT', key: 'amount', width: 12 },
    { header: 'CODE', key: 'code', width: 8 }, { header: 'BUYER', key: 'buyer', width: 12 },
    { header: 'BUYER1', key: 'buyer1', width: 16 }, { header: 'SALE', key: 'sale', width: 6 },
    { header: 'INVO', key: 'invo', width: 8 }, { header: 'PQTY', key: 'pqty', width: 10 },
    { header: 'PRATE', key: 'prate', width: 10 }, { header: 'PURAMT', key: 'puramt', width: 12 },
    { header: 'COM', key: 'com', width: 8 }, { header: 'CGST', key: 'cgst', width: 8 },
    { header: 'SGST', key: 'sgst', width: 8 }, { header: 'IGST', key: 'igst', width: 8 },
    { header: 'ADVANCE', key: 'advance', width: 10 }, { header: 'BALANCE', key: 'balance', width: 10 },
  ],
  collection: [
    { header: 'BRANCH', key: 'branch', width: 15 },
    { header: 'NAME', key: 'name', width: 30 },
    { header: 'CR', key: 'cr', width: 25 },
    { header: 'BAG', key: 'bag', width: 6 },
    { header: 'QTY', key: 'qty', width: 12 },
    { header: 'LITRE', key: 'litre', width: 10 },
    { header: 'GRADE', key: 'grade', width: 8 },
  ],
  dealer_list: [
    { header: 'STATE', key: 'state', width: 12 },
    { header: 'NAME', key: 'name', width: 30 },
    { header: 'GSTIN', key: 'gstin', width: 18 },
    { header: 'LOTS', key: 'lots', width: 6 },
    { header: 'BAGS', key: 'bags', width: 6 },
    { header: 'QTY', key: 'qty', width: 12 },
  ],
  sales_taxes: [
    { header: 'STATE', key: 'state', width: 10 }, { header: 'SALE', key: 'sale', width: 6 },
    { header: 'INVO', key: 'invo', width: 8 }, { header: 'TRADERNAME', key: 'tradername', width: 22 },
    { header: 'BAG', key: 'bag', width: 6 }, { header: 'QTY', key: 'qty', width: 10 },
    { header: 'CARDAMOM', key: 'cardamom_cost', width: 12 },
    { header: 'GUNNY', key: 'gunny_cost', width: 10 },
    { header: 'CGST', key: 'cgst', width: 10 }, { header: 'SGST', key: 'sgst', width: 10 },
    { header: 'IGST', key: 'igst', width: 10 }, { header: 'TCS', key: 'tcs', width: 8 },
    { header: 'TRANSPORT', key: 'transport', width: 10 },
    { header: 'INSURANCE', key: 'insurance', width: 10 },
    { header: 'TOTAL', key: 'total', width: 12 },
  ],
  payment: [
    { header: 'POOLERNAME', key: 'poolername', width: 28 },
    { header: 'LOT', key: 'lot', width: 8 }, { header: 'BAG', key: 'bag', width: 6 },
    { header: 'QTY', key: 'qty', width: 10 }, { header: 'PRICE', key: 'price', width: 10 },
    { header: 'AMOUNT', key: 'amount', width: 12 }, { header: 'PQTY', key: 'pqty', width: 10 },
    { header: 'PRATE', key: 'prate', width: 10 }, { header: 'PURAMT', key: 'puramt', width: 12 },
    { header: 'DISCOUNT', key: 'discount', width: 10 },
    { header: 'PAYABLE', key: 'payable', width: 12 },
  ],
  tally_purchase: [
    { header: 'NAME', key: 'name', width: 24 }, { header: 'ADD', key: 'add', width: 24 },
    { header: 'PLACE', key: 'place', width: 12 }, { header: 'GSTIN', key: 'gstin', width: 16 },
    { header: 'TEL', key: 'tel', width: 12 }, { header: 'LOT', key: 'lot', width: 8 },
    { header: 'BAG', key: 'bag', width: 6 }, { header: 'QTY', key: 'qty', width: 10 },
    { header: 'PRICE', key: 'price', width: 10 }, { header: 'AMOUNT', key: 'amount', width: 12 },
    { header: 'CGST', key: 'cgst', width: 10 }, { header: 'SGST', key: 'sgst', width: 10 },
    { header: 'IGST', key: 'igst', width: 10 }, { header: 'DISCOUNT', key: 'discount', width: 10 },
    { header: 'BILAMT', key: 'bilamt', width: 12 },
  ],
  tds_return: [
    { header: 'INVOICE', key: 'invoice', width: 10 },
    { header: 'DATE', key: 'date', width: 12 },
    { header: 'NAME', key: 'name', width: 30 },
    { header: 'PAN', key: 'pan', width: 12 },
    { header: 'ASSESS_VALUE', key: 'assess_value', width: 14 },
    { header: 'TDS', key: 'tds', width: 12 },
  ],
};

const TOTAL_KEYS = {
  lot_slip:        ['bag', 'qty'],
  lot_slip_after:  ['bag', 'qty', 'amount'],
  price_list:      ['bag', 'qty'],
  bank_payment:    ['amount'],
  pooler_register: ['qty', 'amount', 'pqty', 'puramt'],
  full_file:       ['bags', 'qty', 'amount', 'pqty', 'puramt', 'cgst', 'sgst', 'igst', 'advance', 'balance'],
  collection:      ['bag', 'qty'],
  dealer_list:     ['lots', 'bags', 'qty'],
  sales_taxes:     ['bag', 'qty', 'cardamom_cost', 'gunny_cost', 'cgst', 'sgst', 'igst', 'tcs', 'transport', 'insurance', 'total'],
  payment:         ['bag', 'qty', 'amount', 'pqty', 'puramt', 'discount', 'payable'],
  tally_purchase:  ['bag', 'qty', 'amount', 'cgst', 'sgst', 'igst', 'discount', 'bilamt'],
  tds_return:      ['assess_value', 'tds'],
};

const TITLES = {
  lot_slip:        'Lot Slip',
  lot_slip_after:  'Lot Slip (After Trade)',
  price_list:      'Price List',
  bank_payment:    'Bank Payment (RTGS/NEFT)',
  pooler_register: 'Pooler Register',
  full_file:       'Full File',
  collection:      'Collection / Lorry',
  dealer_list:     'Dealer List',
  sales_taxes:     'Sales & Taxes',
  payment:         'Payment Summary',
  tally_purchase:  'Tally Purchase',
  tds_return:      'TDS Return',
};

async function getRowsForType(db, type, auctionId, cfg, extra) {
  switch (type) {
    case 'lot_slip':
      return db.all(
        `SELECT state, lot_no as lot, name, grade, bags as bag, qty, litre
         FROM lots WHERE auction_id = ? ${extra.state ? 'AND state = ?' : ''}
         ORDER BY lot_no`, extra.state ? [auctionId, extra.state] : [auctionId]);

    case 'lot_slip_after':
      return db.all(
        `SELECT state, lot_no as lot, name, bags as bag, qty, price, amount, code
         FROM lots WHERE auction_id = ? ${extra.state ? 'AND state = ?' : ''}
         ORDER BY lot_no`, extra.state ? [auctionId, extra.state] : [auctionId]);

    case 'price_list':
      return db.all(
        `SELECT lot_no as lot, bags as bag, qty, price, code, buyer as bidder
         FROM lots WHERE auction_id = ? ORDER BY lot_no`, [auctionId]);

    case 'bank_payment': {
      const { getBankPaymentData } = require('./calculations');
      return getBankPaymentData(db, auctionId, cfg);
    }

    case 'pooler_register':
      return db.all(
        `SELECT state, lot_no as lot, name as poolername, branch as br, qty, price, amount, pqty, prate, puramt
         FROM lots WHERE auction_id = ? AND amount > 0 ORDER BY name`, [auctionId]);

    case 'full_file':
      return db.all(`SELECT * FROM lots WHERE auction_id = ? ORDER BY lot_no`, [auctionId]);

    case 'collection':
      return db.all(
        `SELECT branch, name, cr, bags as bag, qty, litre, grade
         FROM lots WHERE auction_id = ? ORDER BY branch, name`, [auctionId]);

    case 'dealer_list':
      return db.all(
        `SELECT state, name, SUBSTR(cr, 7, 15) as gstin,
          COUNT(lot_no) as lots, SUM(bags) as bags, SUM(qty) as qty
         FROM lots WHERE auction_id = ? AND cr LIKE '%GST%' AND amount > 0
         GROUP BY state, name, cr ORDER BY state, name`, [auctionId]);

    case 'sales_taxes':
      return db.all(
        `SELECT state, sale, invo, buyer1 as tradername, bags as bag, qty,
          amount as cardamom_cost, gunny as gunny_cost,
          cgst, sgst, igst, tcs, pava_hc as transport, ins as insurance, tot as total
         FROM invoices WHERE ano = (SELECT ano FROM auctions WHERE id = ?)
         ORDER BY sale, invo`, [auctionId]);

    case 'payment': {
      // Mode-aware discount column — see exports.js exportPaymentSummary.
      const mode = (cfg && cfg.business_mode || 'e-Trade').toLowerCase();
      const discountCol = (mode === 'auction') ? 'advance' : 'refund';
      return db.all(
        `SELECT name as poolername, lot_no as lot, bags as bag, qty, price, amount,
          pqty, prate, puramt, ${discountCol} as discount, balance as payable
         FROM lots WHERE auction_id = ? AND amount > 0
         ORDER BY state, name`, [auctionId]);
    }

    case 'tally_purchase': {
      const mode = (cfg && cfg.business_mode || 'e-Trade').toLowerCase();
      const discountCol = (mode === 'auction') ? 'advance' : 'refund';
      return db.all(
        `SELECT name, padd as add, ppla as place, cr as gstin, tel,
          lot_no as lot, bags as bag, pqty as qty, prate as price, puramt as amount,
          cgst, sgst, igst, ${discountCol} as discount, puramt as bilamt
         FROM lots WHERE auction_id = ? AND amount > 0
          AND cr NOT LIKE 'GSTIN.%'
         ORDER BY name`, [auctionId]);
    }

    case 'tds_return': {
      const { getTDSReturnData } = require('./calculations');
      return getTDSReturnData(db, extra.from, extra.to, 'invoice');
    }

    default:
      throw new Error(`Unknown export type: ${type}`);
  }
}

async function exportPdf(db, type, auctionId, cfg, extra = {}) {
  const columns = COLS[type];
  if (!columns) throw new Error(`No PDF column def for type: ${type}`);

  const rows = await getRowsForType(db, type, auctionId, cfg, extra);

  const totalKeys = TOTAL_KEYS[type] || [];
  const totals = totalKeys.length && rows.length ? (() => {
    const t = sumKeys(rows, totalKeys);
    t[columns[0].key] = 'TOTAL';
    return t;
  })() : null;

  let subtitle = '';
  if (type === 'tds_return') {
    subtitle = `Period: ${extra.from || ''} to ${extra.to || ''}`;
  } else if (auctionId) {
    const auction = db.get('SELECT ano, date, crop_type FROM auctions WHERE id = ?', [auctionId]);
    if (auction) {
      const d = auction.date ? auction.date.split('-').reverse().join('/') : '';
      subtitle = `Trade #${auction.ano} — ${d}${auction.crop_type ? ' — ' + auction.crop_type : ''}`;
      if (extra.state) subtitle += ` — State: ${extra.state}`;
    }
  }

  return renderTablePdf({
    title: TITLES[type] || type,
    subtitle,
    columns,
    rows,
    totals,
  });
}

module.exports = { exportPdf, TITLES, COLS };

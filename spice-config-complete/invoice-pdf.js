/**
 * invoice-pdf.js — GST Invoice PDF generation
 * Replaces: GSTKBILT.PRG, GSTKBILP.PRG, GSTIN.PRG printer output
 */

const PDFDocument = require('pdfkit');
const { amountToWords } = require('./amount-words');

function generatePurchaseInvoicePDF(invoiceData, cfg, invoiceNo) {
  const doc = new PDFDocument({ size: 'A4', margin: 30 });
  const buffers = [];
  doc.on('data', b => buffers.push(b));
  
  const w = doc.page.width - 60; // usable width
  const x = 30;
  let y = 30;
  const { seller, lineItems, summary } = invoiceData;
  const isRegistered = seller.cr && seller.cr.includes('GSTIN');

  // Header
  doc.fontSize(8).text('ORIGINAL/DUPLICATE/TRIPLICATE', x, y, { align: 'right', width: w });
  y += 14;
  doc.fontSize(14).font('Helvetica-Bold').text('TAX INVOICE', x, y, { align: 'center', width: w });
  y += 20;
  doc.fontSize(11).text(seller.name, x, y, { align: 'center', width: w });
  y += 14;
  if (seller.address) { doc.fontSize(8).font('Helvetica').text(`${seller.address} ${seller.place || ''}`, x, y, { align: 'center', width: w }); y += 12; }
  if (seller.cr) { doc.fontSize(8).text(`GSTIN: ${seller.cr.substring(6)}`, x, y, { align: 'center', width: w }); y += 12; }
  
  y += 4;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 6;

  // Invoice details row
  doc.fontSize(8).font('Helvetica');
  doc.text(`TRANSPORT: BY ROAD`, x, y);
  doc.text(`INVOICE NO: ${cfg.inv_prefix || ''}${invoiceNo}`, x + w/2, y);
  y += 12;
  doc.text(`VEHICLE NO:`, x, y);
  doc.text(`DATE: ${new Date().toLocaleDateString('en-GB')}`, x + w/2, y);
  y += 12;
  doc.text(`STATION: ${seller.place || ''}`, x, y);
  doc.text(`PLACE OF SUPPLY: ${seller.state || ''}`, x + w/2, y);
  y += 14;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 6;

  // Billed To / Shipped To
  const companyName = cfg.s_company || cfg.short_name || 'COMPANY';
  const companyAddr = cfg.s_address1 || cfg.tn_address1 || '';
  const companyGstin = cfg.s_gstin || cfg.tn_gstin || '';
  
  doc.font('Helvetica-Bold').text('BILLED TO', x, y, { width: w/2 });
  doc.text('SHIPPED TO', x + w/2, y);
  y += 12;
  doc.font('Helvetica').fontSize(7);
  doc.text(companyName, x, y, { width: w/2 - 10 });
  doc.text(companyName, x + w/2, y);
  y += 10;
  doc.text(companyAddr, x, y, { width: w/2 - 10 });
  doc.text(companyAddr, x + w/2, y);
  y += 10;
  doc.text(`GSTIN: ${companyGstin}`, x, y, { width: w/2 - 10 });
  doc.text(`GSTIN: ${companyGstin}`, x + w/2, y);
  y += 14;

  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 4;

  // Description
  doc.fontSize(8).font('Helvetica-Bold').text(`Description of Goods: CARDAMOM`, x, y, { width: w/2 });
  doc.text(`HSN CODE: ${cfg.hsn_cardamom || '09083120'}`, x + w/2, y);
  y += 14;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 4;

  // Table header
  const cols = [
    { label: 'LOT', x: x, w: 35 },
    { label: 'QTY', x: x+35, w: 55 },
    { label: 'PRICE', x: x+90, w: 50 },
    { label: 'VALUE', x: x+140, w: 65 },
    { label: 'TAXABLE', x: x+205, w: 70 },
    { label: 'CGST', x: x+275, w: 55 },
    { label: 'SGST', x: x+330, w: 55 },
    { label: 'IGST', x: x+385, w: 55 },
  ];

  doc.font('Helvetica-Bold').fontSize(7);
  cols.forEach(c => doc.text(c.label, c.x, y, { width: c.w, align: 'right' }));
  y += 12;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 4;

  // Line items
  doc.font('Helvetica').fontSize(7);
  for (const li of lineItems) {
    if (y > 680) { doc.addPage(); y = 30; }
    doc.text(li.lot, cols[0].x, y, { width: cols[0].w, align: 'right' });
    doc.text((li.pqty || li.qty).toFixed(3), cols[1].x, y, { width: cols[1].w, align: 'right' });
    doc.text((li.prate || li.price).toFixed(2), cols[2].x, y, { width: cols[2].w, align: 'right' });
    doc.text(li.amount.toFixed(2), cols[3].x, y, { width: cols[3].w, align: 'right' });
    doc.text(li.puramt.toFixed(2), cols[4].x, y, { width: cols[4].w, align: 'right' });
    doc.text(li.cgst ? li.cgst.toFixed(2) : '', cols[5].x, y, { width: cols[5].w, align: 'right' });
    doc.text(li.sgst ? li.sgst.toFixed(2) : '', cols[6].x, y, { width: cols[6].w, align: 'right' });
    doc.text(li.igst ? li.igst.toFixed(2) : '', cols[7].x, y, { width: cols[7].w, align: 'right' });
    y += 11;
  }

  y += 4;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 4;

  // Totals
  doc.font('Helvetica-Bold').fontSize(7);
  doc.text('TOTAL', cols[0].x, y, { width: cols[0].w, align: 'right' });
  doc.text(summary.totalQty.toFixed(3), cols[1].x, y, { width: cols[1].w, align: 'right' });
  doc.text(summary.totalPuramt.toFixed(2), cols[4].x, y, { width: cols[4].w, align: 'right' });
  doc.text(summary.totalCgst ? summary.totalCgst.toFixed(2) : '', cols[5].x, y, { width: cols[5].w, align: 'right' });
  doc.text(summary.totalSgst ? summary.totalSgst.toFixed(2) : '', cols[6].x, y, { width: cols[6].w, align: 'right' });
  doc.text(summary.totalIgst ? summary.totalIgst.toFixed(2) : '', cols[7].x, y, { width: cols[7].w, align: 'right' });
  y += 14;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 6;

  // Summary box
  const sumX = x + w/2;
  const sumW = w/2;
  const summaryLines = [
    ['Total Taxable Value', summary.totalPuramt],
    ['Total Integrated Tax', summary.totalIgst],
    ['Total Central Tax', summary.totalCgst],
    ['Total State Tax', summary.totalSgst],
    ['Round UP/DOWN', summary.roundDiff],
    ['Total Value', summary.grandTotal],
  ];
  
  doc.font('Helvetica').fontSize(8);
  for (const [label, val] of summaryLines) {
    const isBold = label === 'Total Value';
    if (isBold) doc.font('Helvetica-Bold');
    doc.text(label, sumX, y, { width: sumW/2 });
    doc.text(val.toFixed(2), sumX + sumW/2, y, { width: sumW/2, align: 'right' });
    if (isBold) doc.font('Helvetica');
    y += 12;
  }

  // TDS
  if (summary.tdsAmount > 0) {
    y += 2;
    doc.text('TDS on Purchase of Goods [U/S 194Q]', sumX, y, { width: sumW/2 });
    doc.text(`-${summary.tdsAmount.toFixed(2)}`, sumX + sumW/2, y, { width: sumW/2, align: 'right' });
    y += 12;
    doc.font('Helvetica-Bold');
    doc.text('Invoice Amount', sumX, y, { width: sumW/2 });
    doc.text(summary.invoiceAmount.toFixed(2), sumX + sumW/2, y, { width: sumW/2, align: 'right' });
    doc.font('Helvetica');
    y += 14;
  }

  // Amount in words
  y += 4;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 6;
  const amtForWords = summary.tdsAmount > 0 ? summary.invoiceAmount : summary.grandTotal;
  doc.font('Helvetica-Bold').fontSize(8);
  doc.text(amountToWords(Math.round(amtForWords)), x, y, { width: w });
  y += 16;

  // Signature
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 6;
  doc.font('Helvetica').fontSize(8);
  doc.text(`For ${seller.name}`, x + w - 150, y, { width: 150, align: 'right' });
  y += 40;
  doc.text('Authorised Signatory', x + w - 150, y, { width: 150, align: 'right' });

  return new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.end();
  });
}

/**
 * Generate a crop receipt PDF (CROASP.PRG equivalent)
 */
function generateCropReceiptPDF(lot, cfg) {
  const doc = new PDFDocument({ size: [595, 420], margin: 25 }); // half-page
  const buffers = [];
  doc.on('data', b => buffers.push(b));
  
  const w = 545; const x = 25; let y = 25;

  doc.rect(x, y, w, 370).stroke();
  y += 10;
  doc.fontSize(16).font('Helvetica-Bold').text('RECEIPT', x, y, { align: 'center', width: w });
  y += 20;
  doc.fontSize(8).font('Helvetica').text(`Sl.No: ${lot.crop || ''}`, x + w - 100, y - 10, { width: 90, align: 'right' });
  
  const companyName = cfg.s_company || cfg.short_name || '';
  doc.fontSize(11).font('Helvetica-Bold').text(companyName, x, y, { align: 'center', width: w });
  y += 14;
  doc.fontSize(7).font('Helvetica');
  doc.text(cfg.s_address1 || cfg.tn_address1 || '', x, y, { align: 'center', width: w }); y += 10;
  doc.text(`GST No. ${cfg.s_gstin || cfg.tn_gstin || ''}`, x, y, { align: 'center', width: w }); y += 16;

  // Details grid
  const details = [
    ['Trade No', lot.ano || ''],
    ['Lot No', lot.lot_no || ''],
    ['Date', new Date().toLocaleDateString('en-GB')],
    ['No. of Bags', String(lot.bags || '')],
    ['Nett Weight', String(lot.qty || '')],
    ['Depot', lot.branch || ''],
  ];

  doc.fontSize(8);
  let col = 0;
  for (const [label, val] of details) {
    const cx = x + 10 + (col % 3) * 180;
    const cy = y + Math.floor(col / 3) * 16;
    doc.font('Helvetica').text(`${label}: `, cx, cy, { continued: true });
    doc.font('Helvetica-Bold').text(val);
    col++;
  }
  y += 40;

  // Declaration text
  doc.font('Helvetica').fontSize(7);
  doc.text(`We acknowledge the receipt of Cardamom as per the description above, from`, x + 10, y, { width: w - 20 });
  y += 11;
  doc.text(`M/s. ${lot.name || ''}`, x + 10, y, { width: w - 20 }); y += 11;
  doc.text(`GSTIN/CR No. ${lot.cr || ''}`, x + 10, y, { width: w - 20 }); y += 18;

  // Signatures
  y += 30;
  doc.text('Pooler Signature', x + 10, y);
  doc.text('[ Contact Number ]', x + w/2 - 50, y, { width: 100, align: 'center' });
  doc.text('Depot in Charge', x + w - 120, y);

  return new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.end();
  });
}

module.exports = { generatePurchaseInvoicePDF, generateCropReceiptPDF, generateAgriBillPDF, generateSalesInvoicePDF };

/**
 * Sales Invoice PDF (GSTIN.PRG / KGSTIN.PRG equivalent)
 * Tax invoice issued BY the company TO the buyer.
 * - Sale type 'L' (Local)       → CGST + SGST
 * - Sale type 'I' (Inter-state) → IGST
 * - Sale type 'E' (Export)      → Zero-rated
 */
function generateSalesInvoicePDF(invoiceData, cfg, saleType, invoiceNo, invoiceDate) {
  const doc = new PDFDocument({ size: 'A4', margin: 30 });
  const buffers = [];
  doc.on('data', b => buffers.push(b));

  const w = doc.page.width - 60;
  const x = 30;
  let y = 30;
  const { buyer, lineItems, summary } = invoiceData;

  // Company details from config (issuer)
  const companyName = cfg.s_company || cfg.short_name || 'COMPANY';
  const companyAddr = cfg.s_address1 || cfg.tn_address1 || '';
  const companyPlace = cfg.s_place || cfg.tn_place || '';
  const companyPin = cfg.s_pin || cfg.tn_pin || '';
  const companyState = cfg.s_state || cfg.tn_state || 'TAMIL NADU';
  const companyStCode = cfg.s_st_code || cfg.tn_st_code || '33';
  const companyGstin = cfg.s_gstin || cfg.tn_gstin || '';
  const companyPan = cfg.s_pan || cfg.tn_pan || '';

  // Header
  doc.fontSize(8).text('ORIGINAL FOR RECIPIENT / DUPLICATE FOR TRANSPORTER / TRIPLICATE FOR SUPPLIER', x, y, { align: 'right', width: w });
  y += 14;
  doc.fontSize(14).font('Helvetica-Bold').text('TAX INVOICE', x, y, { align: 'center', width: w });
  y += 20;

  // Supplier (company)
  doc.fontSize(11).font('Helvetica-Bold').text(companyName, x, y, { align: 'center', width: w });
  y += 14;
  doc.fontSize(8).font('Helvetica').text(`${companyAddr} ${companyPlace} ${companyPin}`, x, y, { align: 'center', width: w });
  y += 10;
  doc.text(`State: ${companyState} (Code: ${companyStCode})`, x, y, { align: 'center', width: w });
  y += 10;
  if (companyGstin) { doc.text(`GSTIN: ${companyGstin}  |  PAN: ${companyPan}`, x, y, { align: 'center', width: w }); y += 12; }

  y += 4;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 6;

  // Invoice number + date
  const saleLabel = saleType === 'L' ? 'LOCAL' : saleType === 'I' ? 'INTER-STATE' : saleType === 'E' ? 'EXPORT' : '';
  doc.fontSize(8).font('Helvetica-Bold').text(`INVOICE NO: ${saleType}-${invoiceNo}`, x, y);
  doc.text(`DATE: ${invoiceDate ? new Date(invoiceDate).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB')}`, x + w / 2, y);
  y += 12;
  doc.text(`TYPE: ${saleLabel}`, x, y);
  y += 12;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 6;

  // Buyer (bill-to)
  doc.font('Helvetica-Bold').fontSize(9).text('BILL TO:', x, y);
  y += 12;
  doc.font('Helvetica').fontSize(9).text(buyer.buyer1 || buyer.buyer || '', x, y);
  y += 11;
  if (buyer.add1 || buyer.add2) {
    doc.fontSize(8).text([buyer.add1, buyer.add2].filter(Boolean).join(', '), x, y, { width: w });
    y += 10;
  }
  doc.fontSize(8);
  if (buyer.pla) { doc.text(`${buyer.pla}${buyer.pin ? ' - ' + buyer.pin : ''}`, x, y); y += 10; }
  if (buyer.state) { doc.text(`State: ${buyer.state}${buyer.st_code ? ' (Code: ' + buyer.st_code + ')' : ''}`, x, y); y += 10; }
  if (buyer.gstin) { doc.text(`GSTIN: ${buyer.gstin}`, x, y); y += 10; }
  if (buyer.pan) { doc.text(`PAN: ${buyer.pan}`, x, y); y += 10; }

  y += 6;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 4;

  // HSN
  doc.fontSize(8).font('Helvetica-Bold').text(`Description: CARDAMOM`, x, y);
  doc.text(`HSN: ${cfg.hsn_cardamom || '09083120'}`, x + w - 110, y, { width: 110 });
  y += 14;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 4;

  // Table
  const cols = [
    { label: 'LOT',    x: x,        w: 45,  align: 'left' },
    { label: 'GRADE',  x: x + 45,   w: 50,  align: 'left' },
    { label: 'BAGS',   x: x + 95,   w: 45,  align: 'right' },
    { label: 'QTY(KG)', x: x + 140, w: 70,  align: 'right' },
    { label: 'RATE',   x: x + 210,  w: 70,  align: 'right' },
    { label: 'AMOUNT (Rs.)', x: x + 280, w: 100, align: 'right' },
  ];
  doc.font('Helvetica-Bold').fontSize(8);
  cols.forEach(c => doc.text(c.label, c.x, y, { width: c.w, align: c.align }));
  y += 12;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 4;

  doc.font('Helvetica').fontSize(8);
  for (const li of lineItems) {
    if (y > 680) { doc.addPage(); y = 30; }
    doc.text(li.lot || '', cols[0].x, y, { width: cols[0].w });
    doc.text(String(li.grade || ''), cols[1].x, y, { width: cols[1].w });
    doc.text(String(li.bags || 0), cols[2].x, y, { width: cols[2].w, align: 'right' });
    doc.text((li.qty || 0).toFixed(3), cols[3].x, y, { width: cols[3].w, align: 'right' });
    doc.text((li.price || 0).toFixed(2), cols[4].x, y, { width: cols[4].w, align: 'right' });
    doc.text((li.amount || 0).toFixed(2), cols[5].x, y, { width: cols[5].w, align: 'right' });
    y += 11;
  }
  y += 4;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 4;

  doc.font('Helvetica-Bold').fontSize(8);
  doc.text('TOTAL', cols[0].x, y);
  doc.text(String(summary.totalBags || 0), cols[2].x, y, { width: cols[2].w, align: 'right' });
  doc.text((summary.totalQty || 0).toFixed(3), cols[3].x, y, { width: cols[3].w, align: 'right' });
  doc.text((summary.totalAmount || 0).toFixed(2), cols[5].x, y, { width: cols[5].w, align: 'right' });
  y += 16;

  // Summary block (right-aligned)
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 6;
  const sumX = x + w / 2;
  const sumW = w / 2;
  const sumRow = (lbl, val, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    doc.text(lbl, sumX, y, { width: sumW / 2 });
    doc.text((val || 0).toFixed(2), sumX + sumW / 2, y, { width: sumW / 2, align: 'right' });
    y += 12;
  };

  sumRow('Taxable Value', summary.totalAmount);
  if (summary.gunnyCost)     sumRow('Gunny',           summary.gunnyCost);
  if (summary.transportCost) sumRow('Transport',       summary.transportCost);
  if (summary.insuranceCost) sumRow('Insurance',       summary.insuranceCost);
  if (summary.cgst)          sumRow(`CGST @ ${(cfg.gst_goods/2)||2.5}%`, summary.cgst);
  if (summary.sgst)          sumRow(`SGST @ ${(cfg.gst_goods/2)||2.5}%`, summary.sgst);
  if (summary.igst)          sumRow(`IGST @ ${cfg.gst_goods||5}%`,       summary.igst);
  if (summary.tcs)           sumRow('TCS', summary.tcs);
  if (summary.roundDiff)     sumRow('Round UP/DOWN',   summary.roundDiff);

  doc.moveTo(sumX, y).lineTo(x + w, y).stroke(); y += 4;
  sumRow('GRAND TOTAL', summary.grandTotal, true);
  y += 4;

  // Amount in words
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 6;
  doc.fontSize(8).font('Helvetica-Bold').text('Amount in Words:', x, y);
  y += 12;
  doc.font('Helvetica').text(amountToWords(summary.grandTotal), x, y, { width: w });
  y += 20;

  // Bank details footer
  if (cfg.bank_name && cfg.bank_acctnum) {
    doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 6;
    doc.fontSize(8).font('Helvetica-Bold').text('Bank Details:', x, y);
    y += 12;
    doc.font('Helvetica').fontSize(8);
    doc.text(`Bank: ${cfg.bank_name}    A/C No: ${cfg.bank_acctnum}    IFSC: ${cfg.bank_ifsc || ''}`, x, y, { width: w });
    y += 16;
  }

  // Signatures
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 30;
  doc.font('Helvetica').fontSize(8);
  doc.text('Customer Signature', x, y);
  doc.text(`For ${companyName}`, x + w - 180, y, { width: 180, align: 'right' });
  y += 36;
  doc.text('Receiver', x, y);
  doc.font('Helvetica-Bold').text('Authorised Signatory', x + w - 180, y, { width: 180, align: 'right' });

  return new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.end();
  });
}

/**
 * Agriculturist Bill of Supply PDF (GSTKBILP.PRG / GSTBILP.PRG equivalent)
 * For non-GSTIN sellers — no GST charged
 */
function generateAgriBillPDF(billData, cfg, billNo) {
  const doc = new PDFDocument({ size: 'A4', margin: 30 });
  const buffers = [];
  doc.on('data', b => buffers.push(b));
  
  const w = doc.page.width - 60;
  const x = 30;
  let y = 30;
  const { seller, lineItems, summary } = billData;

  // Header
  doc.fontSize(8).text('ORIGINAL/DUPLICATE/TRIPLICATE', x, y, { align: 'right', width: w });
  y += 14;
  doc.fontSize(14).font('Helvetica-Bold').text('BILL OF SUPPLY', x, y, { align: 'center', width: w });
  y += 5;
  doc.fontSize(9).font('Helvetica').text(cfg.commission_bill || 'COMMISSION BILL', x, y, { align: 'center', width: w });
  y += 18;

  const companyName = cfg.s_company || cfg.short_name || 'COMPANY';
  const companyAddr = cfg.s_address1 || cfg.tn_address1 || '';
  const companyGstin = cfg.s_gstin || cfg.tn_gstin || '';
  doc.fontSize(11).font('Helvetica-Bold').text(companyName, x, y, { align: 'center', width: w });
  y += 14;
  doc.fontSize(8).font('Helvetica').text(companyAddr, x, y, { align: 'center', width: w });
  y += 12;
  doc.text(`GSTIN: ${companyGstin}`, x, y, { align: 'center', width: w });
  y += 14;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 6;

  // Bill details
  doc.fontSize(8).font('Helvetica');
  doc.text(`BILL NO: ${billNo}`, x, y);
  doc.text(`DATE: ${new Date().toLocaleDateString('en-GB')}`, x + w/2, y);
  y += 14;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 6;

  // Seller details
  doc.font('Helvetica-Bold').text('SELLER (Agriculturist)', x, y);
  y += 12;
  doc.font('Helvetica').fontSize(8);
  doc.text(seller.name, x, y); y += 10;
  if (seller.address) { doc.text(seller.address, x, y); y += 10; }
  if (seller.place) { doc.text(`${seller.place} ${seller.pin || ''}`, x, y); y += 10; }
  if (seller.state) { doc.text(`State: ${seller.state} (Code: ${seller.st_code || ''})`, x, y); y += 10; }
  if (seller.pan) { doc.text(`PAN: ${seller.pan}`, x, y); y += 10; }
  if (seller.aadhar) { doc.text(`Aadhar: ${seller.aadhar}`, x, y); y += 10; }
  if (seller.tel) { doc.text(`Tel: ${seller.tel}`, x, y); y += 10; }
  
  y += 6;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 6;

  // Description
  doc.fontSize(8).font('Helvetica-Bold').text(`Description: CARDAMOM (Agricultural Produce — Exempt)`, x, y);
  doc.text(`HSN: ${cfg.hsn_cardamom || '09083120'}`, x + w - 100, y, { width: 100 });
  y += 14;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 4;

  // Table
  const cols = [
    { label: 'LOT', x: x, w: 50 },
    { label: 'QTY (KG)', x: x + 50, w: 90 },
    { label: 'RATE (₹)', x: x + 140, w: 90 },
    { label: 'AMOUNT (₹)', x: x + 230, w: 120 },
  ];
  doc.font('Helvetica-Bold').fontSize(8);
  cols.forEach(c => doc.text(c.label, c.x, y, { width: c.w, align: 'right' }));
  y += 12;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 4;

  doc.font('Helvetica').fontSize(8);
  for (const li of lineItems) {
    if (y > 680) { doc.addPage(); y = 30; }
    doc.text(li.lot, cols[0].x, y, { width: cols[0].w, align: 'right' });
    doc.text((li.pqty || li.qty).toFixed(3), cols[1].x, y, { width: cols[1].w, align: 'right' });
    doc.text((li.prate || li.price).toFixed(2), cols[2].x, y, { width: cols[2].w, align: 'right' });
    doc.text((li.puramt || li.amount).toFixed(2), cols[3].x, y, { width: cols[3].w, align: 'right' });
    y += 11;
  }
  y += 4;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 4;

  doc.font('Helvetica-Bold').fontSize(8);
  doc.text('TOTAL', cols[0].x, y, { width: cols[0].w, align: 'right' });
  doc.text(summary.totalQty.toFixed(3), cols[1].x, y, { width: cols[1].w, align: 'right' });
  doc.text(summary.totalPuramt.toFixed(2), cols[3].x, y, { width: cols[3].w, align: 'right' });
  y += 16;

  // Summary
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 6;
  const sumX = x + w/2;
  const sumW = w/2;
  doc.font('Helvetica').fontSize(8);
  doc.text('Total Value', sumX, y, { width: sumW/2 });
  doc.text(summary.totalPuramt.toFixed(2), sumX + sumW/2, y, { width: sumW/2, align: 'right' });
  y += 12;
  if (summary.roundDiff) {
    doc.text('Round UP/DOWN', sumX, y, { width: sumW/2 });
    doc.text(summary.roundDiff.toFixed(2), sumX + sumW/2, y, { width: sumW/2, align: 'right' });
    y += 12;
  }
  doc.font('Helvetica-Bold');
  doc.text('NET AMOUNT', sumX, y, { width: sumW/2 });
  doc.text(summary.netAmount.toFixed(2), sumX + sumW/2, y, { width: sumW/2, align: 'right' });
  y += 16;

  // Amount in words
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 6;
  doc.fontSize(8).text(amountToWords(summary.netAmount), x, y, { width: w });
  y += 20;

  // Certification statement
  doc.fontSize(7).font('Helvetica-Oblique');
  doc.text('Certified that the above agricultural produce is purchased from the agriculturist and no GST is applicable as per GST Act exemption.', x, y, { width: w });
  y += 24;

  // Signatures
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 6;
  doc.font('Helvetica').fontSize(8);
  doc.text(`Received by: ${seller.name}`, x, y);
  doc.text(`For ${companyName}`, x + w - 150, y, { width: 150, align: 'right' });
  y += 40;
  doc.text('Signature of Seller', x, y);
  doc.text('Authorised Signatory', x + w - 150, y, { width: 150, align: 'right' });

  return new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.end();
  });
}

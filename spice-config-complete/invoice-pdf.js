/**
 * invoice-pdf.js — GST Invoice PDF generation
 * Replaces: GSTKBILT.PRG, GSTKBILP.PRG, GSTIN.PRG printer output
 */

const PDFDocument = require('pdfkit');
const { amountToWords } = require('./amount-words');

// ── Invoice number formatter ──────────────────────────────────────
// Format: {inv_prefix}/{saleType}-{invoiceNo}/{season_short}
// Examples:
//   Sales:    "ISP/L-9/26-27"
//   Purchase: "ISP/9/26-27"   (no saleType segment)
// Separators are hardcoded: "/" outer, "-" between saleType & invoiceNo.
function formatInvoiceNo(cfg, saleType, invoiceNo) {
  const prefix = cfg.inv_prefix || '';
  const season = cfg.season_short || '';
  // Middle segment: "L-9" if saleType present, else just "9"
  const middle = saleType ? `${saleType}-${invoiceNo}` : String(invoiceNo);
  const parts  = [prefix, middle, season].filter(p => p !== '' && p != null);
  return parts.join('/');
}

// ── Indian number formatter (lakhs style) ──────────────────────
// Produces strings like "4,25,356.80" instead of "425,356.80"
function formatINR(n, decimals = 2) {
  const num = Number(n || 0);
  const sign = num < 0 ? '-' : '';
  const abs  = Math.abs(num);
  const parts = abs.toFixed(decimals).split('.');
  let intPart = parts[0];
  const dec = parts[1] || '';
  // Indian grouping: last 3, then pairs
  let formatted;
  if (intPart.length <= 3) {
    formatted = intPart;
  } else {
    const last3 = intPart.slice(-3);
    const rest  = intPart.slice(0, -3);
    formatted = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }
  return sign + formatted + (dec ? '.' + dec : '');
}

// ── Effective company details based on business_state ────────────
// ── Effective company details based on mode + state ─────────────
// e-Trade + KL   → use sister.* (ASP)
// e-Trade + TN   → use company.* / address_tn.* (ISP)
// e-Auction      → always use company.* / address based on state (ISP fields)
//
// Sister Company is an e-Trade-only concept. In e-Auction mode the user
// picks one state and stays there — the Company section alone is used.
function effectiveCompany(cfg) {
  const state = (cfg.business_state || '').toUpperCase();
  const mode  = (cfg.business_mode  || '').toLowerCase();
  const useASP = (mode === 'e-trade' && state === 'KERALA');

  if (useASP) {
    return {
      logo:    cfg.s_logo     || 'ASP',
      name:    cfg.s_company  || cfg.s_short_name || '',
      short:   cfg.s_short_name || cfg.s_company  || '',
      pan:     cfg.s_pan      || '',
      cin:     cfg.s_cin      || '',
      fssai:   cfg.s_fssai    || '',
      sbl:     cfg.s_sbl      || '',
      address1: cfg.s_address1 || '',
      address2: cfg.s_address2 || '',
      place:   cfg.s_place    || '',
      pin:     cfg.s_pin      || '',
      stateName: cfg.s_state  || 'KERALA',
      stateCode: cfg.s_st_code || '32',
      phone:   cfg.s_phone    || '',
      email:   cfg.s_email    || '',
      gstin:   cfg.s_gstin    || '',
    };
  }
  // ISP: company.* + address matching state (TN uses address_tn, KL uses address_kl)
  const isStateKL = (state === 'KERALA');
  return {
    logo:    cfg.logo        || 'ISP',
    name:    cfg.short_name  || cfg.trade_name || '',
    short:   cfg.short_name  || cfg.trade_name || '',
    pan:     cfg.pan         || '',
    cin:     cfg.cin         || '',
    fssai:   cfg.fssai       || '',
    sbl:     cfg.sbl         || '',
    address1: isStateKL ? (cfg.kl_address1 || cfg.tn_address1 || '') : (cfg.tn_address1 || ''),
    address2: isStateKL ? (cfg.kl_address2 || cfg.tn_address2 || '') : (cfg.tn_address2 || ''),
    place:   isStateKL ? (cfg.kl_place || cfg.tn_place || '') : (cfg.tn_place || ''),
    pin:     isStateKL ? (cfg.kl_pin || cfg.tn_pin || '') : (cfg.tn_pin || ''),
    stateName: isStateKL ? 'KERALA' : 'TAMIL NADU',
    stateCode: isStateKL ? '32' : '33',
    phone:   isStateKL ? (cfg.kl_phone || cfg.tn_phone || '') : (cfg.tn_phone || ''),
    email:   isStateKL ? (cfg.kl_email || cfg.tn_email || '') : (cfg.tn_email || ''),
    gstin:   isStateKL ? (cfg.kl_gstin || cfg.tn_gstin || '') : (cfg.tn_gstin || ''),
  };
}

function generatePurchaseInvoicePDF(invoiceData, cfg, invoiceNo) {
  const co = effectiveCompany(cfg);
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
  doc.text(`INVOICE NO: ${formatInvoiceNo(cfg, '', invoiceNo)}`, x + w/2, y);
  y += 12;
  doc.text(`VEHICLE NO:`, x, y);
  doc.text(`DATE: ${new Date().toLocaleDateString('en-GB')}`, x + w/2, y);
  y += 12;
  doc.text(`STATION: ${seller.place || ''}`, x, y);
  doc.text(`PLACE OF SUPPLY: ${seller.state || ''}`, x + w/2, y);
  y += 14;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 6;

  // Billed To / Shipped To
  const companyName = co.name || "COMPANY";
  const companyAddr = co.address1;
  const companyGstin = co.gstin;
  
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

  // Table header — LOT, BAGS, GR, QTY, PRICE, VALUE, TAXABLE, CGST, SGST, IGST
  const cols = [
    { label: 'LOT',     x: x,        w: 30 },
    { label: 'BAGS',    x: x+30,     w: 28 },
    { label: 'GR',      x: x+58,     w: 20 },
    { label: 'QTY',     x: x+78,     w: 48 },
    { label: 'PRICE',   x: x+126,    w: 44 },
    { label: 'VALUE',   x: x+170,    w: 58 },
    { label: 'TAXABLE', x: x+228,    w: 62 },
    { label: 'CGST',    x: x+290,    w: 50 },
    { label: 'SGST',    x: x+340,    w: 50 },
    { label: 'IGST',    x: x+390,    w: 50 },
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
    doc.text(String(li.bags || 0), cols[1].x, y, { width: cols[1].w, align: 'right' });
    doc.text(String(li.grade || ''), cols[2].x, y, { width: cols[2].w, align: 'right' });
    doc.text((li.pqty || li.qty).toFixed(3), cols[3].x, y, { width: cols[3].w, align: 'right' });
    doc.text((li.prate || li.price).toFixed(2), cols[4].x, y, { width: cols[4].w, align: 'right' });
    doc.text(li.amount.toFixed(2), cols[5].x, y, { width: cols[5].w, align: 'right' });
    doc.text(li.puramt.toFixed(2), cols[6].x, y, { width: cols[6].w, align: 'right' });
    doc.text(li.cgst ? li.cgst.toFixed(2) : '-', cols[7].x, y, { width: cols[7].w, align: 'right' });
    doc.text(li.sgst ? li.sgst.toFixed(2) : '-', cols[8].x, y, { width: cols[8].w, align: 'right' });
    doc.text(li.igst ? li.igst.toFixed(2) : '-', cols[9].x, y, { width: cols[9].w, align: 'right' });
    y += 11;
  }

  y += 4;
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); y += 4;

  // Totals
  doc.font('Helvetica-Bold').fontSize(7);
  doc.text('TOTAL', cols[0].x, y, { width: cols[0].w, align: 'right' });
  doc.text(String(summary.totalBags || 0), cols[1].x, y, { width: cols[1].w, align: 'right' });
  doc.text(summary.totalQty.toFixed(3), cols[3].x, y, { width: cols[3].w, align: 'right' });
  doc.text(summary.totalPuramt.toFixed(2), cols[6].x, y, { width: cols[6].w, align: 'right' });
  doc.text(summary.totalCgst ? summary.totalCgst.toFixed(2) : '', cols[7].x, y, { width: cols[7].w, align: 'right' });
  doc.text(summary.totalSgst ? summary.totalSgst.toFixed(2) : '', cols[8].x, y, { width: cols[8].w, align: 'right' });
  doc.text(summary.totalIgst ? summary.totalIgst.toFixed(2) : '', cols[9].x, y, { width: cols[9].w, align: 'right' });
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
  const co = effectiveCompany(cfg);
  const doc = new PDFDocument({ size: [595, 420], margin: 25 }); // half-page
  const buffers = [];
  doc.on('data', b => buffers.push(b));
  
  const w = 545; const x = 25; let y = 25;

  doc.rect(x, y, w, 370).stroke();
  y += 10;
  doc.fontSize(16).font('Helvetica-Bold').text('RECEIPT', x, y, { align: 'center', width: w });
  y += 20;
  doc.fontSize(8).font('Helvetica').text(`Sl.No: ${lot.crop || ''}`, x + w - 100, y - 10, { width: 90, align: 'right' });
  
  const companyName = co.name;
  doc.fontSize(11).font('Helvetica-Bold').text(companyName, x, y, { align: 'center', width: w });
  y += 14;
  doc.fontSize(7).font('Helvetica');
  doc.text(co.address1, x, y, { align: 'center', width: w }); y += 10;
  doc.text(`GST No. ${co.gstin}`, x, y, { align: 'center', width: w }); y += 16;

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
 * Sales Invoice PDF (Tax Invoice)
 * Grid-based layout matching the legal GST format:
 *   - Supplier (ISPL) top-left with logo
 *   - Invoice metadata grid top-right (Invoice No, Date, Other References, etc.)
 *   - Consignee (Ship to) + Buyer (Bill to) stacked on left
 *   - Dispatch From (sister company ASP) on right
 *   - Line items table with HSN/SAC, Shipped/Billed qty, Rate, Amount
 *   - HSN summary + tax breakup
 *   - Bank details + signature block
 * GST logic:
 *   - Sale 'L' (Local)       → CGST + SGST
 *   - Sale 'I' (Inter-state) → IGST
 *   - Sale 'E' (Export)      → Zero-rated
 */
function generateSalesInvoicePDF(invoiceData, cfg, saleType, invoiceNo, invoiceDate) {
  const co = effectiveCompany(cfg);
  const doc = new PDFDocument({ size: 'A4', margin: 20 });
  const buffers = [];
  doc.on('data', b => buffers.push(b));

  const { buyer, lineItems, summary } = invoiceData;

  // ── Page geometry ───────────────────────────────────────────
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 20;
  const x0 = margin;
  const x1 = pageW - margin;
  const W  = x1 - x0;
  let y = margin;

  // ── Cell drawing helpers ────────────────────────────────────
  // Draws a bordered box and optionally text inside. Does NOT advance y.
  function box(bx, by, bw, bh) {
    doc.lineWidth(0.5).rect(bx, by, bw, bh).stroke();
  }
  // Draw text inside a cell with optional padding and label/value style.
  // opts: {font, size, align, label, labelFont, labelSize, color}
  function cellText(bx, by, bw, bh, text, opts = {}) {
    const pad = opts.pad != null ? opts.pad : 3;
    const size = opts.size || 8;
    const font = opts.font || 'Helvetica';
    doc.font(font).fontSize(size);
    if (opts.color) doc.fillColor(opts.color);
    const align = opts.align || 'left';
    doc.text(text || '', bx + pad, by + pad, { width: bw - pad * 2, height: bh - pad * 2, align, lineBreak: opts.lineBreak !== false });
    if (opts.color) doc.fillColor('#000');
  }
  // Draw a labeled cell: small label on top, value below in bold
  function labeledCell(bx, by, bw, bh, label, value, opts = {}) {
    box(bx, by, bw, bh);
    doc.font('Helvetica').fontSize(7).fillColor('#000');
    doc.text(label, bx + 3, by + 2, { width: bw - 6 });
    if (value) {
      doc.font(opts.valueFont || 'Helvetica-Bold').fontSize(opts.valueSize || 9);
      doc.text(value, bx + 3, by + 11, { width: bw - 6 });
    }
  }

  // Draws ONLY the vertical dividers + outer left/right borders for a row
  // in the line-items table. Use this instead of `box()` for row rendering
  // so horizontal lines don't appear between rows. Horizontal boundaries
  // around the whole table are drawn once at the top (under header) and once
  // at the bottom (under the total row).
  function rowVerticals(ry, rh, skipBilledSplit) {
    // Outer left/right borders
    doc.lineWidth(0.5);
    doc.moveTo(x0, ry).lineTo(x0, ry + rh).stroke();
    doc.moveTo(x0 + W, ry).lineTo(x0 + W, ry + rh).stroke();
    // Inner column dividers
    for (const k of cols) {
      const cx = colX(k);
      if (cx <= x0) continue;
      if (skipBilledSplit && k === 'billed') continue;
      doc.moveTo(cx, ry).lineTo(cx, ry + rh).stroke();
    }
  }

  // Alternate-row stripes for line-items + HSN summary tables.
  // Controlled by the `flag_invoice_stripe` setting (default on).
  // IMPORTANT: getSettingsFlat coerces boolean settings to real JS booleans,
  // so cfg.flag_invoice_stripe may be `true` or `false` — NOT strings.
  // Using `|| 'true'` would convert `false` to the default, hiding the toggle.
  // Treat undefined/null as the default (on); any other value must be interpreted literally.
  function readFlag(val, defaultOn) {
    if (val === undefined || val === null || val === '') return defaultOn;
    if (typeof val === 'boolean') return val;
    return String(val).toLowerCase() === 'true';
  }
  const STRIPE_ON = readFlag(cfg.flag_invoice_stripe, true);
  const STRIPE_COLOR = '#ECECEC';
  function stripeFill(ry, rh, rowIndex) {
    if (!STRIPE_ON) return;
    if (rowIndex % 2 !== 1) return; // only odd rows (alternate)
    doc.save();
    doc.rect(x0, ry, W, rh).fillColor(STRIPE_COLOR).fill();
    doc.restore();
    doc.fillColor('#000'); // reset for text
  }

  // ── Title ───────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(10).text('Tax Invoice', x0, y, { width: W, align: 'center' });
  y += 14;

  // ── TOP HEADER BLOCK ────────────────────────────────────────
  // Left half: Logo + ISPL details
  // Right half: 2-col sub-grid (Invoice No, e-Way Bill No, Dated / Delivery Note, Mode/Terms / Ref No., Other Refs)
  const topY = y;
  const leftW = W * 0.5;
  const rightW = W - leftW;
  const leftX = x0;
  const rightX = x0 + leftW;

  // Right-side grid cell sizes — 2 rows, sized so combined height matches
  // the left company-details block (logo + name + address + GSTIN + State + CIN).
  const topHeaderH = 80;
  const rRow = topHeaderH / 2;       // 40pt each row
  const rCell = rightW / 2;          // each cell's width for 2-col rows

  // ── LEFT BLOCK: Logo + company details ──────────────────────
  box(leftX, topY, leftW, topHeaderH);
  // Logo area (if logo file exists, use it; else show text)
  // Sales invoices always issued by ISPL (supplier), so use the ISPL logo.
  const logoPath = require('path').join(__dirname, 'public', 'logo-ispl.png');
  const fs = require('fs');
  let logoDrawn = false;
  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, leftX + 4, topY + 4, { fit: [60, 60] });
      logoDrawn = true;
    } catch (_) { /* fall through to text */ }
  }
  const textX = leftX + (logoDrawn ? 70 : 8);
  const textW = leftW - (logoDrawn ? 78 : 16);
  let ty = topY + 4;
  doc.font('Helvetica-Bold').fontSize(10).text(co.name || '', textX, ty, { width: textW });
  ty += 12;
  doc.font('Helvetica').fontSize(8);
  const addrLine = [co.address1, co.address2, co.place, co.stateName, co.pin].filter(Boolean).join(', ');
  doc.text(addrLine, textX, ty, { width: textW });
  ty += doc.heightOfString(addrLine, { width: textW });
  if (co.gstin) { doc.text(`GSTIN/UIN: ${co.gstin}`, textX, ty, { width: textW }); ty += 10; }
  if (co.stateName) { doc.text(`State Name : ${co.stateName}, Code : ${co.stateCode}`, textX, ty, { width: textW }); ty += 10; }
  if (co.cin) { doc.text(`CIN: ${co.cin}`, textX, ty, { width: textW }); ty += 10; }

  // ── RIGHT BLOCK: 2-row metadata grid ────────────────────────
  // Row 1: Invoice No | e-Way Bill No | Dated
  // Row 2: Reference No. & Date | Other References

  const r1W = rightW / 3;
  let ry = topY;

  // Row 1
  labeledCell(rightX,             ry, r1W, rRow, 'Invoice No.', formatInvoiceNo(cfg, saleType, invoiceNo));
  labeledCell(rightX + r1W,       ry, r1W, rRow, 'e-Way Bill No.', '');
  labeledCell(rightX + r1W * 2,   ry, rightW - r1W * 2, rRow, 'Dated', (() => {
    const d = invoiceDate ? new Date(invoiceDate) : new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const mon = d.toLocaleDateString('en-US', { month: 'short' });
    const yr  = String(d.getFullYear()).slice(-2);
    return `${day}-${mon}-${yr}`;
  })());
  ry += rRow;

  // Row 2 — Other References = same number with ASP prefix
  const sisterPrefix = cfg.inv_prefix_sister || 'ASP';
  const otherRefCfg = { ...cfg, inv_prefix: sisterPrefix };
  const otherRefs = formatInvoiceNo(otherRefCfg, saleType, invoiceNo);
  labeledCell(rightX,         ry, rCell, rRow, 'Reference No. & Date.', '');
  labeledCell(rightX + rCell, ry, rCell, rRow, 'Other References', otherRefs);

  y = topY + topHeaderH;

  // ── MIDDLE BLOCK: Consignee + Buyer + Dispatch ──────────────
  // Left column: Consignee (Ship to) stacked above Buyer (Bill to)
  // Right column: Dispatched through | Destination (top row)
  //               Dispatch From (ASP) — fills remaining height

  const midH = 150; // total middle-block height
  const midY = y;

  // Left column: 2 stacked cells
  const leftCellH = midH / 2;
  const consigneeY = midY;
  const buyerY = midY + leftCellH;

  // Consignee (Ship to) — uses consignee fields if present, else falls back to buyer
  const hasConsignee = !!(buyer.cbuyer1 || buyer.cadd1 || buyer.cpla || buyer.cgstin);
  const ship = hasConsignee ? {
    name: buyer.cbuyer1 || buyer.buyer1 || buyer.buyer || '',
    addr: buyer.cadd1 || '',
    pla:  buyer.cpla  || '',
    pin:  buyer.cpin  || '',
    state: buyer.cstate || '',
    stCode: buyer.cst_code || '',
    gstin: buyer.cgstin || '',
  } : {
    name: buyer.buyer1 || buyer.buyer || '',
    addr: [buyer.add1, buyer.add2].filter(Boolean).join(','),
    pla: buyer.pla || '',
    pin: buyer.pin || '',
    state: buyer.state || '',
    stCode: buyer.st_code || '',
    gstin: buyer.gstin || '',
  };

  // Draw Consignee cell
  box(leftX, consigneeY, leftW, leftCellH);
  let cy = consigneeY + 3;
  doc.font('Helvetica').fontSize(7).text('Consignee (Ship to)', leftX + 3, cy); cy += 9;
  doc.font('Helvetica-Bold').fontSize(9).text(ship.name, leftX + 3, cy, { width: leftW - 6 }); cy += 11;
  doc.font('Helvetica').fontSize(8);
  const lW = leftW - 6;
  const writeLeft = (txt, anchor) => {
    if (!txt) return;
    doc.text(txt, leftX + 3, anchor.v, { width: lW });
    anchor.v += doc.heightOfString(txt, { width: lW }) + 1;
  };
  const cAnchor = { v: cy };
  writeLeft(ship.addr, cAnchor);
  writeLeft(ship.pla,  cAnchor);
  if (ship.gstin) writeLeft(`GSTIN/UIN      : ${ship.gstin}`, cAnchor);
  if (ship.state) writeLeft(`State Name     : ${ship.state}, Code : ${ship.stCode || ''}`, cAnchor);

  // Draw Buyer (Bill to) cell
  box(leftX, buyerY, leftW, leftCellH);
  let by = buyerY + 3;
  doc.font('Helvetica').fontSize(7).text('Buyer (Bill to)', leftX + 3, by); by += 9;
  doc.font('Helvetica-Bold').fontSize(9).text(buyer.buyer1 || buyer.buyer || '', leftX + 3, by, { width: leftW - 6 }); by += 11;
  doc.font('Helvetica').fontSize(8);
  const bAddr = [buyer.add1, buyer.add2].filter(Boolean).join(',');
  const bAnchor = { v: by };
  writeLeft(bAddr, bAnchor);
  writeLeft(buyer.pla, bAnchor);
  if (buyer.gstin) writeLeft(`GSTIN/UIN      : ${buyer.gstin}`, bAnchor);
  if (buyer.state) writeLeft(`State Name     : ${buyer.state}, Code : ${buyer.st_code || ''}`, bAnchor);

  // Right column: 2 rows now (Dispatched through | Destination, Dispatch From)
  const rSmall = 28;
  let ry2 = midY;

  labeledCell(rightX,         ry2, rCell, rSmall, 'Dispatched through', cfg.dispatched_through || '');
  labeledCell(rightX + rCell, ry2, rCell, rSmall, 'Destination', cfg.dispatch_destination || '');
  ry2 += rSmall;

  // Dispatch From block (sister company) — fills remaining middle height
  const dispatchFromH = midH - rSmall;
  box(rightX, ry2, rightW, dispatchFromH);
  const dispatchY = ry2;
  doc.font('Helvetica-Bold').fontSize(8).text('Dispatch From:', rightX + 3, dispatchY + 4, { width: rightW - 6 });
  doc.font('Helvetica-Bold').fontSize(9).text(cfg.s_company || 'AMAZING SPICE PARK PRIVATE LIMITED', rightX + 3, dispatchY + 14, { width: rightW - 6 });
  doc.font('Helvetica').fontSize(8);
  // Advance dy by actual rendered height so wrapped text doesn't overlap next line.
  let dy = dispatchY + 26;
  const dispW = rightW - 6;
  const writeLine = (txt) => {
    if (!txt) return;
    doc.text(txt, rightX + 3, dy, { width: dispW });
    dy += doc.heightOfString(txt, { width: dispW }) + 1;
  };
  writeLine(cfg.s_address1);
  writeLine(cfg.s_address2);
  if (cfg.s_state) writeLine(`${cfg.s_state} Code:${cfg.s_st_code || '32'}`);
  if (cfg.s_gstin) writeLine(`GSTIN.${cfg.s_gstin}`);

  y = midY + midH;

  // ── LINE ITEMS TABLE ────────────────────────────────────────
  // Columns: Sl | Token | Bags | Description | HSN/SAC | Shipped | Billed | Rate | per | Amount
  // Amount is now fixed (~95pt) — enough for values up to "1,00,00,000.00" (1 crore).
  // Extra width goes to Description instead of Amount.
  const colW = {
    sl:    22,
    token: 40,
    bags:  34,
    desc:  0,    // fills remainder
    hsn:   52,
    shipped: 60,
    billed:  60,
    rate:  48,
    per:   20,
    amount: 95,
  };
  const fixedSum = Object.values(colW).reduce((a, b) => a + b, 0);
  colW.desc = W - fixedSum;

  const cols = ['sl', 'token', 'bags', 'desc', 'hsn', 'shipped', 'billed', 'rate', 'per', 'amount'];
  function colX(key) {
    let cx = x0;
    for (const k of cols) { if (k === key) return cx; cx += colW[k]; }
    return cx;
  }

  const hdrH = 24;
  const rowH = 14;
  // Reserve space at bottom of every page for a "continued" notice + margin
  const bottomReserve = 30;
  const pageBottom = pageH - margin - bottomReserve;

  // Draw the line-items table header at the current y.
  // Extracted into a function so it can be re-drawn at the top of each new page.
  function drawTableHeader() {
    box(x0, y, W, hdrH);
    for (const k of cols) {
      const cx = colX(k);
      if (cx <= x0) continue;
      if (k === 'billed') {
        doc.moveTo(cx, y + 12).lineTo(cx, y + hdrH).stroke();
      } else {
        doc.moveTo(cx, y).lineTo(cx, y + hdrH).stroke();
      }
    }
    const qtyX = colX('shipped');
    const qtyW = colW.shipped + colW.billed;
    doc.moveTo(qtyX, y + 12).lineTo(qtyX + qtyW, y + 12).stroke();
    doc.font('Helvetica').fontSize(7);
    doc.text('Quantity', qtyX, y + 3, { width: qtyW, align: 'center' });
    doc.text('Shipped', qtyX, y + 14, { width: colW.shipped, align: 'center' });
    doc.text('Billed', qtyX + colW.shipped, y + 14, { width: colW.billed, align: 'center' });
    const hdr = {
      sl:    ['SI', 'No.'],
      token: ['Lot', 'No'],
      bags:  ['No. of', 'Bags'],
      desc:  ['Description of Goods', ''],
      hsn:   ['HSN/SAC', ''],
      rate:  ['Rate', ''],
      per:   ['per', ''],
      amount: ['Amount', ''],
    };
    for (const k of Object.keys(hdr)) {
      const [l1, l2] = hdr[k];
      const cx = colX(k);
      doc.text(l1, cx + 2, y + 3, { width: colW[k] - 4, align: 'center' });
      if (l2) doc.text(l2, cx + 2, y + 13, { width: colW[k] - 4, align: 'center' });
    }
    y += hdrH;
  }

  // If the next row wouldn't fit on the current page, close the current table,
  // emit a new page, and redraw the table header at the top.
  function ensureRoomFor(neededH) {
    if (y + neededH <= pageBottom) return;
    // Close the table with a horizontal line so the last row has a bottom border
    doc.lineWidth(0.5).moveTo(x0, y).lineTo(x0 + W, y).stroke();
    // Bottom notice: "Continued..." right-aligned
    doc.font('Helvetica-Oblique').fontSize(7)
       .text('Continued on next page...', x0, y + 4, { width: W, align: 'right' });
    doc.font('Helvetica');
    // New page
    doc.addPage({ size: 'A4', margin: margin });
    y = margin;
    // Small top note that this is a continuation
    doc.font('Helvetica-Oblique').fontSize(7)
       .text(`Tax Invoice — ${formatInvoiceNo(cfg, saleType, invoiceNo)} (continued)`,
             x0, y, { width: W, align: 'center' });
    doc.font('Helvetica');
    y += 12;
    // Redraw the column header
    drawTableHeader();
  }

  // Draw initial table header
  drawTableHeader();

  // Line item rows
  doc.font('Helvetica').fontSize(8);
  const hsnCardamom = cfg.hsn_cardamom || '09083120';
  const hsnGunny    = cfg.hsn_gunny    || '63051040';

  let sl = 1;
  for (const li of lineItems) {
    ensureRoomFor(rowH);
    stripeFill(y, rowH, sl - 1);
    rowVerticals(y, rowH);
    doc.text(String(sl), colX('sl') + 2, y + 3, { width: colW.sl - 4, align: 'center' });
    doc.text(String(li.lot || ''), colX('token') + 2, y + 3, { width: colW.token - 4, align: 'center' });
    doc.text(String(li.bags || ''), colX('bags') + 2, y + 3, { width: colW.bags - 4, align: 'center' });
    doc.font('Helvetica-Bold').text('Cardamom', colX('desc') + 4, y + 3, { width: colW.desc - 8 });
    doc.font('Helvetica');
    doc.text(hsnCardamom, colX('hsn') + 2, y + 3, { width: colW.hsn - 4, align: 'center' });
    doc.text(`${li.qty.toFixed(3)} Kgs.`, colX('shipped') + 2, y + 3, { width: colW.shipped - 4, align: 'right' , lineBreak: false});
    doc.font('Helvetica-Bold').text(`${li.qty.toFixed(3)} Kgs.`, colX('billed') + 2, y + 3, { width: colW.billed - 4, align: 'right' , lineBreak: false});
    doc.font('Helvetica-Bold').text(formatINR(li.price), colX('rate') + 2, y + 3, { width: colW.rate - 4, align: 'right' });
    doc.font('Helvetica').text('Kgs.', colX('per') + 2, y + 3, { width: colW.per - 4, align: 'center' });
    doc.font('Helvetica-Bold').text(formatINR(li.amount), colX('amount') + 2, y + 3, { width: colW.amount - 4, align: 'right' });
    doc.font('Helvetica');
    y += rowH;
    sl++;
  }

  // Before drawing summary rows: estimate the total remaining height and
  // push to next page if it won't fit. Keeps the summary block intact.
  //   Gunny row:    rowH (if applicable)
  //   Transport:    rowH (if applicable)
  //   Insurance:    rowH (if applicable)
  //   Subtotal:     rowH
  //   GST rows:     rowH × (isInterState ? 1 : 2)
  //   Round-off:    rowH
  //   Total:        rowH + 2
  //   Amount words: 24
  //   HSN summary:  ~20 header + 14×up-to-4 rows + 14 total = ~90
  //   Tax words:    16
  //   Bank/Sig:     90
  const gunnyH     = (summary.totalBags > 0 && summary.gunnyCost > 0) ? rowH : 0;
  const transportH = (summary.transportCost > 0) ? rowH : 0;
  const insuranceH = (summary.insuranceCost > 0) ? rowH : 0;
  const gstRowCount = summary.isInterState ? 1 : 2;
  const summaryBlockH = gunnyH + transportH + insuranceH
                      + rowH + (rowH * gstRowCount) + rowH + (rowH + 2)
                      + 24 + 90 + 16 + 90 + 10; // +10 buffer
  ensureRoomFor(summaryBlockH);

  // Gunny row
  if (summary.totalBags > 0 && summary.gunnyCost > 0) {
    stripeFill(y, rowH, sl - 1);
    rowVerticals(y, rowH);
    doc.text(String(sl), colX('sl') + 2, y + 3, { width: colW.sl - 4, align: 'center' });
    doc.font('Helvetica-Bold').text('Gunny', colX('desc') + 4, y + 3, { width: colW.desc - 8 });
    doc.font('Helvetica');
    doc.text(hsnGunny, colX('hsn') + 2, y + 3, { width: colW.hsn - 4, align: 'center' });
    doc.text(`${summary.totalBags} Nos.`, colX('shipped') + 2, y + 3, { width: colW.shipped - 4, align: 'right' });
    const gunnyRate = (cfg.gunny_rate || 165).toFixed(2);
    doc.font('Helvetica-Bold').text(gunnyRate, colX('rate') + 2, y + 3, { width: colW.rate - 4, align: 'right' });
    doc.font('Helvetica').text('Nos.', colX('per') + 2, y + 3, { width: colW.per - 4, align: 'center' });
    doc.font('Helvetica-Bold').text(formatINR(summary.gunnyCost), colX('amount') + 2, y + 3, { width: colW.amount - 4, align: 'right' });
    doc.font('Helvetica');
    y += rowH;
    sl++;
  }

  // Transport row (SAC: transport service)
  // Rate depends on sale type: L → local_transport, else → transport
  // Use pickRate (not `||`) so that 0 is respected as an explicit user value.
  const pickRate = (...vals) => {
    for (const v of vals) {
      if (v === undefined || v === null || v === '') continue;
      const n = typeof v === 'number' ? v : parseFloat(v);
      if (!Number.isNaN(n)) return n;
    }
    return 0;
  };
  const isLocalSale = (saleType === 'L');
  const transportRate = isLocalSale
    ? pickRate(cfg.local_transport, cfg.transport, 2.5)
    : pickRate(cfg.transport, 2.5);
  const sacTransport = cfg.sac_transport || '996791';
  if (summary.transportCost > 0) {
    stripeFill(y, rowH, sl - 1);
    rowVerticals(y, rowH);
    doc.text(String(sl), colX('sl') + 2, y + 3, { width: colW.sl - 4, align: 'center' });
    doc.font('Helvetica-Bold').text('Transport', colX('desc') + 4, y + 3, { width: colW.desc - 8 });
    doc.font('Helvetica');
    doc.text(sacTransport, colX('hsn') + 2, y + 3, { width: colW.hsn - 4, align: 'center' });
    doc.text(`${summary.totalQty.toFixed(3)} Kgs.`, colX('shipped') + 2, y + 3, { width: colW.shipped - 4, align: 'right' , lineBreak: false});
    doc.font('Helvetica-Bold').text(transportRate.toFixed(2), colX('rate') + 2, y + 3, { width: colW.rate - 4, align: 'right' });
    doc.font('Helvetica').text('Kgs.', colX('per') + 2, y + 3, { width: colW.per - 4, align: 'center' });
    doc.font('Helvetica-Bold').text(formatINR(summary.transportCost), colX('amount') + 2, y + 3, { width: colW.amount - 4, align: 'right' });
    doc.font('Helvetica');
    y += rowH;
    sl++;
  }

  // Insurance row (SAC: insurance service)
  // Amount = ((cardamom + gunny) + GST on them) / 1000 × insurance_rate
  // Rate depends on sale type: L → local_insurance, else → insurance
  const insuranceRate = isLocalSale
    ? pickRate(cfg.local_insurance, cfg.insurance, 0.75)
    : pickRate(cfg.insurance, 0.75);
  const sacInsurance = cfg.sac_insurance || '997136';
  if (summary.insuranceCost > 0) {
    stripeFill(y, rowH, sl - 1);
    rowVerticals(y, rowH);
    doc.text(String(sl), colX('sl') + 2, y + 3, { width: colW.sl - 4, align: 'center' });
    doc.font('Helvetica-Bold').text('Insurance', colX('desc') + 4, y + 3, { width: colW.desc - 8 });
    doc.font('Helvetica');
    doc.text(sacInsurance, colX('hsn') + 2, y + 3, { width: colW.hsn - 4, align: 'center' });
    doc.font('Helvetica-Bold').text(insuranceRate.toFixed(2), colX('rate') + 2, y + 3, { width: colW.rate - 4, align: 'right' });
    doc.font('Helvetica-Bold').text(formatINR(summary.insuranceCost), colX('amount') + 2, y + 3, { width: colW.amount - 4, align: 'right' });
    doc.font('Helvetica');
    y += rowH;
    sl++;
  }

  // Subtotal row = taxable value (cardamom + gunny + transport + insurance)
  const subtotal = summary.taxableValue;
  rowVerticals(y, rowH);
  doc.font('Helvetica-Bold').text(formatINR(subtotal), colX('amount') + 2, y + 3, { width: colW.amount - 4, align: 'right' });
  y += rowH;

  // GST rows — separate row per tax component
  const gstGoods = cfg.gst_goods || 5;
  const gstRate = gstGoods / 2;

  function drawTaxRow(label, amount) {
    rowVerticals(y, rowH);
    doc.font('Helvetica-BoldOblique').text(label, colX('desc') + 4, y + 3, { width: colW.desc + colW.hsn + colW.shipped + colW.billed - 8 });
    doc.font('Helvetica-Bold').text(formatINR(amount), colX('amount') + 2, y + 3, { width: colW.amount - 4, align: 'right' });
    doc.font('Helvetica');
    y += rowH;
  }

  if (summary.isInterState) {
    drawTaxRow(`OUTPUT IGST ${gstGoods}%`, summary.igst);
  } else {
    drawTaxRow(`OUTPUT CGST ${gstRate}%`, summary.cgst);
    drawTaxRow(`OUTPUT SGST ${gstRate}%`, summary.sgst);
  }

  // Round on/off row
  rowVerticals(y, rowH);
  doc.font('Helvetica-BoldOblique').text('Round On/off', colX('desc') + 4, y + 3, { width: colW.desc + colW.hsn - 8 });
  doc.font('Helvetica-Bold').text(formatINR(summary.roundDiff), colX('amount') + 2, y + 3, { width: colW.amount - 4, align: 'right' });
  doc.font('Helvetica');
  y += rowH;

  // Total row (bold) — shipped|billed divider skipped so total qty spans both
  // Draw a horizontal line above Total to visually separate it from the summary rows.
  doc.lineWidth(0.5).moveTo(x0, y).lineTo(x0 + W, y).stroke();
  const totalRowH = rowH + 2;
  rowVerticals(y, totalRowH, /*skipBilledSplit*/ true);
  doc.font('Helvetica-Bold').fontSize(8);
  doc.text(String(summary.totalBags), colX('bags') + 2, y + 4, { width: colW.bags - 4, align: 'center' });
  doc.text('Total', colX('desc') + 4, y + 4, { width: colW.desc - 8 });
  doc.text(`${summary.totalQty.toFixed(3)} Kgs.`, colX('shipped') + 2, y + 4, { width: colW.shipped + colW.billed - 4, align: 'right' , lineBreak: false});
  // Grand total: right-align with extra padding so it doesn't touch the border
  // (No ₹ symbol — PDFKit's Helvetica doesn't support U+20B9 and renders garbage)
  doc.fontSize(9).text(formatINR(summary.grandTotal), colX('amount') + 2, y + 4, { width: colW.amount - 6, align: 'right' });
  doc.fontSize(8);
  y += totalRowH;
  // Close the line-items table with a single horizontal line at the bottom
  doc.lineWidth(0.5).moveTo(x0, y).lineTo(x0 + W, y).stroke();

  // ── AMOUNT IN WORDS ─────────────────────────────────────────
  const amtWordsH = 24;
  box(x0, y, W, amtWordsH);
  doc.font('Helvetica').fontSize(7).text('Amount Chargeable (in words)', x0 + 3, y + 2);
  doc.font('Helvetica').fontSize(7).text('E. & O.E', x0, y + 2, { width: W - 4, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(9).text(`INR ${amountToWords(summary.grandTotal)} Only`, x0 + 3, y + 11, { width: W - 6 });
  y += amtWordsH;

  // ── HSN SUMMARY TABLE ───────────────────────────────────────
  // Columns: HSN/SAC | Taxable Value | IGST Rate | IGST Amount | Total Tax Amount
  //   OR: HSN/SAC | Taxable Value | CGST Rate | CGST Amt | SGST Rate | SGST Amt | Total Tax Amount
  const isInter = summary.isInterState;
  const hsnRows = [];
  // Helper: build one HSN summary row for a taxable amount at gstGoods rate
  function hsnRow(hsn, taxable) {
    return {
      hsn,
      taxable,
      rate: gstGoods,
      cgst: isInter ? 0 : +(taxable * gstGoods / 2 / 100).toFixed(2),
      sgst: isInter ? 0 : +(taxable * gstGoods / 2 / 100).toFixed(2),
      igst: isInter ? +(taxable * gstGoods / 100).toFixed(2) : 0,
    };
  }
  hsnRows.push(hsnRow(hsnCardamom, summary.totalAmount));
  if (summary.gunnyCost > 0)     hsnRows.push(hsnRow(hsnGunny, summary.gunnyCost));
  if (summary.transportCost > 0) hsnRows.push(hsnRow(sacTransport, summary.transportCost));
  if (summary.insuranceCost > 0) hsnRows.push(hsnRow(sacInsurance, summary.insuranceCost));

  const hsnHdrH = 20;
  const hsnRowH = 12;
  const hsnCols = isInter
    ? { hsn: 160, taxable: 90, rateLbl: 'IGST', rate: 60, amt: 90, total: 0 }
    : { hsn: 130, taxable: 80, cgstRate: 40, cgstAmt: 60, sgstRate: 40, sgstAmt: 60, total: 0 };
  const hsnFixed = Object.entries(hsnCols).filter(([k]) => typeof hsnCols[k] === 'number').reduce((a, [, v]) => a + v, 0);
  hsnCols.total = W - hsnFixed;

  // Header
  box(x0, y, W, hsnHdrH);
  if (isInter) {
    let cx = x0;
    doc.font('Helvetica').fontSize(7);
    doc.text('HSN/SAC', cx + 2, y + 2, { width: hsnCols.hsn - 4, align: 'center' });
    doc.moveTo(cx + hsnCols.hsn, y).lineTo(cx + hsnCols.hsn, y + hsnHdrH).stroke();
    cx += hsnCols.hsn;
    doc.text('Taxable', cx + 2, y + 2, { width: hsnCols.taxable - 4, align: 'center' });
    doc.text('Value', cx + 2, y + 11, { width: hsnCols.taxable - 4, align: 'center' });
    doc.moveTo(cx + hsnCols.taxable, y).lineTo(cx + hsnCols.taxable, y + hsnHdrH).stroke();
    cx += hsnCols.taxable;
    const igstW = hsnCols.rate + hsnCols.amt;
    doc.text('IGST', cx + 2, y + 2, { width: igstW - 4, align: 'center' });
    doc.moveTo(cx, y + 10).lineTo(cx + igstW, y + 10).stroke();
    doc.text('Rate', cx + 2, y + 12, { width: hsnCols.rate - 4, align: 'center' });
    doc.text('Amount', cx + hsnCols.rate + 2, y + 12, { width: hsnCols.amt - 4, align: 'center' });
    doc.moveTo(cx + hsnCols.rate, y + 10).lineTo(cx + hsnCols.rate, y + hsnHdrH).stroke();
    doc.moveTo(cx + igstW, y).lineTo(cx + igstW, y + hsnHdrH).stroke();
    cx += igstW;
    doc.text('Total', cx + 2, y + 2, { width: hsnCols.total - 4, align: 'center' });
    doc.text('Tax Amount', cx + 2, y + 11, { width: hsnCols.total - 4, align: 'center' });
  } else {
    let cx = x0;
    doc.font('Helvetica').fontSize(7);
    doc.text('HSN/SAC', cx + 2, y + 2, { width: hsnCols.hsn - 4, align: 'center' });
    doc.moveTo(cx + hsnCols.hsn, y).lineTo(cx + hsnCols.hsn, y + hsnHdrH).stroke();
    cx += hsnCols.hsn;
    doc.text('Taxable Value', cx + 2, y + 6, { width: hsnCols.taxable - 4, align: 'center' });
    doc.moveTo(cx + hsnCols.taxable, y).lineTo(cx + hsnCols.taxable, y + hsnHdrH).stroke();
    cx += hsnCols.taxable;
    const cgstW = hsnCols.cgstRate + hsnCols.cgstAmt;
    doc.text('CGST', cx + 2, y + 2, { width: cgstW - 4, align: 'center' });
    doc.moveTo(cx, y + 10).lineTo(cx + cgstW, y + 10).stroke();
    doc.text('Rate', cx + 2, y + 12, { width: hsnCols.cgstRate - 4, align: 'center' });
    doc.text('Amount', cx + hsnCols.cgstRate + 2, y + 12, { width: hsnCols.cgstAmt - 4, align: 'center' });
    doc.moveTo(cx + hsnCols.cgstRate, y + 10).lineTo(cx + hsnCols.cgstRate, y + hsnHdrH).stroke();
    doc.moveTo(cx + cgstW, y).lineTo(cx + cgstW, y + hsnHdrH).stroke();
    cx += cgstW;
    const sgstW = hsnCols.sgstRate + hsnCols.sgstAmt;
    doc.text('SGST', cx + 2, y + 2, { width: sgstW - 4, align: 'center' });
    doc.moveTo(cx, y + 10).lineTo(cx + sgstW, y + 10).stroke();
    doc.text('Rate', cx + 2, y + 12, { width: hsnCols.sgstRate - 4, align: 'center' });
    doc.text('Amount', cx + hsnCols.sgstRate + 2, y + 12, { width: hsnCols.sgstAmt - 4, align: 'center' });
    doc.moveTo(cx + hsnCols.sgstRate, y + 10).lineTo(cx + hsnCols.sgstRate, y + hsnHdrH).stroke();
    doc.moveTo(cx + sgstW, y).lineTo(cx + sgstW, y + hsnHdrH).stroke();
    cx += sgstW;
    doc.text('Total Tax Amount', cx + 2, y + 6, { width: hsnCols.total - 4, align: 'center' });
  }
  y += hsnHdrH;

  // HSN rows — vertical-only dividers + alternate-row stripe
  // Builds column x-positions once per call to avoid repeating arithmetic.
  function hsnColBoundaries() {
    // Returns [x0, afterHsn, afterTaxable, ..., x0+W]
    const xs = [x0];
    let cx = x0 + hsnCols.hsn;  xs.push(cx);
    cx += hsnCols.taxable;      xs.push(cx);
    if (isInter) {
      cx += hsnCols.rate;        xs.push(cx);
      cx += hsnCols.amt;         xs.push(cx);
    } else {
      cx += hsnCols.cgstRate;    xs.push(cx);
      cx += hsnCols.cgstAmt;     xs.push(cx);
      cx += hsnCols.sgstRate;    xs.push(cx);
      cx += hsnCols.sgstAmt;     xs.push(cx);
    }
    xs.push(x0 + W); // right edge (Total Tax Amount)
    return xs;
  }
  const hsnXs = hsnColBoundaries();

  function hsnRowVerticals(ry, rh) {
    doc.lineWidth(0.5);
    for (const hx of hsnXs) {
      doc.moveTo(hx, ry).lineTo(hx, ry + rh).stroke();
    }
  }

  function drawHsnRow(row, isTotal, rowIndex) {
    // Stripe first, then verticals, then text
    stripeFill(y, hsnRowH, rowIndex);
    hsnRowVerticals(y, hsnRowH);
    let cx = x0;
    doc.font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    doc.text(row.hsn, cx + 2, y + 2, { width: hsnCols.hsn - 4 });
    cx += hsnCols.hsn;
    doc.text(formatINR(row.taxable), cx + 2, y + 2, { width: hsnCols.taxable - 4, align: 'right' });
    cx += hsnCols.taxable;
    if (isInter) {
      doc.text(`${row.rate}%`, cx + 2, y + 2, { width: hsnCols.rate - 4, align: 'center' });
      doc.text(formatINR(row.igst), cx + hsnCols.rate + 2, y + 2, { width: hsnCols.amt - 4, align: 'right' });
      cx += hsnCols.rate + hsnCols.amt;
      doc.text(formatINR(row.igst), cx + 2, y + 2, { width: hsnCols.total - 4, align: 'right' });
    } else {
      doc.text(`${row.rate / 2}%`, cx + 2, y + 2, { width: hsnCols.cgstRate - 4, align: 'center' });
      doc.text(formatINR(row.cgst), cx + hsnCols.cgstRate + 2, y + 2, { width: hsnCols.cgstAmt - 4, align: 'right' });
      cx += hsnCols.cgstRate + hsnCols.cgstAmt;
      doc.text(`${row.rate / 2}%`, cx + 2, y + 2, { width: hsnCols.sgstRate - 4, align: 'center' });
      doc.text(formatINR(row.sgst), cx + hsnCols.sgstRate + 2, y + 2, { width: hsnCols.sgstAmt - 4, align: 'right' });
      cx += hsnCols.sgstRate + hsnCols.sgstAmt;
      doc.text(formatINR(row.cgst + row.sgst), cx + 2, y + 2, { width: hsnCols.total - 4, align: 'right' });
    }
    doc.font('Helvetica');
    y += hsnRowH;
  }

  for (let i = 0; i < hsnRows.length; i++) drawHsnRow(hsnRows[i], false, i);
  // Total row
  const totRow = {
    hsn: 'Total',
    taxable: hsnRows.reduce((a, r) => a + r.taxable, 0),
    rate: gstGoods,
    cgst: hsnRows.reduce((a, r) => a + r.cgst, 0),
    sgst: hsnRows.reduce((a, r) => a + r.sgst, 0),
    igst: hsnRows.reduce((a, r) => a + r.igst, 0),
  };
  drawHsnRow(totRow, true, hsnRows.length);
  // Close the HSN summary with a horizontal line so the last row has a bottom border
  doc.lineWidth(0.5).moveTo(x0, y).lineTo(x0 + W, y).stroke();

  // ── TAX IN WORDS ────────────────────────────────────────────
  const taxAmount = summary.cgst + summary.sgst + summary.igst;
  const taxWordsH = 16;
  box(x0, y, W, taxWordsH);
  doc.font('Helvetica').fontSize(7).text('Tax Amount (in words) :', x0 + 3, y + 4);
  doc.font('Helvetica-Bold').fontSize(9).text(`INR ${amountToWords(taxAmount)} Only`, x0 + 110, y + 3, { width: W - 120 });
  y += taxWordsH;

  // ── BANK + SIGNATURE BLOCK ──────────────────────────────────
  const footerH = 90;
  box(x0, y, W, footerH);
  doc.moveTo(x0 + leftW, y).lineTo(x0 + leftW, y + footerH).stroke();

  // Left: Company PAN + Declaration
  let fy = y + 6;
  doc.font('Helvetica').fontSize(8);
  doc.text(`Company's PAN     : `, x0 + 4, fy, { continued: true }).font('Helvetica-Bold').text(co.pan || '');
  fy += 16;
  doc.font('Helvetica').fontSize(8).text('Declaration', x0 + 4, fy); fy += 11;
  doc.fontSize(7).text('We declare that this invoice shows the actual price of the goods', x0 + 4, fy, { width: leftW - 8 }); fy += 10;
  doc.text('described and that all particulars are true and correct.', x0 + 4, fy, { width: leftW - 8 });

  // Right: Bank details (top), "for COMPANY" (middle), Authorised Signatory (bottom-right)
  let bky = y + 6;
  const bkX = rightX + 4;
  const bkInnerW = rightW - 8;
  doc.font('Helvetica').fontSize(8).text("Company's Bank Details", bkX, bky); bky += 11;
  const bankName = cfg.business_state === 'KERALA' ? (cfg.bank_kl_name || '') : (cfg.bank_tn_name || '');
  const bankAcct = cfg.business_state === 'KERALA' ? (cfg.bank_kl_acct || '') : (cfg.bank_tn_acct || '');
  const bankIfsc = cfg.business_state === 'KERALA' ? (cfg.bank_kl_ifsc || '') : (cfg.bank_tn_ifsc || '');
  // Align values at a fixed x so all three rows start at the same column
  const labelW = 90;
  const valX = bkX + labelW;
  const valW = bkInnerW - labelW;
  doc.font('Helvetica').fontSize(8).text('Bank Name', bkX, bky, { width: labelW });
  doc.font('Helvetica').text(':', bkX + labelW - 8, bky);
  doc.font('Helvetica-Bold').text(bankName, valX, bky, { width: valW });
  bky += 10;
  doc.font('Helvetica').text('A/c No.', bkX, bky, { width: labelW });
  doc.font('Helvetica').text(':', bkX + labelW - 8, bky);
  doc.font('Helvetica-Bold').text(bankAcct, valX, bky, { width: valW });
  bky += 10;
  doc.font('Helvetica').text('Branch & IFS Code', bkX, bky, { width: labelW });
  doc.font('Helvetica').text(':', bkX + labelW - 8, bky);
  const branchLbl = (bankName.split('-')[1] || bankName).trim();
  doc.font('Helvetica-Bold').text(`${branchLbl} & ${bankIfsc}`, valX, bky, { width: valW });
  bky += 14;
  // "for COMPANY NAME" right-aligned
  doc.font('Helvetica-Bold').fontSize(8).text(`for ${co.name || ''}`, bkX, bky, { width: bkInnerW, align: 'right' });
  // Authorised Signatory at bottom-right of footer
  doc.font('Helvetica').fontSize(8).text('Authorised Signatory', bkX, y + footerH - 12, { width: bkInnerW, align: 'right' });

  y += footerH;

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
  const co = effectiveCompany(cfg);
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

  const companyName = co.name || "COMPANY";
  const companyAddr = co.address1;
  const companyGstin = co.gstin;
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

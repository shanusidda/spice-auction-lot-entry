/**
 * calculations.js — Core business logic
 * Replaces: GENERATE.PRG, parts of GSTKBILT/GSTKBILP/GSTBILP/PAYCHECK
 */

const { getSettingsFlat, getGSTRates } = require('./company-config');

/**
 * Calculate purchase amounts for a lot (after trade)
 * This is what GENERATE.PRG does — fills pqty, prate, puramt, com, gst, etc.
 */
function calculateLot(lot, cfg) {
  const result = { ...lot };
  const gstGoods = cfg.gst_goods || 5;
  const cgstRate = gstGoods / 2;
  const sgstRate = gstGoods / 2;
  const igstRate = gstGoods;
  
  // Purchase qty = qty + refund (sample weight returned)
  result.pqty = lot.qty + (lot.refud || 0);
  
  // Purchase rate based on business mode
  if (cfg.business_mode === 'e-Auction') {
    // e-Auction: commission-based
    result.com = Math.round(lot.amount * (cfg.commission || 1) / 100 * 100) / 100;
    result.sertax = Math.round(lot.amount * (cfg.hpc || 0) / 100 * 100) / 100;
    result.prate = lot.price;
    result.puramt = lot.amount - result.com - result.sertax;
  } else {
    // e-Trade: deduction-based
    const deduction = lot.cr && lot.cr.includes('GSTIN') ? cfg.deduction2 : cfg.deduction1;
    result.prate = Math.round((lot.price - (lot.price * deduction / 100)) * 100) / 100;
    result.puramt = Math.round(result.pqty * result.prate * 100) / 100;
    result.com = 0;
    result.sertax = 0;
  }

  // GST calculation — intra-state (CGST+SGST) vs inter-state (IGST)
  const sellerGstState = lot.cr ? lot.cr.substring(6, 8) : '';
  const companyGstState = cfg.business_state === 'KERALA' ? '32' : '33';
  
  if (sellerGstState === companyGstState) {
    // Intra-state: CGST + SGST
    result.cgst = Math.round(result.puramt * cgstRate / 100 * 100) / 100;
    result.sgst = Math.round(result.puramt * sgstRate / 100 * 100) / 100;
    result.igst = 0;
  } else {
    // Inter-state: IGST
    result.cgst = 0;
    result.sgst = 0;
    result.igst = Math.round(result.puramt * igstRate / 100 * 100) / 100;
  }

  // Advance/discount
  result.advance = result.com + result.sertax + result.cgst + result.sgst + result.igst;
  
  // Balance payable to seller
  result.balance = Math.round((result.puramt - result.advance) * 100) / 100;
  
  // Bill amount (for agriculturist bills)
  result.bilamt = result.puramt;

  return result;
}

/**
 * Calculate TDS under Section 194Q
 * Threshold: ₹50,00,000 per financial year
 */
function calculateTDS(purchaseAmount, priorPurchases, cfg) {
  const threshold = 5000000; // ₹50 lakhs
  const tdsRate = cfg.tcs_tds || 0.1;
  
  if (priorPurchases > threshold) {
    // Already crossed threshold — TDS on full amount
    return Math.ceil(purchaseAmount * tdsRate / 100);
  } else if ((priorPurchases + purchaseAmount) > threshold) {
    // Crosses threshold this time — TDS on excess
    const excess = priorPurchases + purchaseAmount - threshold;
    return Math.ceil(excess * tdsRate / 100);
  }
  return 0;
}

/**
 * Calculate TCS for sales invoice
 */
function calculateTCS(invoiceAmount, priorSales, cfg) {
  const threshold = 5000000;
  const tcsRate = cfg.tcs_tds || 0.1;
  
  if (priorSales > threshold) {
    return Math.ceil(invoiceAmount * tcsRate / 100);
  } else if ((priorSales + invoiceAmount) > threshold) {
    const excess = priorSales + invoiceAmount - threshold;
    return Math.ceil(excess * tcsRate / 100);
  }
  return 0;
}

/**
 * Build sales invoice data for a buyer
 * Aggregates lots by buyer for a given auction
 * Sale type filter is optional — if lots don't have sale set yet, filter by buyer only
 */
function buildSalesInvoice(db, auctionId, buyerCode, saleType, cfg) {
  // Get all lots for this buyer in this auction that have amounts
  // Don't filter by sale — we're ASSIGNING the sale type now
  const lots = db.all(
    `SELECT * FROM lots WHERE auction_id = ? AND buyer = ? AND amount > 0 
     AND (sale IS NULL OR sale = '' OR sale = ?) ORDER BY lot_no`,
    [auctionId, buyerCode, saleType]
  );
  
  if (!lots.length) return null;

  const gstGoods = cfg.gst_goods || 5;
  const companyState = cfg.business_state === 'KERALA' ? '32' : '33';
  
  // Get buyer details
  const buyer = db.get('SELECT * FROM buyers WHERE buyer = ?', [buyerCode]);
  const buyerState = buyer ? buyer.gstin.substring(0, 2) : companyState;
  const isInterState = buyerState !== companyState;

  let totalQty = 0, totalBags = 0, totalAmount = 0;
  const lineItems = [];

  for (const lot of lots) {
    totalQty += lot.qty;
    totalBags += lot.bags;
    totalAmount += lot.amount;
    lineItems.push({
      lot: lot.lot_no, bags: lot.bags, qty: lot.qty,
      price: lot.price, amount: lot.amount
    });
  }

  // Gunny cost
  const gunnyCost = totalBags * (cfg.gunny_rate || 165);
  
  // Transport & insurance (only for inter-state or specific flags)
  const transportCost = isInterState ? Math.round(totalQty * (cfg.transport || 2.5) * 100) / 100 : 0;
  const insuranceCost = isInterState ? Math.round(totalQty * (cfg.insurance || 0.75) * 100) / 100 : 0;

  const taxableValue = totalAmount + gunnyCost + transportCost + insuranceCost;

  let cgst = 0, sgst = 0, igst = 0;
  if (isInterState) {
    igst = Math.round(taxableValue * gstGoods / 100 * 100) / 100;
  } else {
    cgst = Math.round(taxableValue * (gstGoods / 2) / 100 * 100) / 100;
    sgst = Math.round(taxableValue * (gstGoods / 2) / 100 * 100) / 100;
  }

  const totalBeforeRound = taxableValue + cgst + sgst + igst;
  const roundDiff = Math.round(totalBeforeRound) - totalBeforeRound;
  const grandTotal = Math.round(totalBeforeRound);

  return {
    buyer: buyer || {},
    saleType,
    lineItems,
    summary: {
      totalQty, totalBags, totalAmount,
      gunnyCost, transportCost, insuranceCost,
      taxableValue, cgst, sgst, igst,
      roundDiff, grandTotal,
      isInterState
    }
  };
}

/**
 * Build purchase invoice data for a seller
 * Aggregates lots by seller for a given auction (registered dealers only)
 */
function buildPurchaseInvoice(db, auctionId, sellerName, cfg) {
  const lots = db.all(
    `SELECT * FROM lots WHERE auction_id = ? AND name = ? AND cr LIKE 'GSTIN%' AND amount > 0 ORDER BY lot_no`,
    [auctionId, sellerName]
  );
  
  if (!lots.length) return null;

  const gstGoods = cfg.gst_goods || 5;
  const companyState = cfg.business_state === 'KERALA' ? '32' : '33';

  let totalQty = 0, totalPuramt = 0;
  const lineItems = [];

  for (const lot of lots) {
    const sellerState = lot.cr ? lot.cr.substring(6, 8) : '';
    const isInter = sellerState !== companyState;
    const puramt = lot.puramt || 0;

    const rcgst = isInter ? 0 : Math.round(puramt * (gstGoods / 2) / 100 * 100) / 100;
    const rsgst = isInter ? 0 : Math.round(puramt * (gstGoods / 2) / 100 * 100) / 100;
    const rigst = isInter ? Math.round(puramt * gstGoods / 100 * 100) / 100 : 0;

    totalQty += lot.pqty || lot.qty;
    totalPuramt += puramt;

    lineItems.push({
      lot: lot.lot_no, qty: lot.qty, pqty: lot.pqty,
      price: lot.price, prate: lot.prate,
      amount: lot.amount, puramt, 
      com: lot.com, sertax: lot.sertax,
      cgst: rcgst, sgst: rsgst, igst: rigst
    });
  }

  const firstLot = lots[0];
  const sellerState = firstLot.cr ? firstLot.cr.substring(6, 8) : '';
  const isInter = sellerState !== companyState;

  let totalCgst = 0, totalSgst = 0, totalIgst = 0;
  lineItems.forEach(li => { totalCgst += li.cgst; totalSgst += li.sgst; totalIgst += li.igst; });

  const totalBeforeRound = totalPuramt + totalCgst + totalSgst + totalIgst;
  const roundDiff = Math.round(totalBeforeRound) - totalBeforeRound;
  const grandTotal = Math.round(totalBeforeRound);

  // TDS calculation
  const priorPurchases = db.get(
    `SELECT COALESCE(SUM(total),0) as total FROM purchases WHERE gstin = ? AND date >= ?`,
    [firstLot.cr ? firstLot.cr.substring(6) : '', cfg.season_start || '2026-04-01']
  );
  const tdsAmount = cfg.flag_tds_purchase 
    ? calculateTDS(cfg.flag_wgst ? grandTotal : totalPuramt, priorPurchases ? priorPurchases.total : 0, cfg)
    : 0;
  const invoiceAmount = grandTotal - tdsAmount;

  return {
    seller: { name: firstLot.name, address: firstLot.padd, place: firstLot.ppla, 
              cr: firstLot.cr, pan: firstLot.pan, state: firstLot.pstate },
    lineItems,
    summary: {
      totalQty, totalPuramt, totalCgst, totalSgst, totalIgst,
      roundDiff, grandTotal, tdsAmount, invoiceAmount, isInter
    }
  };
}

/**
 * Generate payment summary for sellers (PAYCHECK.PRG equivalent)
 */
function getPaymentSummary(db, auctionId, state) {
  let query = `SELECT name, cr, 
    SUM(qty) as total_qty, SUM(amount) as total_amount,
    SUM(pqty) as total_pqty, SUM(prate) as avg_prate,
    SUM(puramt) as total_puramt,
    SUM(advance) as total_discount,
    SUM(balance) as total_payable,
    COUNT(*) as lot_count
    FROM lots WHERE auction_id = ? AND amount > 0`;
  const params = [auctionId];
  
  if (state) { query += ' AND state = ?'; params.push(state); }
  query += ' GROUP BY name, cr ORDER BY state, name';
  
  return db.all(query, params);
}

/**
 * Generate bank payment data (BANKPAY.PRG — RTGS/NEFT format)
 */
function getBankPaymentData(db, auctionId, cfg) {
  const payments = db.all(
    `SELECT l.state, l.name, l.cr, 
      SUM(l.puramt) as puramt, SUM(l.advance) as advance, SUM(l.balance) as payable,
      t.ifsc, t.acctnum, t.padd, t.ppla, t.pin, t.holder_name
    FROM lots l
    LEFT JOIN traders t ON t.name = l.name AND t.cr = l.cr
    WHERE l.auction_id = ? AND l.amount > 0 
      AND l.cr NOT LIKE 'GSTIN.%'
      AND (l.paid IS NULL OR l.paid = '')
    GROUP BY l.name, l.cr
    ORDER BY l.state, l.name`,
    [auctionId]
  );

  const auction = db.get('SELECT * FROM auctions WHERE id = ?', [auctionId]);
  const roundAmounts = cfg.flag_round;

  return payments.map(p => ({
    transactionType: (p.payable || 0) >= 200000 ? 'RTGS' : 'NEFT',
    ifsc: p.ifsc || '',
    accountNo: p.acctnum || '',
    beneficiaryName: p.name,
    address1: p.padd || '',
    address2: p.ppla || '',
    pin: p.pin || '',
    amount: roundAmounts ? Math.round(p.payable || 0) : p.payable || 0,
    remarks: `${auction ? auction.ano : ''} ${p.name} PAYMENT ${(p.payable || 0).toFixed(2)} Credited`,
    holderName: p.holder_name || p.name
  }));
}

/**
 * TDS return data (TDSRETU.PRG equivalent)
 */
function getTDSReturnData(db, fromDate, toDate, orderBy) {
  const order = orderBy === 'party' ? 'name' : 'date, invo';
  return db.all(
    `SELECT invo as invoice, date, name, 
      SUBSTR(gstin, 3, 10) as pan,
      amount as assess_value, tds
    FROM purchases
    WHERE date BETWEEN ? AND ? AND tds > 0
    ORDER BY ${order}`,
    [fromDate, toDate]
  );
}

/**
 * Build Agriculturist Bill of Supply (GSTKBILP/GSTBILP equivalent)
 * For sellers WITHOUT GSTIN — agricultural produce from farmers.
 * No GST charged (exempt/reverse charge).
 * 
 * Returns: { seller, lineItems, summary } if successful
 *          { error, detail } object if no data (to help debug)
 */
function buildAgriBill(db, auctionId, sellerName, cfg) {
  const trimmedName = String(sellerName || '').trim();
  if (!trimmedName) return { error: 'Seller name is empty' };

  // First check: any lots at all for this seller (case-insensitive)?
  const allLots = db.all(
    `SELECT * FROM lots WHERE auction_id = ? AND UPPER(TRIM(name)) = UPPER(?) ORDER BY lot_no`,
    [auctionId, trimmedName]
  );
  
  if (!allLots.length) {
    return { error: `No lots found for seller "${trimmedName}" in this auction. Check the exact spelling.` };
  }

  // Check if any have GSTIN — those aren't eligible for Bills of Supply
  const withGstin = allLots.filter(l => l.cr && l.cr.toUpperCase().startsWith('GSTIN'));
  const withoutGstin = allLots.filter(l => !l.cr || !l.cr.toUpperCase().startsWith('GSTIN'));
  
  if (withGstin.length && !withoutGstin.length) {
    return { error: `Seller "${trimmedName}" has GSTIN (${withGstin[0].cr}). Use Generate Purchase Invoice instead — Bills of Supply are only for agriculturists without GSTIN.` };
  }

  // Filter to agri-eligible lots with amount > 0
  const lots = withoutGstin.filter(l => (l.amount || 0) > 0);
  
  if (!lots.length) {
    if (withoutGstin.length) {
      return { error: `Seller "${trimmedName}" has ${withoutGstin.length} lot(s) but none have amount > 0. Set prices on the lots first (or click Calculate All).` };
    }
    return { error: `No eligible lots for "${trimmedName}"` };
  }

  let totalQty = 0, totalPuramt = 0;
  const lineItems = [];

  for (const lot of lots) {
    totalQty += lot.pqty || lot.qty;
    totalPuramt += lot.puramt || 0;
    lineItems.push({
      lot: lot.lot_no, qty: lot.qty, pqty: lot.pqty,
      price: lot.price, prate: lot.prate,
      amount: lot.amount, puramt: lot.puramt,
      com: lot.com, sertax: lot.sertax
    });
  }

  const firstLot = lots[0];
  const roundDiff = cfg.flag_round ? Math.round(totalPuramt) - totalPuramt : 0;
  const netAmount = Math.round(totalPuramt);

  return {
    seller: {
      name: firstLot.name,
      address: firstLot.padd,
      place: firstLot.ppla,
      pin: firstLot.ppin,
      state: firstLot.pstate,
      st_code: firstLot.pst_code,
      cr: firstLot.cr,
      pan: firstLot.pan,
      aadhar: firstLot.aadhar,
      tel: firstLot.tel,
    },
    lineItems,
    summary: {
      totalQty, totalPuramt, 
      roundDiff, netAmount,
      cgst: 0, sgst: 0, igst: 0,
      tax: 0
    }
  };
}

/**
 * List agri-eligible sellers for an auction
 * (sellers without GSTIN who have lots with amount > 0)
 */
function listAgriSellers(db, auctionId) {
  return db.all(
    `SELECT name, COUNT(*) as lot_count, SUM(qty) as total_qty, SUM(amount) as total_amount
     FROM lots 
     WHERE auction_id = ? 
       AND (cr IS NULL OR cr = '' OR UPPER(cr) NOT LIKE 'GSTIN%')
       AND amount > 0
     GROUP BY name
     ORDER BY name`,
    [auctionId]
  );
}

/**
 * Sales Journal (JOUR.PRG)
 * Date-wise sales invoice register
 */
function getSalesJournal(db, fromDate, toDate, saleType) {
  let query = `SELECT date, sale, invo, buyer, buyer1, gstin, place,
      bag, qty, amount as cardamom, gunny, pava_hc as transport, ins as insurance,
      cgst, sgst, igst, tcs, rund, tot as total
    FROM invoices WHERE date BETWEEN ? AND ?`;
  const params = [fromDate, toDate];
  if (saleType) { query += ' AND sale = ?'; params.push(saleType); }
  query += ' ORDER BY date, sale, invo';
  return db.all(query, params);
}

/**
 * Purchase Journal (PUJOUR.PRG / PPUJOUR.PRG)
 * Date-wise purchase invoice register
 * type: 'dealer' (registered) or 'agri' (agriculturist bills)
 */
function getPurchaseJournal(db, fromDate, toDate, type) {
  if (type === 'agri') {
    return db.all(
      `SELECT date, bil as bill_no, name, add_line as address, pla as place, pstate as state,
        crr as cr, pan, qty, cost, igst, net
      FROM bills WHERE date BETWEEN ? AND ? ORDER BY date, bil`,
      [fromDate, toDate]
    );
  }
  // Dealer purchases
  return db.all(
    `SELECT date, invo as invoice_no, name, add_line as address, place, state,
      gstin, qty, amount, cgst, sgst, igst, rund, total, tds
    FROM purchases WHERE date BETWEEN ? AND ? ORDER BY date, invo`,
    [fromDate, toDate]
  );
}

/**
 * Debit Note calculation
 * For discounts or adjustments against invoices
 */
function buildDebitNote(db, invoiceNo, saleType, discount, cfg) {
  const inv = db.get('SELECT * FROM invoices WHERE invo = ? AND sale = ?', [String(invoiceNo), saleType]);
  if (!inv) return null;

  const gstGoods = cfg.gst_goods || 5;
  const isInter = inv.igst > 0;

  const amount = Math.round(discount * 100) / 100;
  let cgst = 0, sgst = 0, igst = 0;
  
  if (cfg.flag_disc_gst) {
    // Discount amount includes GST — extract it
    const factor = 100 / (100 + gstGoods);
    const taxable = amount * factor;
    if (isInter) igst = Math.round((amount - taxable) * 100) / 100;
    else { 
      const tax = (amount - taxable) / 2;
      cgst = Math.round(tax * 100) / 100;
      sgst = Math.round(tax * 100) / 100;
    }
  } else {
    // Discount is pre-tax — add GST on top
    if (isInter) igst = Math.round(amount * gstGoods / 100 * 100) / 100;
    else {
      cgst = Math.round(amount * (gstGoods / 2) / 100 * 100) / 100;
      sgst = Math.round(amount * (gstGoods / 2) / 100 * 100) / 100;
    }
  }
  
  const total = amount + cgst + sgst + igst;
  return { invoice: inv, amount, cgst, sgst, igst, total };
}

module.exports = {
  calculateLot,
  calculateTDS,
  calculateTCS,
  buildSalesInvoice,
  buildPurchaseInvoice,
  buildAgriBill,
  buildDebitNote,
  listAgriSellers,
  getPaymentSummary,
  getBankPaymentData,
  getTDSReturnData,
  getSalesJournal,
  getPurchaseJournal,
};

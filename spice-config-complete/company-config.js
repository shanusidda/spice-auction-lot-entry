/**
 * company-config.js — Replaces TOOL.DBF + DEPOTS.PRG + COMPANY.PRG
 * All company configuration stored as key-value pairs in SQLite.
 */

const DEFAULTS = [
  // ── COMPANY (Primary - ISP) ────────────────────────────────
  { key: 'logo',            value: 'ISP',           category: 'company',   label: 'Logo Code',                type: 'text' },
  { key: 'trade_name',      value: 'IDEAL SPICES',  category: 'company',   label: 'Trade Name',               type: 'text' },
  { key: 'legal_name',      value: ' PRIVATE LIMITED', category: 'company', label: 'Legal Name Suffix',        type: 'text' },
  { key: 'short_name',      value: 'IDEAL SPICES PRIVATE LIMITED', category: 'company', label: 'Short Name', type: 'text' },
  { key: 'pan',             value: 'AAICI5415L',    category: 'company',   label: 'PAN',                      type: 'text' },
  { key: 'cin',             value: 'U47211TN2025PTC186657', category: 'company', label: 'CIN',                type: 'text' },
  { key: 'fssai',           value: '',               category: 'company',   label: 'FSSAI No.',               type: 'text' },
  { key: 'sbl',             value: '',               category: 'company',   label: 'SBL No.',                 type: 'text' },

  // ── ADDRESS (Kerala) ───────────────────────────────────────
  { key: 'kl_address1',     value: 'FLAT No.42,V.O.C.1ST STREET,MELACHOKKANATHAPURAM', category: 'address_kl', label: 'Address Line 1', type: 'text' },
  { key: 'kl_address2',     value: 'BODINAYAKANUR, THENI-625582 TAMIL NADU CODE:33 Mobile:8610943865', category: 'address_kl', label: 'Address Line 2', type: 'text' },
  { key: 'kl_phone',        value: '8610943865',    category: 'address_kl', label: 'Phone',                   type: 'text' },
  { key: 'kl_email',        value: 'idealspicesbodi@gmail.com', category: 'address_kl', label: 'Email',       type: 'text' },
  { key: 'kl_gstin',        value: '32AAICI5415L1ZX', category: 'address_kl', label: 'GSTIN',                 type: 'text' },
  { key: 'kl_branch',       value: 'BODINAYAKANUR', category: 'address_kl', label: 'Office Branch',           type: 'text' },

  // ── ADDRESS (Tamil Nadu) ───────────────────────────────────
  { key: 'tn_address1',     value: 'DOOR No.42,V.O.C.1ST STREET,MELACHOKKANATHAPURAM', category: 'address_tn', label: 'Address Line 1', type: 'text' },
  { key: 'tn_address2',     value: 'BODINAYAKANUR, THENI-625582 TAMIL NADU CODE:33 Mobile:8610943865', category: 'address_tn', label: 'Address Line 2', type: 'text' },
  { key: 'tn_dispatch',     value: 'AMAZING SPICE PARK PVT LTD WARD No.6 ELLIKKANAM DOOR No.650 NEDUMKANDAM IDUKKI KERALA CODE:32', category: 'address_tn', label: 'Dispatch Address', type: 'text' },
  { key: 'tn_phone',        value: '8610943865',    category: 'address_tn', label: 'Phone',                   type: 'text' },
  { key: 'tn_email',        value: 'idealspicesbodi@gmail.com', category: 'address_tn', label: 'Email',       type: 'text' },
  { key: 'tn_gstin',        value: '33AAICI5415L1ZH', category: 'address_tn', label: 'GSTIN',                 type: 'text' },
  { key: 'tn_branch',       value: 'BODINAYAKANUR', category: 'address_tn', label: 'Office Branch',           type: 'text' },

  // ── SISTER COMPANY (ASP) ───────────────────────────────────
  { key: 's_logo',          value: 'ASP',            category: 'sister',    label: 'Logo Code',                type: 'text' },
  { key: 's_company',       value: 'AMAZING SPICE PARK PRIVATE LIMITED', category: 'sister', label: 'Company Name', type: 'text' },
  { key: 's_short_name',    value: 'AMAZING SPICE PARK PVT LTD', category: 'sister', label: 'Short Name',     type: 'text' },
  { key: 's_address1',      value: 'WARD No.6, ELLIKKANAM, DOOR No.650, NEDUMKANDAM', category: 'sister', label: 'Address Line 1', type: 'text' },
  { key: 's_address2',      value: 'UDUMBANCHOLA, IDUKKI-685553 KERALA CODE:32 MOBILE:9843338633', category: 'sister', label: 'Address Line 2', type: 'text' },
  { key: 's_phone',         value: '9843338633',     category: 'sister',    label: 'Phone',                    type: 'text' },
  { key: 's_email',         value: 'amazingspicepark@gmail.com', category: 'sister', label: 'Email',           type: 'text' },
  { key: 's_gstin',         value: '32ABDCA2636B1ZE', category: 'sister',   label: 'GSTIN',                    type: 'text' },
  { key: 's_cin',           value: 'U46305KL2025PTC095544', category: 'sister', label: 'CIN',                  type: 'text' },
  { key: 's_pan',           value: 'ABDCA2636B',    category: 'sister',    label: 'PAN',                      type: 'text' },
  { key: 's_fssai',         value: '',               category: 'sister',    label: 'FSSAI No.',                type: 'text' },
  { key: 's_sbl',           value: 'CS/55884/950/2026-27', category: 'sister', label: 'SBL No.',               type: 'text' },

  // ── BRANCHES ───────────────────────────────────────────────
  { key: 'br1',             value: 'NEDUMKANDAM',    category: 'branches',  label: 'Branch 1',                type: 'text' },
  { key: 'br2',             value: 'UDUBANCHOLA',    category: 'branches',  label: 'Branch 2',                type: 'text' },
  { key: 'br3',             value: 'MARUKKUMTOTTI',  category: 'branches',  label: 'Branch 3',                type: 'text' },
  { key: 'br4',             value: 'ANAVILASAM',     category: 'branches',  label: 'Branch 4',                type: 'text' },
  { key: 'br5',             value: 'VANDANMEDU',     category: 'branches',  label: 'Branch 5',                type: 'text' },
  { key: 'br6',             value: '',               category: 'branches',  label: 'Branch 6',                type: 'text' },
  { key: 'br7',             value: '',               category: 'branches',  label: 'Branch 7',                type: 'text' },
  { key: 'br8',             value: '',               category: 'branches',  label: 'Branch 8',                type: 'text' },
  { key: 'br9',             value: '',               category: 'branches',  label: 'Branch 9',                type: 'text' },
  { key: 'br1_tel',         value: '9786069799',     category: 'branches',  label: 'Branch 1 Mobile',         type: 'text' },
  { key: 'br2_tel',         value: '',               category: 'branches',  label: 'Branch 2 Mobile',         type: 'text' },
  { key: 'br3_tel',         value: '9080248574',     category: 'branches',  label: 'Branch 3 Mobile',         type: 'text' },
  { key: 'br4_tel',         value: '',               category: 'branches',  label: 'Branch 4 Mobile',         type: 'text' },
  { key: 'br5_tel',         value: '',               category: 'branches',  label: 'Branch 5 Mobile',         type: 'text' },
  { key: 'br6_tel',         value: '',               category: 'branches',  label: 'Branch 6 Mobile',         type: 'text' },
  { key: 'br7_tel',         value: '',               category: 'branches',  label: 'Branch 7 Mobile',         type: 'text' },
  { key: 'br8_tel',         value: '',               category: 'branches',  label: 'Branch 8 Mobile',         type: 'text' },

  // ── RATES ──────────────────────────────────────────────────
  { key: 'commission',      value: '1',              category: 'rates',     label: 'Commission %',             type: 'number' },
  { key: 'hpc',             value: '10',             category: 'rates',     label: 'Handling %',               type: 'number' },
  { key: 'deduction1',      value: '1.25',           category: 'rates',     label: 'Deduction (Pooler)',       type: 'number' },
  { key: 'deduction2',      value: '1.25',           category: 'rates',     label: 'Deduction (Dealer)',       type: 'number' },
  { key: 'asp_profit_pooler', value: '0.75',         category: 'rates',     label: 'ASP Profit Ratio (Pooler)', type: 'number' },
  { key: 'asp_profit_dealer', value: '0.75',         category: 'rates',     label: 'ASP Profit Ratio (Dealer)', type: 'number' },
  { key: 'isp_profit_pooler', value: '0.5',          category: 'rates',     label: 'ISP Profit Ratio (Pooler)', type: 'number' },
  { key: 'isp_profit_dealer', value: '0.5',          category: 'rates',     label: 'ISP Profit Ratio (Dealer)', type: 'number' },
  { key: 'refund',          value: '1.9',            category: 'rates',     label: 'Sample Refund (Kgs)',      type: 'number' },
  { key: 'sb_refund',       value: '2.85',           category: 'rates',     label: 'SB Sample Refund (Kgs)',   type: 'number' },
  { key: 'gst_goods',       value: '5',              category: 'rates',     label: 'GST Goods Rate %',         type: 'number' },
  { key: 'gst_service',     value: '18',             category: 'rates',     label: 'GST Service Rate %',       type: 'number' },
  { key: 'tcs_tds',         value: '0.1',            category: 'rates',     label: 'TCS / TDS Rate %',         type: 'number' },
  { key: 'gunny_rate',      value: '165',            category: 'rates',     label: 'Gunny Rate (₹)',           type: 'number' },
  { key: 'transport',       value: '2.5',            category: 'rates',     label: 'Transport (₹/kg)',         type: 'number' },
  { key: 'insurance',       value: '0.75',           category: 'rates',     label: 'Insurance (₹/kg)',         type: 'number' },
  { key: 'local_transport', value: '2.5',            category: 'rates',     label: 'Local Transport (₹/kg)',   type: 'number' },
  { key: 'local_insurance', value: '0.75',           category: 'rates',     label: 'Local Insurance (₹/kg)',   type: 'number' },
  { key: 'discount_pct',    value: '0',              category: 'rates',     label: 'Discount %',               type: 'number' },
  { key: 'discount_days',   value: '0',              category: 'rates',     label: 'No. of Days for Discount', type: 'number' },

  // ── HSN / SAC CODES ────────────────────────────────────────
  { key: 'hsn_cardamom',    value: '09083120',       category: 'hsn',       label: 'Cardamom HSN',             type: 'text' },
  { key: 'hsn_gunny',       value: '63051040',       category: 'hsn',       label: 'Gunny HSN',                type: 'text' },
  { key: 'sac_transport',   value: '996791',         category: 'hsn',       label: 'Transport SAC',            type: 'text' },
  { key: 'sac_insurance',   value: '997136',         category: 'hsn',       label: 'Insurance SAC',            type: 'text' },
  { key: 'sac_service',     value: '996111',         category: 'hsn',       label: 'Service SAC',              type: 'text' },

  // ── BANK DETAILS ───────────────────────────────────────────
  { key: 'bank_kl_name',    value: 'FEDERAL BANK - PUTTADY', category: 'bank', label: 'Kerala Bank Name',      type: 'text' },
  { key: 'bank_kl_acct',    value: '10735500094452', category: 'bank',      label: 'Kerala Account No.',       type: 'text' },
  { key: 'bank_kl_ifsc',    value: 'FDRL0001073',   category: 'bank',      label: 'Kerala IFSC Code',         type: 'text' },
  { key: 'bank_tn_name',    value: 'CITY UNION BANK-BODINAYAKANUR', category: 'bank', label: 'TN Bank Name',   type: 'text' },
  { key: 'bank_tn_acct',    value: '510909010383556', category: 'bank',     label: 'TN Account No.',           type: 'text' },
  { key: 'bank_tn_ifsc',    value: 'CIUB0000346',   category: 'bank',      label: 'TN IFSC Code',             type: 'text' },

  // ── SEASON ─────────────────────────────────────────────────
  { key: 'season',          value: '2026 - 27',      category: 'season',    label: 'Season Name',              type: 'text' },
  { key: 'season_short',    value: '26-27',          category: 'season',    label: 'Season Short',             type: 'text' },
  { key: 'season_start',    value: '2026-04-01',     category: 'season',    label: 'FY Start Date',            type: 'date' },
  { key: 'season_end',      value: '2027-03-31',     category: 'season',    label: 'FY End Date',              type: 'date' },

  // ── INVOICE SETTINGS ───────────────────────────────────────
  { key: 'inv_prefix',      value: 'ISP',            category: 'invoice',   label: 'Invoice Prefix',           type: 'text' },
  { key: 'inv_prefix_sister', value: 'ASP',          category: 'invoice',   label: 'Sister Invoice Prefix (Other Ref.)', type: 'text' },
  { key: 'separator',       value: '-',              category: 'invoice',   label: 'Separator Symbol',         type: 'text' },
  { key: 'hsn_cardamom',    value: '09083120',       category: 'invoice',   label: 'HSN/SAC — Cardamom',       type: 'text' },
  { key: 'hsn_gunny',       value: '63051040',       category: 'invoice',   label: 'HSN/SAC — Gunny',          type: 'text' },
  { key: 'dispatched_through_isp', value: '',         category: 'invoice',   label: 'Dispatched Through (ISP)', type: 'text' },
  { key: 'dispatched_through_asp', value: '',         category: 'invoice',   label: 'Dispatched Through (ASP)', type: 'text' },
  { key: 'dispatch_destination', value: 'NEDUMKANDAM', category: 'invoice', label: 'Dispatch Destination',     type: 'text' },
  { key: 'duplicate_text',  value: 'DUMMY INVOICE',  category: 'invoice',   label: 'Dummy Invoice Text',       type: 'text' },
  { key: 'commission_bill', value: 'COMMISSION BILL', category: 'invoice',  label: 'Commission Bill Name',     type: 'text' },
  { key: 'memorandum_text', value: 'MEMORANDAM OF CARDAMOM SOLD THROUGH', category: 'invoice', label: 'Memorandum Text', type: 'text' },
  { key: 'signature_text',  value: 'Signature of the Authorised Buyer', category: 'invoice', label: 'Signature Label', type: 'text' },

  // ── FEATURE FLAGS ──────────────────────────────────────────
  { key: 'flag_pooling',    value: 'false',          category: 'flags',     label: 'Pooling (Single State)',    type: 'boolean' },
  { key: 'flag_sister',     value: 'true',           category: 'flags',     label: 'Sister Concern Active',    type: 'boolean' },
  { key: 'flag_tnpa',       value: 'true',           category: 'flags',     label: 'ASP Ship To Address',      type: 'boolean' },
  { key: 'flag_sample',     value: 'false',          category: 'flags',     label: 'Discount in Invoice',      type: 'boolean' },
  { key: 'flag_dispatch',   value: 'true',           category: 'flags',     label: 'Show Dispatch Address',    type: 'boolean' },
  { key: 'flag_ship',       value: 'true',           category: 'flags',     label: 'Show Ship To Address',     type: 'boolean' },
  { key: 'flag_hsn',        value: 'true',           category: 'flags',     label: 'Show HSN Codes',           type: 'boolean' },
  { key: 'flag_bank',       value: 'true',           category: 'flags',     label: 'Bank Details in Invoice',  type: 'boolean' },
  { key: 'flag_tds_purchase', value: 'true',         category: 'flags',     label: 'TDS on Purchase Invoice',  type: 'boolean' },
  { key: 'flag_tds_sales',  value: 'false',          category: 'flags',     label: 'TDS on Sales Invoice',     type: 'boolean' },
  { key: 'flag_rtds_inv',   value: 'true',           category: 'flags',     label: 'TDS in ASP Purchase',      type: 'boolean' },
  { key: 'flag_wgst',       value: 'false',          category: 'flags',     label: 'TDS on Full Invoice Amount', type: 'boolean' },
  { key: 'flag_disc_gst',   value: 'false',          category: 'flags',     label: 'Discount includes GST',    type: 'boolean' },
  { key: 'flag_debit_note', value: 'false',          category: 'flags',     label: 'Debit Note for Discount',  type: 'boolean' },
  { key: 'flag_invoice_stripe', value: 'true',       category: 'flags',     label: 'Alternate Row Stripe in Invoice', type: 'boolean' },
  { key: 'flag_dummy',      value: 'true',           category: 'flags',     label: 'Allow Dummy Invoices',     type: 'boolean' },
  { key: 'flag_round',      value: 'true',           category: 'flags',     label: 'Round Invoice Amounts',    type: 'boolean' },
  { key: 'flag_eway',       value: 'false',          category: 'flags',     label: 'ASP eWay Bill / Transport', type: 'boolean' },
  { key: 'flag_export',     value: 'false',          category: 'flags',     label: 'Export Invoices',          type: 'boolean' },

  // ── BUSINESS MODE ──────────────────────────────────────────
  { key: 'business_mode',   value: 'e-Trade',        category: 'mode',      label: 'Business Mode',            type: 'select' },
  { key: 'business_state',  value: 'TAMIL NADU',     category: 'mode',      label: 'Business State',           type: 'select' },

  // ── INTEGRATIONS ───────────────────────────────────────────
  { key: 'gst_api_key',     value: '',               category: 'integrations', label: 'GST Lookup API Key (gstincheck.co.in)', type: 'text' },
];

const CATEGORIES = {
  mode:       { order: 0, title: 'Business Mode',        icon: '⚙' },
  company:    { order: 1, title: 'Company Details',       icon: '🏢' },
  address_kl: { order: 2, title: 'Address (Kerala)',      icon: '📍' },
  address_tn: { order: 3, title: 'Address (Tamil Nadu)',  icon: '📍' },
  sister:     { order: 4, title: 'Sister Company (ASP)',  icon: '🤝' },
  branches:   { order: 5, title: 'Branches & Contacts',  icon: '🏪' },
  rates:      { order: 6, title: 'Rates & Charges',       icon: '💰' },
  hsn:        { order: 7, title: 'HSN / SAC Codes',       icon: '🏷' },
  bank:       { order: 8, title: 'Bank Details',          icon: '🏦' },
  season:     { order: 9, title: 'Season / Financial Year', icon: '📅' },
  invoice:    { order: 10, title: 'Invoice Settings',     icon: '📄' },
  flags:      { order: 11, title: 'Feature Flags',        icon: '🔧' },
  integrations: { order: 12, title: 'Integrations',       icon: '🔌', description: 'Optional third-party services. The GST API key enables auto-fetching trade name and address when you enter a GSTIN. Get a free key at gstincheck.co.in — sign up, copy the key from your dashboard, paste here.' },
};

function initCompanySettings(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'company',
      label TEXT NOT NULL DEFAULT '',
      field_type TEXT NOT NULL DEFAULT 'text'
    );
  `);

  const insert = db.prepare(
    'INSERT OR IGNORE INTO company_settings (key, value, category, label, field_type) VALUES (?, ?, ?, ?, ?)'
  );
  const seed = db.transaction(() => {
    for (const d of DEFAULTS) insert.run(d.key, d.value, d.category, d.label, d.type);
  });
  seed();

  // Migration: asp_profit was split into asp_profit_pooler and asp_profit_dealer.
  // If an existing DB still has the old row, copy its value to both new keys
  // (preserving the user's configured rate), then remove the legacy row.
  const legacy = db.prepare('SELECT value FROM company_settings WHERE key = ?').get('asp_profit');
  if (legacy && legacy.value != null && legacy.value !== '') {
    const upd = db.prepare('UPDATE company_settings SET value = ? WHERE key = ?');
    upd.run(legacy.value, 'asp_profit_pooler');
    upd.run(legacy.value, 'asp_profit_dealer');
    db.prepare('DELETE FROM company_settings WHERE key = ?').run('asp_profit');
    console.log('Migrated asp_profit → asp_profit_pooler/asp_profit_dealer (value=%s)', legacy.value);
  }

  // Migration: isp_profit was split into isp_profit_pooler and isp_profit_dealer.
  // These now drive P_Rate calculations for Kerala + e-Trade (ASP invoices).
  // Copy the legacy value into both new keys, then remove the legacy row.
  const legacyIsp = db.prepare('SELECT value FROM company_settings WHERE key = ?').get('isp_profit');
  if (legacyIsp && legacyIsp.value != null && legacyIsp.value !== '') {
    const upd = db.prepare('UPDATE company_settings SET value = ? WHERE key = ?');
    upd.run(legacyIsp.value, 'isp_profit_pooler');
    upd.run(legacyIsp.value, 'isp_profit_dealer');
    db.prepare('DELETE FROM company_settings WHERE key = ?').run('isp_profit');
    console.log('Migrated isp_profit → isp_profit_pooler/isp_profit_dealer (value=%s)', legacyIsp.value);
  } else {
    // No legacy value but the row may still exist from a prior install. Drop it.
    db.prepare('DELETE FROM company_settings WHERE key = ?').run('isp_profit');
  }

  // Migration: dispatched_through was split into _isp and _asp variants.
  // Copy the legacy value into both new keys (user can customize per company
  // afterward), then drop the legacy row.
  const legacyDT = db.prepare('SELECT value FROM company_settings WHERE key = ?').get('dispatched_through');
  if (legacyDT && legacyDT.value != null && legacyDT.value !== '') {
    const upd = db.prepare('UPDATE company_settings SET value = ? WHERE key = ?');
    upd.run(legacyDT.value, 'dispatched_through_isp');
    upd.run(legacyDT.value, 'dispatched_through_asp');
    db.prepare('DELETE FROM company_settings WHERE key = ?').run('dispatched_through');
    console.log('Migrated dispatched_through → dispatched_through_isp/_asp (value=%s)', legacyDT.value);
  } else {
    db.prepare('DELETE FROM company_settings WHERE key = ?').run('dispatched_through');
  }

  console.log('Company settings ready (%d defaults)', DEFAULTS.length);
}

function getSetting(db, key) {
  const r = db.prepare('SELECT value FROM company_settings WHERE key = ?').get(key);
  return r ? r.value : null;
}

function getSettingBool(db, key) {
  const v = getSetting(db, key);
  return v === 'true' || v === '1';
}

function getSettingNum(db, key) {
  return parseFloat(getSetting(db, key)) || 0;
}

function getAllSettings(db) {
  const rows = db.prepare('SELECT key, value, category, label, field_type FROM company_settings ORDER BY rowid').all();
  const grouped = {};
  for (const r of rows) {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push(r);
  }
  return grouped;
}

function updateSettings(db, settings) {
  const upd = db.prepare('UPDATE company_settings SET value = ? WHERE key = ?');
  const batch = db.transaction((items) => {
    let n = 0;
    for (const [k, v] of Object.entries(items)) { upd.run(String(v), k); n++; }
    return n;
  });
  return batch(settings);
}

function getSettingsFlat(db) {
  const rows = db.prepare('SELECT key, value, field_type FROM company_settings').all();
  const flat = {};
  for (const r of rows) {
    if (r.field_type === 'boolean') flat[r.key] = r.value === 'true';
    else if (r.field_type === 'number') flat[r.key] = parseFloat(r.value) || 0;
    else flat[r.key] = r.value;
  }
  return flat;
}

function getGSTRates(db) {
  const g = getSettingNum(db, 'gst_goods');
  return { cgst: g / 2, sgst: g / 2, igst: g, service: getSettingNum(db, 'gst_service'), tcs: getSettingNum(db, 'tcs_tds') };
}

module.exports = { DEFAULTS, CATEGORIES, initCompanySettings, getSetting, getSettingBool, getSettingNum, getAllSettings, updateSettings, getSettingsFlat, getGSTRates };

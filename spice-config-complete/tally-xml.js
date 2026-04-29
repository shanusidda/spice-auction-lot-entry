/**
 * tally-xml.js — Tally-importable XML generators
 *
 * Ports the VBA macros (ConvertSales, ConvertPurchase, ConvertDebit) from
 * the IDEAL_V5_6 / ASPPL_V5_6 .xlsm files into pure-JS functions that build
 * the same <ENVELOPE>...</ENVELOPE> Tally XML payloads.
 *
 * Four export types:
 *   generSalesXML       — registered dealer sales (generXML)
 *   generRDPurchaseXML  — registered dealer purchases (generRD)
 *   generURDPurchaseXML — agriculturist / unregistered purchases (generURD)
 *   generDebitNoteXML   — discount debit notes against suppliers (generDN)
 *
 * Each function receives {rows, cfg, opts} where:
 *   rows = pre-grouped invoice/voucher records pulled from the SQLite DB
 *   cfg  = company_settings flat object (getSettingsFlat output)
 *   opts = { season, separator, voucherStart } overrides per call
 *
 * The XML is text-only; we return a string ready for download. We don't
 * touch ExcelJS or PDF here — that's a separate path.
 */

// ── Indian state code → name (matches FindState in VBA) ──────────
const STATES = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
  '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
  '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam',
  '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha',
  '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '25': 'Daman & Diu', '26': 'Dadra & Nagar Haveli', '27': 'Maharashtra',
  '28': 'Andhra Pradesh', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh (New)',
  '97': 'Other Territory', '99': 'Other Country',
};

const findState = (gstin) => {
  if (!gstin) return '';
  const code = String(gstin).trim().slice(0, 2);
  return STATES[code] || '';
};

// ── XML escaping ─────────────────────────────────────────────────
const xe = (v) => {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const r0 = (n) => Math.round(Number(n || 0));

// yyyymmdd from any date-ish string ("2026-04-28", "28/04/2026", or Date)
const toTallyDate = (d) => {
  if (!d) return '';
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }
  const s = String(d).trim();
  // yyyy-mm-dd or yyyy-mm-ddT...
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  // dd/mm/yyyy
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}${m[2]}${m[1]}`;
  // yyyymmdd (already correct)
  if (/^\d{8}$/.test(s)) return s;
  return s.replace(/\D/g, '').slice(0, 8);
};

// ── Tally XML constants (mirror VBA constants in ConvertSales.bas) ──
const TAGS = {
  STARTENV:  '<ENVELOPE>',
  HEADER:    '<HEADER>\n<TALLYREQUEST>Import Data</TALLYREQUEST>\n</HEADER>',
  SIMPDATA:  '<IMPORTDATA>',
  EREQDESC:  '</REQUESTDESC>',
  SREQDATA:  '<REQUESTDATA>',
  STARTDATA: '<TALLYMESSAGE xmlns:UDF="TallyUDF">',
  ENDDATA:   '</TALLYMESSAGE>',
  EREQDATA:  '</REQUESTDATA>',
  EIMPDATA:  '</IMPORTDATA>',
  ENDBODY:   '</BODY>',
  ENDVOUCHER:'</VOUCHER>',
  DEEMNO:    '<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n<ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>',
  DEEMYES:   '<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\n<ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>',
};

// ── GST rate detail blocks ─────────────────────────────────────
const rateBlock = (head, rate, valuation = 'Based on Value') => {
  let body = `<GSTRATEDUTYHEAD>${head}</GSTRATEDUTYHEAD>\n<GSTRATEVALUATIONTYPE>${valuation}</GSTRATEVALUATIONTYPE>`;
  if (rate !== null && rate !== undefined) body += `\n<GSTRATE>${rate}</GSTRATE>`;
  return `<RATEDETAILS.LIST>\n${body}\n</RATEDETAILS.LIST>`;
};

const rateDetails = (gstRate /* e.g. 5 = full IGST */) => {
  const half = (gstRate / 2).toFixed(2);
  const full = String(gstRate);
  return {
    cgst: rateBlock('CGST', half),
    sgst: rateBlock('SGST/UTGST', half),
    igst: rateBlock('IGST', full),
    // Cess + State Cess: emit head + valuation but no rate (matches target schemas)
    cess:  rateBlock('Cess',       null),
    scess: rateBlock('State Cess', null),
  };
};

// ── Envelope helpers ──────────────────────────────────────────
const startEnvelope = (companyName, reportName = 'Vouchers') => {
  const sreqdesc = `<REQUESTDESC>\n<REPORTNAME>${reportName}</REPORTNAME>`;
  const stat = `<STATICVARIABLES>\n<SVCURRENTCOMPANY>${xe(companyName)}</SVCURRENTCOMPANY>\n</STATICVARIABLES>`;
  const startBody = `<BODY>\n${TAGS.SIMPDATA}\n${sreqdesc}\n${stat}\n${TAGS.EREQDESC}\n${TAGS.SREQDATA}\n${TAGS.STARTDATA}`;
  return `${TAGS.STARTENV}\n${TAGS.HEADER}\n${startBody}`;
};

const endEnvelope = () => {
  return `${TAGS.ENDDATA}\n${TAGS.EREQDATA}\n${TAGS.EIMPDATA}\n${TAGS.ENDBODY}\n</ENVELOPE>`;
};

// ── Cfg accessors with sensible fallbacks ──────────────────────
const cfgGet = (cfg, key, def = '') => {
  if (!cfg) return def;
  const v = cfg[key];
  if (v === undefined || v === null || v === '') return def;
  return v;
};

const cfgBool = (cfg, key, def = false) => {
  const v = cfgGet(cfg, key, null);
  if (v === null) return def;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
};

const cfgNum = (cfg, key, def = 0) => {
  const v = Number(cfgGet(cfg, key, def));
  return isFinite(v) ? v : def;
};

// =====================================================================
// 1. SALES (registered dealer sales — VBA generXML)
// =====================================================================
//
// Input shape (what the route layer should pass us — already grouped by
// invoice from the invoices table):
//
//   rows = [{
//     ano, date, sale, invo, partyName, address, place, pin,
//     partyGstin, lots: [{lot, bag, qty, rate, amount}, ...],
//     amounttot, gunnyAmt, cgst, sgst, igst, tcsamt, total, totalRounded, rnd,
//   }, ...]
//
function generSalesXML(rows, cfg, opts = {}) {
  const company       = opts.companyName || cfgGet(cfg, 'tally_company_name', cfgGet(cfg, 'short_name', 'Ideal Spices Private Limited'));
  const season        = opts.season || cfgGet(cfg, 'tally_season', cfgGet(cfg, 'season_code', '2026-27'));
  const separator     = opts.separator || cfgGet(cfg, 'tally_separator', '/');
  const invPrefix     = cfgGet(cfg, 'tally_inv_prefix', 'ISP/');
  const ainvPrefix    = cfgGet(cfg, 'tally_ainv_prefix', 'ASP/');
  const amazing       = cfgBool(cfg, 'tally_amazing_mode', false);
  const detailed      = cfgBool(cfg, 'tally_detailed', true);
  const dispatchEnabled = cfgBool(cfg, 'tally_dispatch_from', true);
  const tcs           = cfgBool(cfg, 'tally_tcs_enabled', false);
  const intra         = cfgGet(cfg, 'tally_state_code', '33'); // ISP=33, ASP=32 (set in cfg)

  // Ledgers
  const SalesInter   = cfgGet(cfg, 'tally_sales_inter',  'Cardamom Sales 5%');
  const SalesIntra   = cfgGet(cfg, 'tally_sales_intra',  'Cardamom Sales 5% - Local');
  const SalesExport  = cfgGet(cfg, 'tally_sales_export', 'Cardamom Sales - Export');
  const GunnyInter   = cfgGet(cfg, 'tally_gunny_inter',  'Gunny Sales 5%');
  const GunnyIntra   = cfgGet(cfg, 'tally_gunny_intra',  'Gunny Sales 5% - Local');
  const Tax_CGST     = cfgGet(cfg, 'tally_cgst', 'OUTPUT CGST 2.5%');
  const Tax_SGST     = cfgGet(cfg, 'tally_sgst', 'OUTPUT SGST 2.5%');
  const Tax_IGST     = cfgGet(cfg, 'tally_igst', 'OUTPUT IGST 5%');
  const Tax_TCS      = cfgGet(cfg, 'tally_tcs',  'TCS on Sale of Goods');
  const Round_LDR    = cfgGet(cfg, 'tally_round', 'Round Off');
  const Item_Card    = cfgGet(cfg, 'tally_item_cardamom', 'Cardamom');
  const Item_Gunny   = cfgGet(cfg, 'tally_item_gunny',    'Gunny Bag');
  const HSN_Card     = cfgGet(cfg, 'tally_hsn_cardamom',  '09083110');
  const HSN_Gunny    = cfgGet(cfg, 'tally_hsn_gunny',     '63053200');

  // Dispatch-from address (sister-company despatch, ASP source)
  const d_company    = cfgGet(cfg, 'tally_dispatch_company', cfgGet(cfg, 's_short_name', ''));
  const d_add        = cfgGet(cfg, 'tally_dispatch_address', cfgGet(cfg, 's_address1', ''));
  const d_place      = cfgGet(cfg, 'tally_dispatch_place',   cfgGet(cfg, 's_place', ''));
  const d_pin        = cfgGet(cfg, 'tally_dispatch_pin',     cfgGet(cfg, 's_pin', ''));
  const d_state      = cfgGet(cfg, 'tally_dispatch_state',   cfgGet(cfg, 's_state', 'Kerala'));
  const d_gstin      = cfgGet(cfg, 'tally_dispatch_gstin',   cfgGet(cfg, 's_gstin', ''));

  let xml = '\n' + startEnvelope(company, 'Vouchers');

  for (const row of rows) {
    const dateval     = toTallyDate(row.date);
    const partyName   = xe(row.partyName);
    const address     = xe(row.address);
    const place       = xe(row.place);
    const pin         = xe(row.pin);
    const partyGstin  = xe(row.partyGstin);
    const state       = xe(findState(partyGstin));
    const isIntra     = String(partyGstin).slice(0, 2) === String(intra);
    const isExport    = (row.sale || '').toUpperCase() === 'E';
    const sale        = row.sale || 'L';
    const invoNo      = String(row.invo || '').trim();
    const taxNm       = `${sale}${separator}${invoNo}`;
    const voucherNum  = `${amazing ? ainvPrefix : invPrefix}${taxNm}/${season}`;
    const rates       = rateDetails(cfgNum(cfg, 'gst_goods', 5));

    const startVoucher = `<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">`;

    // Inventory entries — one per lot if detailed, else aggregate
    let invEntries = '';
    if (detailed && Array.isArray(row.lots)) {
      for (const lot of row.lots) {
        const ledger = amazing
          ? SalesInter
          : (isExport ? SalesExport : (isIntra ? SalesIntra : SalesInter));
        const stockNature = amazing
          ? 'Interstate Sales - Taxable'
          : (isIntra ? 'Local Sales - Taxable' : 'Interstate Sales - Taxable');
        invEntries += `\n<ALLINVENTORYENTRIES.LIST>
<STOCKITEMNAME>${xe(Item_Card)}</STOCKITEMNAME>
<GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>
<HSNSOURCETYPE>Stock Item</HSNSOURCETYPE>
<HSNITEMSOURCE>${xe(Item_Card)}</HSNITEMSOURCE>
<GSTOVRDNSTOREDNATURE>${stockNature}</GSTOVRDNSTOREDNATURE>
<GSTOVRDNTYPEOFSUPPLY>Goods</GSTOVRDNTYPEOFSUPPLY>
<GSTHSNNAME>${xe(HSN_Card)}</GSTHSNNAME>
<GSTHSNDESCRIPTION>${xe(Item_Card)}</GSTHSNDESCRIPTION>
<BASICPACKAGEMARKS>${xe(lot.lot || '')}</BASICPACKAGEMARKS>
<BASICNUMPACKAGES>${r2(lot.bag)}</BASICNUMPACKAGES>
${TAGS.DEEMNO}
<RATE>${r2(lot.rate)}/Kgs.</RATE>
<AMOUNT>${r2(lot.amount)}</AMOUNT>
<ACTUALQTY>${r2(lot.qty)}Kgs.</ACTUALQTY>
<BILLEDQTY>${r2(lot.qty)}Kgs.</BILLEDQTY>
<BATCHALLOCATIONS.LIST>
<GODOWNNAME>Main Location</GODOWNNAME>
<BATCHNAME>Primary Batch</BATCHNAME>
<DESTINATIONGODOWNNAME>Main Location</DESTINATIONGODOWNNAME>
<AMOUNT>${r2(lot.amount)}</AMOUNT>
<ACTUALQTY>${r2(lot.qty)}Kgs.</ACTUALQTY>
<BILLEDQTY>${r2(lot.qty)}Kgs.</BILLEDQTY>
</BATCHALLOCATIONS.LIST>
<ACCOUNTINGALLOCATIONS.LIST>
<LEDGERNAME>${xe(ledger)}</LEDGERNAME>
${TAGS.DEEMNO}
<AMOUNT>${r2(lot.amount)}</AMOUNT>
</ACCOUNTINGALLOCATIONS.LIST>
${amazing ? rates.igst : (isIntra ? `${rates.cgst}\n${rates.sgst}` : rates.igst)}
${rates.cess}
</ALLINVENTORYENTRIES.LIST>`;
      }
    }

    const totalAmt    = r2(row.total);
    const totalRound  = r0(row.totalRounded || row.total);
    const rnd         = r2(totalRound - totalAmt);
    const gunny       = r2(row.gunnyAmt || 0);
    const amounttot   = r2(row.amounttot);

    xml += `\n${startVoucher}
<PARTYNAME>${partyName}</PARTYNAME>
<ADDRESS.LIST TYPE="String">
<ADDRESS>${address}</ADDRESS>
<ADDRESS>${place}</ADDRESS>
</ADDRESS.LIST>
<PARTYGSTIN>${partyGstin}</PARTYGSTIN>
<PARTYLEDGERNAME>${partyName}</PARTYLEDGERNAME>
<PARTYMAILINGNAME>${partyName}</PARTYMAILINGNAME>
<PARTYPINCODE>${pin}</PARTYPINCODE>`;

    if (dispatchEnabled) {
      xml += `
<DISPATCHFROMADDRESS.LIST TYPE="String">
<DISPATCHFROMADDRESS>${xe(d_add)}</DISPATCHFROMADDRESS>
<DISPATCHFROMADDRESS>${xe(d_place)}</DISPATCHFROMADDRESS>
</DISPATCHFROMADDRESS.LIST>
<DISPATCHFROMNAME>${xe(d_company)}</DISPATCHFROMNAME>
<DISPATCHFROMSTATENAME>${xe(d_state)}</DISPATCHFROMSTATENAME>
<DISPATCHFROMPINCODE>${xe(d_pin)}</DISPATCHFROMPINCODE>
<DISPATCHFROMPLACE>${xe(d_place)}</DISPATCHFROMPLACE>`;
    }

    xml += `
<DATE>${dateval}</DATE>
<REFERENCEDATE></REFERENCEDATE>
<VCHSTATUSDATE>${dateval}</VCHSTATUSDATE>
<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
<STATENAME>${state}</STATENAME>
<COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>
<PLACEOFSUPPLY>${state}</PLACEOFSUPPLY>
<VOUCHERNUMBER>${xe(voucherNum)}</VOUCHERNUMBER>
<REFERENCE></REFERENCE>
<CONSIGNEEGSTIN>${partyGstin}</CONSIGNEEGSTIN>
<CONSIGNEEMAILINGNAME>${partyName}</CONSIGNEEMAILINGNAME>
<CONSIGNEEPINCODE>${pin}</CONSIGNEEPINCODE>
<CONSIGNEESTATENAME>${state}</CONSIGNEESTATENAME>
<CONSIGNEECOUNTRYNAME>India</CONSIGNEECOUNTRYNAME>
<PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
<VCHENTRYMODE>Item Invoice</VCHENTRYMODE>
<DIFFACTUALQTY>Yes</DIFFACTUALQTY>
<EFFECTIVEDATE>${dateval}</EFFECTIVEDATE>
<ISINVOICE>Yes</ISINVOICE>
<NUMBERINGSTYLE>Manual</NUMBERINGSTYLE>

<LEDGERENTRIES.LIST>
<LEDGERNAME>${partyName}</LEDGERNAME>
<ISPARTYLEDGER>Yes</ISPARTYLEDGER>
${TAGS.DEEMYES}
<AMOUNT>${-totalRound}</AMOUNT>
<BILLALLOCATIONS.LIST>
<NAME>${xe(voucherNum)}</NAME>
<BILLTYPE>New Ref</BILLTYPE>
<AMOUNT>${-totalRound}</AMOUNT>
</BILLALLOCATIONS.LIST>
</LEDGERENTRIES.LIST>`;

    // Tax ledgers
    if (amazing || !isIntra) {
      xml += `
<LEDGERENTRIES.LIST>
<LEDGERNAME>${xe(Tax_IGST)}</LEDGERNAME>
${TAGS.DEEMNO}
<AMOUNT>${r2(row.igst || 0)}</AMOUNT>
${rates.igst}
${rates.cess}
</LEDGERENTRIES.LIST>`;
    } else {
      xml += `
<LEDGERENTRIES.LIST>
<LEDGERNAME>${xe(Tax_CGST)}</LEDGERNAME>
${TAGS.DEEMNO}
<AMOUNT>${r2(row.cgst || 0)}</AMOUNT>
${rates.cgst}
${rates.cess}
</LEDGERENTRIES.LIST>
<LEDGERENTRIES.LIST>
<LEDGERNAME>${xe(Tax_SGST)}</LEDGERNAME>
${TAGS.DEEMNO}
<AMOUNT>${r2(row.sgst || 0)}</AMOUNT>
${rates.sgst}
${rates.cess}
</LEDGERENTRIES.LIST>`;
    }

    // TCS
    if (tcs && row.tcsamt && row.tcsamt > 0) {
      xml += `
<LEDGERENTRIES.LIST>
<LEDGERNAME>${xe(Tax_TCS)}</LEDGERNAME>
${TAGS.DEEMNO}
<AMOUNT>${r2(row.tcsamt)}</AMOUNT>
</LEDGERENTRIES.LIST>`;
    }

    // Round off
    if (Math.abs(rnd) > 0.001) {
      xml += `
<LEDGERENTRIES.LIST>
<LEDGERNAME>${xe(Round_LDR)}</LEDGERNAME>
${rnd < 0 ? TAGS.DEEMYES : TAGS.DEEMNO}
<AMOUNT>${r2(-rnd)}</AMOUNT>
</LEDGERENTRIES.LIST>`;
    }

    xml += invEntries;
    xml += `\n${TAGS.ENDVOUCHER}`;
  }

  xml += '\n' + endEnvelope();
  const BOM = '\uFEFF';
  return BOM + xml.replace(/\r?\n/g, '\r\n');
}

// =====================================================================
// 2. RD PURCHASE (registered dealer purchases — VBA generRD)
// =====================================================================
//
// rows = [{
//   ano, date, name, address, place, pin, gstin (full "GSTIN.xxxx" or bare),
//   pan, lots: [{lot, bag, qty, rate, amount, bilamt}, ...],
//   amounttot, qtytot, bilamttot, cgst, sgst, igst, tdsamt,
//   total, totalRounded, voucherNum,
// }, ...]
//
function generRDPurchaseXML(rows, cfg, opts = {}) {
  const company    = opts.companyName || cfgGet(cfg, 'tally_company_name', cfgGet(cfg, 'short_name', 'Ideal Spices Private Limited'));
  const season     = opts.season || cfgGet(cfg, 'tally_season', cfgGet(cfg, 'season_code', '2026-27'));
  const detailed   = cfgBool(cfg, 'tally_detailed', true);
  const tlyrnd     = cfgBool(cfg, 'tally_round_enabled', true);
  const tds        = cfgBool(cfg, 'tally_tds_enabled', false);
  const opt        = cfgBool(cfg, 'tally_optional', false);
  const intra      = cfgGet(cfg, 'tally_state_code', '33');
  const amazing    = cfgBool(cfg, 'tally_amazing_mode', false);
  const aintra     = cfgGet(cfg, 'tally_state_code_amazing', '32');
  const homeIntra  = amazing ? aintra : intra;
  const sStateName = cfgGet(cfg, 'tally_home_state', amazing ? 'Kerala' : 'Tamil Nadu');

  const Purchase_LDR    = cfgGet(cfg, 'tally_purchase_dealer', 'Trade Purchase from Dealer');
  const Tax_CGST_IN     = cfgGet(cfg, 'tally_cgst_input', 'INPUT CGST 2.5%');
  const Tax_SGST_IN     = cfgGet(cfg, 'tally_sgst_input', 'INPUT SGST 2.5%');
  const Tax_IGST_IN     = cfgGet(cfg, 'tally_igst_input', 'INPUT IGST 5%');
  const TDS_LDR         = cfgGet(cfg, 'tally_tds_ledger', 'TDS on Purchase of Goods 194Q');
  const Round_LDR       = cfgGet(cfg, 'tally_round', 'Round Off');
  const Item_Card       = cfgGet(cfg, 'tally_item_cardamom', 'Cardamom');
  const HSN_Card        = cfgGet(cfg, 'tally_hsn_cardamom',  '09083110');

  let xml = '\n' + startEnvelope(company, 'Vouchers');

  for (const row of rows) {
    const dateval    = toTallyDate(row.date);
    const ano        = xe(row.ano);
    const taxNm      = xe(row.voucherNum || row.invo || row.id || '');
    const name       = xe(row.name);
    const address    = xe(row.address);
    const place      = xe(row.place);
    const pin        = xe(row.pin);
    const fullGstin  = String(row.gstin || '');
    const partyGstin = fullGstin.toUpperCase().startsWith('GST') ? fullGstin.slice(6, 21) : fullGstin;
    const state      = xe(findState(partyGstin));
    const isIntra    = String(partyGstin).slice(0, 2) === String(homeIntra);
    const rates      = rateDetails(cfgNum(cfg, 'gst_goods', 5));

    const startVoucher = `<VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Invoice Voucher View">`;
    const total       = r2(row.total);
    const totalRound  = tlyrnd ? r0(total) : total;
    const rnd         = tlyrnd ? r2(totalRound - total) : 0;
    const cgst        = r2(row.cgst || 0);
    const sgst        = r2(row.sgst || 0);
    const igst        = r2(row.igst || 0);
    const tdsamt      = tds ? r2(row.tdsamt || 0) : 0;
    const bilamttot   = r2(row.bilamttot || total);
    const amounttot   = r2(row.amounttot || 0);
    const qtytot      = r2(row.qtytot || 0);
    const rt          = r2(row.rate || (qtytot > 0 ? amounttot / qtytot : 0));

    // bill allocations per lot
    let billAlloc1 = '';
    if (detailed && Array.isArray(row.lots)) {
      for (const lot of row.lots) {
        billAlloc1 += `
<BILLALLOCATIONS.LIST>
<NAME>${xe(`${row.ano}/${lot.lot}/${season}`)}</NAME>
<BILLTYPE>New Ref</BILLTYPE>
<AMOUNT>${tlyrnd ? r0(lot.bilamt || 0) : r2(lot.bilamt || 0)}</AMOUNT>
</BILLALLOCATIONS.LIST>`;
      }
    }

    // Inventory blocks (per lot when detailed)
    let invEntries = '';
    if (detailed && Array.isArray(row.lots)) {
      for (const lot of row.lots) {
        const ledger = isIntra ? `${Purchase_LDR}-Local` : `${Purchase_LDR}-Inter_State`;
        const nature = isIntra ? 'Local Purchase - Taxable' : 'Interstate Purchase - Taxable';
        invEntries += `\n<ALLINVENTORYENTRIES.LIST>
<STOCKITEMNAME>${xe(Item_Card)}</STOCKITEMNAME>
<GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>
<GSTSOURCETYPE>Ledger</GSTSOURCETYPE>
<HSNLEDGERSOURCE>${xe(ledger)}</HSNLEDGERSOURCE>
<GSTOVRDNSTOREDNATURE>${nature}</GSTOVRDNSTOREDNATURE>
<GSTOVRDNTYPEOFSUPPLY>Goods</GSTOVRDNTYPEOFSUPPLY>
<GSTHSNNAME>${xe(HSN_Card)}</GSTHSNNAME>
<GSTHSNDESCRIPTION>Cardamom</GSTHSNDESCRIPTION>
${TAGS.DEEMYES}
<RATE>${r2(lot.rate)}/Kgs.</RATE>
<AMOUNT>${-r2(lot.amount)}</AMOUNT>
<ACTUALQTY>${r2(lot.qty)}Kgs.</ACTUALQTY>
<BILLEDQTY>${r2(lot.qty)}Kgs.</BILLEDQTY>
<BATCHALLOCATIONS.LIST>
<GODOWNNAME>Main Location</GODOWNNAME>
<BATCHNAME>${xe(`${row.ano}/${lot.lot}`)}</BATCHNAME>
<DESTINATIONGODOWNNAME>Main Location</DESTINATIONGODOWNNAME>
<AMOUNT>${-r2(lot.amount)}</AMOUNT>
<ACTUALQTY>${r2(lot.qty)}Kgs.</ACTUALQTY>
<BILLEDQTY>${r2(lot.qty)}Kgs.</BILLEDQTY>
</BATCHALLOCATIONS.LIST>
<ACCOUNTINGALLOCATIONS.LIST>
<LEDGERNAME>${xe(ledger)}</LEDGERNAME>
<GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>
${TAGS.DEEMYES}
<AMOUNT>${-r2(lot.amount)}</AMOUNT>
</ACCOUNTINGALLOCATIONS.LIST>
${isIntra ? `${rates.cgst}\n${rates.sgst}` : rates.igst}
${rates.cess}
</ALLINVENTORYENTRIES.LIST>`;
      }
    } else {
      // Aggregate single inventory entry
      const ledger = isIntra ? `${Purchase_LDR}-Local` : `${Purchase_LDR}-Inter_State`;
      const nature = isIntra ? 'Local Purchase - Taxable' : 'Interstate Purchase - Taxable';
      invEntries += `\n<ALLINVENTORYENTRIES.LIST>
<STOCKITEMNAME>${xe(Item_Card)}</STOCKITEMNAME>
<GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>
<GSTSOURCETYPE>Ledger</GSTSOURCETYPE>
<HSNLEDGERSOURCE>${xe(ledger)}</HSNLEDGERSOURCE>
<GSTOVRDNSTOREDNATURE>${nature}</GSTOVRDNSTOREDNATURE>
<GSTOVRDNTYPEOFSUPPLY>Goods</GSTOVRDNTYPEOFSUPPLY>
<GSTHSNNAME>${xe(HSN_Card)}</GSTHSNNAME>
<GSTHSNDESCRIPTION>Cardamom</GSTHSNDESCRIPTION>
${TAGS.DEEMYES}
<RATE>${rt}/Kgs.</RATE>
<AMOUNT>${-amounttot}</AMOUNT>
<ACTUALQTY>${qtytot}Kgs.</ACTUALQTY>
<BILLEDQTY>${qtytot}Kgs.</BILLEDQTY>
<ACCOUNTINGALLOCATIONS.LIST>
<LEDGERNAME>${xe(ledger)}</LEDGERNAME>
<GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>
${TAGS.DEEMYES}
<AMOUNT>${-amounttot}</AMOUNT>
</ACCOUNTINGALLOCATIONS.LIST>
${isIntra ? `${rates.cgst}\n${rates.sgst}` : rates.igst}
${rates.cess}
</ALLINVENTORYENTRIES.LIST>`;
    }

    xml += `\n${startVoucher}
<ADDRESS.LIST TYPE="String">
<ADDRESS>${address}</ADDRESS>
<ADDRESS>${place}</ADDRESS>
</ADDRESS.LIST>
<DATE>${dateval}</DATE>
<REFERENCEDATE>${dateval}</REFERENCEDATE>
<VCHSTATUSDATE>${dateval}</VCHSTATUSDATE>
<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
<STATENAME>${state}</STATENAME>
<COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>
<PARTYGSTIN>${xe(partyGstin)}</PARTYGSTIN>
<PLACEOFSUPPLY>${xe(sStateName)}</PLACEOFSUPPLY>
<PARTYNAME>${name}</PARTYNAME>
<PARTYLEDGERNAME>${name}</PARTYLEDGERNAME>
<VOUCHERNUMBER>${xe(`${row.ano}/${taxNm}/${season}`)}</VOUCHERNUMBER>
<REFERENCE>${xe(`${row.ano}/${taxNm}/${season}`)}</REFERENCE>
<PARTYMAILINGNAME>${name}</PARTYMAILINGNAME>
<PARTYPINCODE>${pin}</PARTYPINCODE>
<NUMBERINGSTYLE>Manual</NUMBERINGSTYLE>
<PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
<VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
<VCHENTRYMODE>Item Invoice</VCHENTRYMODE>
<DIFFACTUALQTY>Yes</DIFFACTUALQTY>
<EFFECTIVEDATE>${dateval}</EFFECTIVEDATE>
<ISELIGIBLEFORITC>Yes</ISELIGIBLEFORITC>
<ISINVOICE>Yes</ISINVOICE>
<ISOPTIONAL>${opt ? 'Yes' : 'No'}</ISOPTIONAL>

<LEDGERENTRIES.LIST>
<LEDGERNAME>${name}</LEDGERNAME>
${TAGS.DEEMNO}
<ISPARTYLEDGER>Yes</ISPARTYLEDGER>
<AMOUNT>${tlyrnd ? r0(total) : total}</AMOUNT>${detailed ? billAlloc1 : `
<BILLALLOCATIONS.LIST>
<NAME>${xe(`${row.ano}/${taxNm}/${season}`)}</NAME>
<BILLTYPE>New Ref</BILLTYPE>
<AMOUNT>${tlyrnd ? r0(bilamttot) : bilamttot}</AMOUNT>
</BILLALLOCATIONS.LIST>`}
<BILLALLOCATIONS.LIST>
<NAME>${xe(`${row.ano}/GST/${season}`)}</NAME>
<BILLTYPE>New Ref</BILLTYPE>
<AMOUNT>${tlyrnd ? (r0(cgst + sgst + igst) - tdsamt) : (r2(cgst + sgst + igst) - tdsamt)}</AMOUNT>
</BILLALLOCATIONS.LIST>
</LEDGERENTRIES.LIST>`;

    // Tax ledgers
    if (isIntra) {
      xml += `
<LEDGERENTRIES.LIST>
<LEDGERNAME>${xe(Tax_CGST_IN)}</LEDGERNAME>
${TAGS.DEEMYES}
<AMOUNT>${-cgst}</AMOUNT>
<VATEXPAMOUNT>${-cgst}</VATEXPAMOUNT>
</LEDGERENTRIES.LIST>
<LEDGERENTRIES.LIST>
<LEDGERNAME>${xe(Tax_SGST_IN)}</LEDGERNAME>
${TAGS.DEEMYES}
<AMOUNT>${-sgst}</AMOUNT>
<VATEXPAMOUNT>${-sgst}</VATEXPAMOUNT>
</LEDGERENTRIES.LIST>`;
    } else {
      xml += `
<LEDGERENTRIES.LIST>
<LEDGERNAME>${xe(Tax_IGST_IN)}</LEDGERNAME>
${TAGS.DEEMYES}
<AMOUNT>${-igst}</AMOUNT>
<VATEXPAMOUNT>${-igst}</VATEXPAMOUNT>
</LEDGERENTRIES.LIST>`;
    }

    // TDS
    if (tds && tdsamt > 0) {
      xml += `
<LEDGERENTRIES.LIST>
<LEDGERNAME>${xe(TDS_LDR)}</LEDGERNAME>
${TAGS.DEEMNO}
<AMOUNT>${-tdsamt}</AMOUNT>
</LEDGERENTRIES.LIST>`;
    }

    // Round
    if (tlyrnd && Math.abs(rnd) > 0.001) {
      xml += `
<LEDGERENTRIES.LIST>
<LEDGERNAME>${xe(Round_LDR)}</LEDGERNAME>
${TAGS.DEEMYES}
<AMOUNT>${-r2(rnd)}</AMOUNT>
<VATEXPAMOUNT>${-r2(rnd)}</VATEXPAMOUNT>
</LEDGERENTRIES.LIST>`;
    }

    xml += invEntries;
    xml += `\n${TAGS.ENDVOUCHER}`;
  }

  xml += '\n' + endEnvelope();
  const BOM = '\uFEFF';
  return BOM + xml.replace(/\r?\n/g, '\r\n');
}

// =====================================================================
// 3. URD PURCHASE (agriculturist / unregistered — VBA generURD)
// =====================================================================
//
// rows = [{
//   ano, date, name, address, place, pin, lots: [...], amounttot,
//   qtytot, bilamttot, total, voucherNum
// }, ...]
//
function generURDPurchaseXML(rows, cfg, opts = {}) {
  const company   = opts.companyName || cfgGet(cfg, 'tally_company_name', cfgGet(cfg, 'short_name', 'Ideal Spices Private Limited'));
  const season    = opts.season || cfgGet(cfg, 'tally_season', cfgGet(cfg, 'season_code', '2026-27'));
  const detailed  = cfgBool(cfg, 'tally_detailed', true);
  const tlyrnd    = cfgBool(cfg, 'tally_round_enabled', true);
  const opt       = cfgBool(cfg, 'tally_optional', false);
  const amazing   = cfgBool(cfg, 'tally_amazing_mode', false);
  const invPrefix = cfgGet(cfg, 'tally_inv_prefix', 'ISP/');
  const ainvPrefix= cfgGet(cfg, 'tally_ainv_prefix', 'ASP/');
  const sStateName= cfgGet(cfg, 'tally_urd_state', 'Kerala');

  const Auction_LDR    = cfgGet(cfg, 'tally_purchase_auction', 'Auction Purchase Account');
  const Round_LDR      = cfgGet(cfg, 'tally_round', 'Round Off');
  const Item_Card      = cfgGet(cfg, 'tally_item_cardamom', 'Cardamom');
  const HSN_Card       = cfgGet(cfg, 'tally_hsn_cardamom',  '09083110');

  const rates = rateDetails(cfgNum(cfg, 'gst_goods', 5));

  let xml = '\n' + startEnvelope(company, 'Vouchers');

  for (const row of rows) {
    const dateval    = toTallyDate(row.date);
    const ano        = xe(row.ano);
    const taxNm      = xe(row.voucherNum || row.invo || row.id || '');
    const name       = xe(row.name);
    const address    = xe(row.address);
    const place      = xe(row.place);
    const pin        = xe(row.pin);
    const total      = r2(row.total);
    const totalRound = tlyrnd ? r0(total) : total;
    const rnd        = tlyrnd ? r2(totalRound - total) : 0;
    const amounttot  = r2(row.amounttot);
    const qtytot     = r2(row.qtytot);
    const rt         = r2(qtytot > 0 ? amounttot / qtytot : 0);
    const voucherRef = `${amazing ? ainvPrefix : invPrefix}P-${taxNm}/${season}`;

    const startVoucher = `<VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Invoice Voucher View">`;

    // Bill allocations (per lot)
    let billAlloc = '';
    if (Array.isArray(row.lots)) {
      for (const lot of row.lots) {
        billAlloc += `
<BILLALLOCATIONS.LIST>
<NAME>${xe(`${row.ano}/${lot.lot}/${season}`)}</NAME>
<BILLTYPE>New Ref</BILLTYPE>
<AMOUNT>${tlyrnd ? r0(lot.bilamt || lot.amount) : r2(lot.bilamt || lot.amount)}</AMOUNT>
</BILLALLOCATIONS.LIST>`;
      }
    }

    // Inventory: detailed-per-lot or aggregated
    let invEntries = '';
    if (detailed && Array.isArray(row.lots)) {
      for (const lot of row.lots) {
        invEntries += `\n<ALLINVENTORYENTRIES.LIST>
<STOCKITEMNAME>${xe(Item_Card)}</STOCKITEMNAME>
<GSTOVRDNTAXABILITY>Nil Rated</GSTOVRDNTAXABILITY>
<GSTSOURCETYPE>Ledger</GSTSOURCETYPE>
<GSTLEDGERSOURCE>${xe(Auction_LDR)}</GSTLEDGERSOURCE>
<HSNSOURCETYPE>Stock Item</HSNSOURCETYPE>
<HSNITEMSOURCE>${xe(Item_Card)}</HSNITEMSOURCE>
<GSTOVRDNTYPEOFSUPPLY>Goods</GSTOVRDNTYPEOFSUPPLY>
<GSTHSNNAME>${xe(HSN_Card)}</GSTHSNNAME>
<GSTHSNDESCRIPTION>${xe(Item_Card)}</GSTHSNDESCRIPTION>
<BASICPACKAGEMARKS>${xe(`${row.ano}/${lot.lot}`)}</BASICPACKAGEMARKS>
<BASICNUMPACKAGES>${r0(lot.bag)} Bags</BASICNUMPACKAGES>
${TAGS.DEEMYES}
<RATE>${r2(lot.rate)}/Kgs.</RATE>
<AMOUNT>${-r2(lot.amount)}</AMOUNT>
<ACTUALQTY>${r2(lot.qty)}Kgs.</ACTUALQTY>
<BILLEDQTY>${r2(lot.qty)}Kgs.</BILLEDQTY>
<BATCHALLOCATIONS.LIST>
<GODOWNNAME>Main Location</GODOWNNAME>
<BATCHNAME>${xe(`${row.ano}/${lot.lot}`)}</BATCHNAME>
<DESTINATIONGODOWNNAME>Main Location</DESTINATIONGODOWNNAME>
<AMOUNT>${-r2(lot.amount)}</AMOUNT>
<ACTUALQTY>${r2(lot.qty)}Kgs.</ACTUALQTY>
<BILLEDQTY>${r2(lot.qty)}Kgs.</BILLEDQTY>
</BATCHALLOCATIONS.LIST>
<ACCOUNTINGALLOCATIONS.LIST>
<LEDGERNAME>${xe(Auction_LDR)}</LEDGERNAME>
<GSTOVRDNTAXABILITY>Nil Rated</GSTOVRDNTAXABILITY>
${TAGS.DEEMYES}
<AMOUNT>${-r2(lot.amount)}</AMOUNT>
</ACCOUNTINGALLOCATIONS.LIST>
${rates.cgst}
${rates.sgst}
${rates.igst}
${rates.cess}
${rates.scess}
</ALLINVENTORYENTRIES.LIST>`;
      }
    } else {
      invEntries = `\n<ALLINVENTORYENTRIES.LIST>
<STOCKITEMNAME>${xe(Item_Card)}</STOCKITEMNAME>
<GSTOVRDNTAXABILITY>Nil Rated</GSTOVRDNTAXABILITY>
<GSTSOURCETYPE>Ledger</GSTSOURCETYPE>
<GSTLEDGERSOURCE>${xe(Auction_LDR)}</GSTLEDGERSOURCE>
<HSNSOURCETYPE>Stock Item</HSNSOURCETYPE>
<HSNITEMSOURCE>${xe(Item_Card)}</HSNITEMSOURCE>
<GSTOVRDNTYPEOFSUPPLY>Goods</GSTOVRDNTYPEOFSUPPLY>
<GSTHSNNAME>${xe(HSN_Card)}</GSTHSNNAME>
<GSTHSNDESCRIPTION>${xe(Item_Card)}</GSTHSNDESCRIPTION>
<BASICPACKAGEMARKS>${xe(row.ano || '')}</BASICPACKAGEMARKS>
<BASICNUMPACKAGES></BASICNUMPACKAGES>
${TAGS.DEEMYES}
<RATE>${rt}/Kgs.</RATE>
<AMOUNT>${-amounttot}</AMOUNT>
<ACTUALQTY>${qtytot}Kgs.</ACTUALQTY>
<BILLEDQTY>${qtytot}Kgs.</BILLEDQTY>
<ACCOUNTINGALLOCATIONS.LIST>
<LEDGERNAME>${xe(Auction_LDR)}</LEDGERNAME>
<GSTOVRDNTAXABILITY>Nil Rated</GSTOVRDNTAXABILITY>
${TAGS.DEEMYES}
<AMOUNT>${-amounttot}</AMOUNT>
</ACCOUNTINGALLOCATIONS.LIST>
${rates.cgst}
${rates.sgst}
${rates.igst}
${rates.cess}
${rates.scess}
</ALLINVENTORYENTRIES.LIST>`;
    }

    xml += `\n${startVoucher}
<ADDRESS.LIST TYPE="String">
<ADDRESS>${address}</ADDRESS>
<ADDRESS>${place}</ADDRESS>
</ADDRESS.LIST>
<DATE>${dateval}</DATE>
<REFERENCEDATE></REFERENCEDATE>
<VCHSTATUSDATE>${dateval}</VCHSTATUSDATE>
<GSTREGISTRATIONTYPE>Unregistered/Consumer</GSTREGISTRATIONTYPE>
<VATDEALERTYPE>Unregistered/Consumer</VATDEALERTYPE>
<STATENAME>${xe(sStateName)}</STATENAME>
<COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>
<PLACEOFSUPPLY>${xe(sStateName)}</PLACEOFSUPPLY>
<PARTYNAME>${name}</PARTYNAME>
<REFERENCE></REFERENCE>
<PARTYLEDGERNAME>${name}</PARTYLEDGERNAME>
<VOUCHERNUMBER>${xe(voucherRef)}</VOUCHERNUMBER>
<PARTYMAILINGNAME>${name}</PARTYMAILINGNAME>
<PARTYPINCODE>${pin}</PARTYPINCODE>
<BASICBASEPARTYNAME>${name}</BASICBASEPARTYNAME>
<NUMBERINGSTYLE>Manual</NUMBERINGSTYLE>
<FBTPAYMENTTYPE>Default</FBTPAYMENTTYPE>
<PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
<VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
<BASICDATETIMEOFINVOICE></BASICDATETIMEOFINVOICE>
<BASICDATETIMEOFREMOVAL></BASICDATETIMEOFREMOVAL>
<VCHENTRYMODE>Item Invoice</VCHENTRYMODE>
<DIFFACTUALQTY>Yes</DIFFACTUALQTY>
<EFFECTIVEDATE>${dateval}</EFFECTIVEDATE>
<ISELIGIBLEFORITC>Yes</ISELIGIBLEFORITC>
<VCHGSTSTATUSISUNCERTAIN>No</VCHGSTSTATUSISUNCERTAIN>
<VCHGSTSTATUSISAPPLICABLE>Applicable</VCHGSTSTATUSISAPPLICABLE>
<ISINVOICE>Yes</ISINVOICE>
<ISOPTIONAL>${opt ? 'Yes' : 'No'}</ISOPTIONAL>
<ISVATDUTYPAID>Yes</ISVATDUTYPAID>

<LEDGERENTRIES.LIST>
<LEDGERNAME>${name}</LEDGERNAME>
${TAGS.DEEMNO}
<ISPARTYLEDGER>Yes</ISPARTYLEDGER>
<AMOUNT>${tlyrnd ? r0(total) : total}</AMOUNT>${billAlloc}
</LEDGERENTRIES.LIST>`;

    if (tlyrnd && Math.abs(rnd) > 0.001) {
      xml += `
<LEDGERENTRIES.LIST>
<LEDGERNAME>${xe(Round_LDR)}</LEDGERNAME>
${TAGS.DEEMYES}
<AMOUNT>${-r2(rnd)}</AMOUNT>
<VATEXPAMOUNT>${-r2(rnd)}</VATEXPAMOUNT>
</LEDGERENTRIES.LIST>`;
    }

    xml += invEntries;
    xml += `\n${TAGS.ENDVOUCHER}`;
  }

  xml += '\n' + endEnvelope();

  // Match the byte sequence Tally has been importing successfully from
  // the macros: UTF-8 BOM + CRLF line endings.
  const BOM = '\uFEFF';
  return BOM + xml.replace(/\r?\n/g, '\r\n');
}

// =====================================================================
// 4. DEBIT NOTE (discount received from supplier — VBA generDN)
// =====================================================================
//
// rows = [{
//   ano, date, name (with -PURCHASE suffix or we add it),
//   address, place, pin, gstin, partyGstin,
//   refundtot, cgsttot, sgsttot, igsttot, total, voucherNum
// }, ...]
//
function generDebitNoteXML(rows, cfg, opts = {}) {
  const company    = opts.companyName || cfgGet(cfg, 'tally_company_name', cfgGet(cfg, 'short_name', 'Ideal Spices Private Limited'));
  const season     = opts.season || cfgGet(cfg, 'tally_season', cfgGet(cfg, 'season_code', '2026-27'));
  const tlyrnd     = cfgBool(cfg, 'tally_round_enabled', true);
  const exempt     = cfgBool(cfg, 'tally_dn_exempt', false);
  const opt        = cfgBool(cfg, 'tally_optional', false);
  const intra      = cfgGet(cfg, 'tally_state_code', '33');
  const sStateName = cfgGet(cfg, 'tally_home_state', 'Tamil Nadu');

  const Discount_LDR  = cfgGet(cfg, 'tally_dn_discount', 'Discount Received');
  const Tax_CGST      = cfgGet(cfg, 'tally_dn_cgst', 'OUTPUT CGST 9%');
  const Tax_SGST      = cfgGet(cfg, 'tally_dn_sgst', 'OUTPUT SGST 9%');
  const Tax_IGST      = cfgGet(cfg, 'tally_dn_igst', 'OUTPUT IGST 18%');
  const Round_LDR     = cfgGet(cfg, 'tally_round', 'Round Off');
  const HSN_Service   = cfgGet(cfg, 'tally_hsn_service', '996111');
  const dnGstRate     = cfgNum(cfg, 'tally_dn_gst_rate', 18);

  const rates = rateDetails(dnGstRate);

  let xml = '\n' + startEnvelope(company, 'Vouchers');

  for (const row of rows) {
    const dateval     = toTallyDate(row.date);
    const ano         = xe(row.ano);
    const taxNm       = xe(row.voucherNum || row.note_no || row.id || '');
    const name        = xe(row.name);
    const address     = xe(row.address);
    const place       = xe(row.place);
    const pin         = xe(row.pin);
    const fullGstin   = String(row.gstin || '');
    const partyGstin  = row.partyGstin || (fullGstin.toUpperCase().startsWith('GST') ? fullGstin.slice(6, 21) : fullGstin);
    const state       = xe(findState(partyGstin));
    const isIntra     = String(partyGstin).slice(0, 2) === String(intra);
    const refundtot   = r2(row.refundtot || row.amount || 0);
    const cgsttot     = r2(row.cgsttot || row.cgst || 0);
    const sgsttot     = r2(row.sgsttot || row.sgst || 0);
    const igsttot     = r2(row.igsttot || row.igst || 0);
    const total       = r2(row.total || (refundtot + cgsttot + sgsttot + igsttot));
    const totalRound  = tlyrnd ? r0(total) : total;
    const rnd         = tlyrnd ? r2(totalRound - total) : 0;

    const startVoucher = `<VOUCHER VCHTYPE="Debit Note" ACTION="Create" OBJVIEW="Invoice Voucher View">`;

    xml += `\n${startVoucher}
<ADDRESS.LIST TYPE="String">
<ADDRESS>${address}</ADDRESS>
<ADDRESS>${place}</ADDRESS>
</ADDRESS.LIST>
<DATE>${dateval}</DATE>
<REFERENCEDATE>${dateval}</REFERENCEDATE>
<VCHSTATUSDATE>${dateval}</VCHSTATUSDATE>
<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
<STATENAME>${state}</STATENAME>
<COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>
<PARTYGSTIN>${xe(partyGstin)}</PARTYGSTIN>
<PLACEOFSUPPLY>${xe(sStateName)}</PLACEOFSUPPLY>
<PARTYNAME>${name}</PARTYNAME>
<PARTYLEDGERNAME>${name}</PARTYLEDGERNAME>
<VOUCHERNUMBER>${xe(`DN/${taxNm}/${season}`)}</VOUCHERNUMBER>
<REFERENCE>${xe(`DN/${taxNm}/${season}`)}</REFERENCE>
<PARTYMAILINGNAME>${name}</PARTYMAILINGNAME>
<PARTYPINCODE>${pin}</PARTYPINCODE>
<NUMBERINGSTYLE>Manual</NUMBERINGSTYLE>
<PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
<VOUCHERTYPENAME>Debit Note</VOUCHERTYPENAME>
<VCHENTRYMODE>Item Invoice</VCHENTRYMODE>
<EFFECTIVEDATE>${dateval}</EFFECTIVEDATE>
<ISINVOICE>Yes</ISINVOICE>
<ISOPTIONAL>${opt ? 'Yes' : 'No'}</ISOPTIONAL>

<LEDGERENTRIES.LIST>
<LEDGERNAME>${name}</LEDGERNAME>
${TAGS.DEEMNO}
<ISPARTYLEDGER>Yes</ISPARTYLEDGER>
<AMOUNT>${-totalRound}</AMOUNT>
<BILLALLOCATIONS.LIST>
<NAME>${xe(`DN/${taxNm}/${season}`)}</NAME>
<BILLTYPE>New Ref</BILLTYPE>
<AMOUNT>${-totalRound}</AMOUNT>
</BILLALLOCATIONS.LIST>
</LEDGERENTRIES.LIST>

<LEDGERENTRIES.LIST>
<LEDGERNAME>${xe(Discount_LDR)}</LEDGERNAME>
<GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>
<HSNSOURCETYPE>Ledger</HSNSOURCETYPE>
<HSNLEDGERSOURCE>${xe(Discount_LDR)}</HSNLEDGERSOURCE>
<GSTOVRDNTYPEOFSUPPLY>Services</GSTOVRDNTYPEOFSUPPLY>
<GSTHSNNAME>${xe(HSN_Service)}</GSTHSNNAME>
<GSTHSNDESCRIPTION>${xe(Discount_LDR)}</GSTHSNDESCRIPTION>
${TAGS.DEEMNO}
<AMOUNT>${refundtot}</AMOUNT>
<VATEXPAMOUNT>${refundtot}</VATEXPAMOUNT>
${rates.cgst}
${rates.sgst}
${rates.igst}
${rates.cess}
${rates.scess}
</LEDGERENTRIES.LIST>`;

    if (!exempt) {
      if (isIntra) {
        xml += `
<LEDGERENTRIES.LIST>
<LEDGERNAME>${xe(Tax_CGST)}</LEDGERNAME>
${TAGS.DEEMNO}
<AMOUNT>${cgsttot}</AMOUNT>
<VATEXPAMOUNT>${cgsttot}</VATEXPAMOUNT>
</LEDGERENTRIES.LIST>
<LEDGERENTRIES.LIST>
<LEDGERNAME>${xe(Tax_SGST)}</LEDGERNAME>
${TAGS.DEEMNO}
<AMOUNT>${sgsttot}</AMOUNT>
<VATEXPAMOUNT>${sgsttot}</VATEXPAMOUNT>
</LEDGERENTRIES.LIST>`;
      } else {
        xml += `
<LEDGERENTRIES.LIST>
<LEDGERNAME>${xe(Tax_IGST)}</LEDGERNAME>
${TAGS.DEEMNO}
<AMOUNT>${igsttot}</AMOUNT>
<VATEXPAMOUNT>${igsttot}</VATEXPAMOUNT>
</LEDGERENTRIES.LIST>`;
      }
    }

    if (tlyrnd && Math.abs(rnd) > 0.001) {
      xml += `
<LEDGERENTRIES.LIST>
<LEDGERNAME>${xe(Round_LDR)}</LEDGERNAME>
${TAGS.DEEMNO}
<AMOUNT>${r2(rnd)}</AMOUNT>
<VATEXPAMOUNT>${r2(rnd)}</VATEXPAMOUNT>
</LEDGERENTRIES.LIST>`;
    }

    xml += `\n${TAGS.ENDVOUCHER}`;
  }

  xml += '\n' + endEnvelope();
  const BOM = '\uFEFF';
  return BOM + xml.replace(/\r?\n/g, '\r\n');
}

// =====================================================================
// Data builders — convert DB rows into the {rows} shape each XML fn wants
// =====================================================================

/**
 * Pull invoices for an auction, group by invoice number, attach lots.
 * Used by Sales export.
 */
function buildSalesRows(db, auctionId, cfg) {
  const stmt = db.prepare(`
    SELECT i.*, b.add1, b.add2, b.pla AS buyer_pla, b.pin AS buyer_pin
    FROM invoices i
    LEFT JOIN buyers b ON b.buyer = i.buyer
    WHERE i.auction_id = ?
    ORDER BY i.buyer, i.sale, i.invo, i.id
  `);
  const raw = stmt.all(auctionId);

  // Group by party — one voucher per buyer.
  // Macro behaviour: a single voucher captures all lots for a buyer with a
  // shared invoice header. We mirror that by keying on buyer + sale + gstin
  // so two distinct invoice numbers for the same buyer (rare but possible
  // when a buyer is split across two trades) still merge into one voucher,
  // and the invoice number used is the lowest one for that buyer. If the
  // user wants strict per-invoice-number vouchers they can give each lot a
  // different buyer code.
  const grouped = {};
  for (const r of raw) {
    const partyKey = `${r.buyer}|${r.gstin}|${r.sale || 'L'}`;
    if (!grouped[partyKey]) {
      grouped[partyKey] = {
        ano: r.ano,
        date: r.date,
        sale: r.sale,
        invo: r.invo,                      // first/lowest invoice number wins
        buyer: r.buyer,
        partyName: r.buyer1 || r.buyer || '',
        address: [r.add1, r.add2].filter(Boolean).join(', '),
        place: r.place || r.buyer_pla || '',
        pin: r.buyer_pin || '',
        partyGstin: r.gstin || '',
        lots: [],
        amounttot: 0,
        gunnyAmt: 0,
        cgst: 0, sgst: 0, igst: 0, tcsamt: 0,
        total: 0,
      };
    }
    const g = grouped[partyKey];
    g.lots.push({
      lot: r.lot,
      bag: r.bag,
      qty: r.qty,
      rate: r.price,
      amount: r.amount,
    });
    g.amounttot += Number(r.amount || 0);
    g.gunnyAmt  += Number(r.gunny || 0);
    g.cgst      += Number(r.cgst || 0);
    g.sgst      += Number(r.sgst || 0);
    g.igst      += Number(r.igst || 0);
    g.tcsamt    += Number(r.tcs || 0);
    g.total     += Number(r.tot || 0);
  }

  // round
  const out = Object.values(grouped);
  for (const g of out) {
    g.amounttot = r2(g.amounttot);
    g.gunnyAmt  = r2(g.gunnyAmt);
    g.cgst = r2(g.cgst); g.sgst = r2(g.sgst); g.igst = r2(g.igst);
    g.tcsamt = r2(g.tcsamt);
    g.total = r2(g.total);
    g.totalRounded = r0(g.total);
  }
  return out;
}

/**
 * Pull purchases (registered dealers) for an auction.
 * RD = gstin starts with "GSTIN." marker (matches the macro convention).
 */
function buildRDPurchaseRows(db, auctionId, cfg) {
  // Pull from purchases table (one row per voucher already aggregated)
  const stmt = db.prepare(`
    SELECT p.*
    FROM purchases p
    WHERE p.auction_id = ?
      AND UPPER(p.gstin) LIKE 'GSTIN.%'
    ORDER BY p.invo, p.id
  `);
  const raw = stmt.all(auctionId);

  // Pull lots for each purchase (matched by name + auction)
  const lotsStmt = db.prepare(`
    SELECT lot_no AS lot, bags AS bag, pqty AS qty, prate AS rate,
           puramt AS amount, bilamt
    FROM lots
    WHERE auction_id = ? AND name = ? AND puramt > 0
    ORDER BY lot_no
  `);

  return raw.map((p) => {
    const lots = lotsStmt.all(auctionId, p.name).map(l => ({
      lot: l.lot, bag: l.bag, qty: l.qty, rate: l.rate,
      amount: l.amount, bilamt: l.bilamt || l.amount,
    }));
    const qtytot = lots.reduce((s, l) => s + Number(l.qty || 0), 0);
    const amounttot = lots.reduce((s, l) => s + Number(l.amount || 0), 0);
    const bilamttot = lots.reduce((s, l) => s + Number(l.bilamt || 0), 0);
    return {
      ano: p.ano,
      date: p.date,
      name: p.name,
      address: p.add_line,
      place: p.place,
      pin: '',
      gstin: p.gstin,
      pan: '',
      lots,
      qtytot: r2(qtytot),
      amounttot: r2(amounttot),
      bilamttot: r2(bilamttot || p.amount),
      cgst: p.cgst, sgst: p.sgst, igst: p.igst,
      tdsamt: p.tds,
      total: p.total,
      totalRounded: r0(p.total),
      voucherNum: p.invo || String(p.id),
    };
  });
}

/**
 * Pull bills of supply (URD/agriculturist) for an auction.
 */
function buildURDPurchaseRows(db, auctionId, cfg) {
  const stmt = db.prepare(`
    SELECT * FROM bills WHERE ano IN (
      SELECT ano FROM auctions WHERE id = ?
    )
    ORDER BY bil, id
  `);
  const raw = stmt.all(auctionId);

  // Lots for each bill — match by name + auction
  const lotsStmt = db.prepare(`
    SELECT lot_no AS lot, bags AS bag, pqty AS qty, prate AS rate,
           puramt AS amount, bilamt
    FROM lots
    WHERE auction_id = ? AND name = ? AND puramt > 0 AND (cr = '' OR cr IS NULL OR cr NOT LIKE 'GSTIN.%')
    ORDER BY lot_no
  `);

  return raw.map((b) => {
    const lots = lotsStmt.all(auctionId, b.name).map(l => ({
      lot: l.lot, bag: l.bag, qty: l.qty, rate: l.rate,
      amount: l.amount, bilamt: l.bilamt || l.amount,
    }));
    const qtytot = lots.reduce((s, l) => s + Number(l.qty || 0), 0);
    const amounttot = lots.reduce((s, l) => s + Number(l.amount || 0), 0);
    const bilamttot = lots.reduce((s, l) => s + Number(l.bilamt || 0), 0);
    return {
      ano: b.ano,
      date: b.date,
      name: b.name,
      address: b.add_line,
      place: b.pla,
      pin: '',
      lots,
      qtytot: r2(qtytot),
      amounttot: r2(amounttot),
      bilamttot: r2(bilamttot || b.net),
      total: b.net,
      voucherNum: String(b.bil),
    };
  });
}

/**
 * Pull debit notes for an auction.
 */
function buildDebitNoteRows(db, auctionId, cfg) {
  // debit_notes table has no auction_id; filter by date range of auction
  const a = db.prepare('SELECT date FROM auctions WHERE id = ?').get(auctionId);
  if (!a) return [];
  const stmt = db.prepare(`
    SELECT * FROM debit_notes WHERE date = ? ORDER BY id
  `);
  const raw = stmt.all(a.date);
  return raw.map((d) => ({
    ano: d.ano,
    date: d.date,
    name: d.name,
    address: '',
    place: '',
    pin: '',
    gstin: '',
    refundtot: d.amount,
    cgsttot: d.cgst, sgsttot: d.sgst, igsttot: d.igst,
    total: d.total,
    voucherNum: d.note_no || String(d.id),
  }));
}

// =====================================================================
// 5. LEDGER MASTERS (party + tax + sales + purchase ledgers)
// =====================================================================
//
// Mirrors the macro's generLED / generLEDGERD / generLEDGERP, plus emits
// the standard tax / sales / purchase ledgers configured in Settings →
// To Tally so a fresh Tally company can be primed with all the ledgers
// the voucher imports will reference. Without these ledgers in Tally,
// every voucher import will fail with "ledger not found".
//
// rows = [{ kind: 'party'|'tax'|'sales'|'purchase'|'group',
//           name, parent (group), gstin, pan, address, place, pin,
//           state, applicableFrom (yyyymmdd) }]
//
function generLedgerXML(rows, cfg, opts = {}) {
  const company = opts.companyName || cfgGet(cfg, 'tally_company_name', cfgGet(cfg, 'short_name', 'Ideal Spices Private Limited'));
  const today = toTallyDate(new Date());

  // Use "All Masters" reportname for ledger imports.
  // Target XMLs use CRLF line endings + UTF-8 BOM at start of file. We mirror
  // that here so the byte sequence matches what Tally has been importing
  // successfully from the macros. We build with \n then convert at the end.
  let xml = '\n' + startEnvelope(company, 'All Masters');

  for (const r of rows) {
    const name = xe(r.name || '');
    if (!name) continue;
    const parent = xe(r.parent || 'Sundry Debtors');
    const dateval = r.applicableFrom || today;
    // Always derive state from GSTIN if available (title-cased) so Tally
    // accepts the value. Fall back to the row's `state` only if no GSTIN.
    const stateRaw = (r.gstin ? findState(r.gstin) : r.state) || '';
    const state = xe(stateRaw);
    const gstin = xe(r.gstin || '');
    const pan = xe(r.pan || (r.gstin ? String(r.gstin).slice(2, 12) : ''));
    const address = xe(r.address || '');
    const place = xe(r.place || '');
    const pin = xe(r.pin || '');
    const isParty = r.kind === 'party';
    const hasGst = isParty && gstin;

    // Sub-kind hint from the builder so we know whether this party is sales,
    // RD, or URD. Falls back to a heuristic based on parent group name when
    // not provided (keeps backward compat with the all-in-one builder).
    let partyKind = r.partyKind || '';
    if (!partyKind && isParty) {
      const p = String(r.parent || '').toLowerCase();
      if (p.includes('agriculturist'))         partyKind = 'urd';
      else if (p.includes('dealer-purchase'))  partyKind = 'sales'; // sales-side
      else if (p.includes('dealer'))           partyKind = 'rd';    // RD purchase-side
    }
    const isRdParty  = isParty && partyKind === 'rd';
    const isUrdParty = isParty && partyKind === 'urd';

    // ── Build the LEDGER body in the exact order the target XMLs use ──
    // Order: CURRENCYNAME, PRIORSTATENAME, INCOMETAXNUMBER, [VATDEALERTYPE],
    //        PARENT, COUNTRYOFRESIDENCE, LEDGERCOUNTRYISDCODE,
    //        ISBILLWISEON, ASORIGINAL, ISCHEQUEPRINTINGENABLED,
    //        LANGUAGENAME.LIST, LEDGSTREGDETAILS.LIST, LEDMAILINGDETAILS.LIST.
    // The opening tag has just NAME="" — no top-level <NAME> child, no
    // RESERVEDNAME attribute (matches every sample we've seen).
    let block = `\n<LEDGER NAME="${name}">
<CURRENCYNAME>₹</CURRENCYNAME>`;

    if (isParty) {
      // For sales/RD parties we have state + PAN; for URD we still emit the
      // tags but leave them empty (the target URD XML uses empty tags here,
      // which is what Tally expects for unregistered parties).
      if (isUrdParty) {
        block += `
<PRIORSTATENAME></PRIORSTATENAME>
<INCOMETAXNUMBER></INCOMETAXNUMBER>`;
      } else {
        block += `
<PRIORSTATENAME>${state}</PRIORSTATENAME>
<INCOMETAXNUMBER>${pan}</INCOMETAXNUMBER>`;
      }
      // VATDEALERTYPE: only RD and URD purchase parties carry this (matches
      // the schema in RD_LEDGER_MASTER and URD_LEDGER_MASTER; SALE doesn't).
      if (isRdParty) {
        block += `\n<VATDEALERTYPE>Regular</VATDEALERTYPE>`;
      } else if (isUrdParty) {
        block += `\n<VATDEALERTYPE>Unregistered/Consumer</VATDEALERTYPE>`;
      }
    }

    block += `
<PARENT>${parent}</PARENT>
<COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>
<LEDGERCOUNTRYISDCODE>+91</LEDGERCOUNTRYISDCODE>`;

    if (isParty) {
      block += `
<ISBILLWISEON>Yes</ISBILLWISEON>
<ASORIGINAL>Yes</ASORIGINAL>
<ISCHEQUEPRINTINGENABLED>Yes</ISCHEQUEPRINTINGENABLED>`;
    }

    block += `
<LANGUAGENAME.LIST>
<NAME.LIST>
<NAME>${name}</NAME>
</NAME.LIST>
</LANGUAGENAME.LIST>`;

    // GST registration block.
    //   • Sales / RD party with GSTIN → full block with GSTIN
    //   • URD party (no GSTIN) → block without GSTIN, GSTREGISTRATIONTYPE = Unregistered/Consumer
    //   • Master ledgers (sales/purchase/tax) → no block
    if (isParty) {
      if (hasGst) {
        block += `
<LEDGSTREGDETAILS.LIST>
<APPLICABLEFROM>${dateval}</APPLICABLEFROM>
<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
<PLACEOFSUPPLY>${state}</PLACEOFSUPPLY>
<GSTIN>${gstin}</GSTIN>
</LEDGSTREGDETAILS.LIST>`;
      } else if (isUrdParty) {
        // URD parties still get the block, just without GSTIN
        const placeOfSupply = state || cfgGet(cfg, 'tally_urd_state', 'Kerala');
        block += `
<LEDGSTREGDETAILS.LIST>
<APPLICABLEFROM>${dateval}</APPLICABLEFROM>
<GSTREGISTRATIONTYPE>Unregistered/Consumer</GSTREGISTRATIONTYPE>
<PLACEOFSUPPLY>${xe(placeOfSupply)}</PLACEOFSUPPLY>
</LEDGSTREGDETAILS.LIST>`;
      }
    }

    if (isParty && (address || place || pin)) {
      // For URD where state is unknown, fall back to the configured URD state
      const mailingState = state || (isUrdParty ? xe(cfgGet(cfg, 'tally_urd_state', 'Kerala')) : '');
      block += `
<LEDMAILINGDETAILS.LIST>
<ADDRESS.LIST>
<ADDRESS>${address}</ADDRESS>
<ADDRESS>${place}</ADDRESS>
</ADDRESS.LIST>
<APPLICABLEFROM>${dateval}</APPLICABLEFROM>
<PINCODE>${pin}</PINCODE>
<MAILINGNAME>${name}</MAILINGNAME>
<STATE>${mailingState}</STATE>
<COUNTRY>India</COUNTRY>
</LEDMAILINGDETAILS.LIST>`;
    }

    // Tax ledgers: tag with the right rate-of-tax info (only used by the
    // all-in-one ledger export; the 3 party-only exports never include
    // these).
    if (r.kind === 'tax') {
      const rateOfTax = Number(r.rateOfTax || 0);
      const dutyHead = r.dutyHead || 'GST';
      block += `
<TAXTYPE>GST</TAXTYPE>
<GSTDUTYHEAD>${xe(dutyHead)}</GSTDUTYHEAD>
<RATEOFTAXCALCULATION>${rateOfTax}</RATEOFTAXCALCULATION>`;
    }

    // Sales/Purchase master ledgers: rounding + taxability + HSN
    if (r.kind === 'sales' || r.kind === 'purchase') {
      block += `
<ROUNDINGMETHOD>Normal Rounding</ROUNDINGMETHOD>
<ROUNDINGLIMIT>1</ROUNDINGLIMIT>
<GSTOVRDNTAXABILITY>${xe(r.taxability || 'Taxable')}</GSTOVRDNTAXABILITY>`;
      if (r.hsn) {
        block += `
<HSNCODE>${xe(r.hsn)}</HSNCODE>`;
      }
    }

    block += '\n</LEDGER>';
    xml += block;
  }

  xml += '\n' + endEnvelope();

  // Convert to CRLF line endings + prepend UTF-8 BOM so the byte sequence
  // matches what Tally has been importing successfully from the macros.
  const BOM = '\uFEFF';
  return BOM + xml.replace(/\r?\n/g, '\r\n');
}

// ── Helpers shared by the 3 ledger builders ─────────────────
// Each builder returns rows in the same { kind, name, parent, gstin, ... }
// shape that generLedgerXML already consumes — only the source-of-data
// and the parent group differ.

function _buyerRow(b, todayDate, intra, interDealer, localDealer) {
  const isIntra = String(b.gstin || '').slice(0, 2) === String(intra);
  return {
    kind: 'party',
    partyKind: 'sales',
    name: b.buyer1 || b.buyer || '',
    parent: isIntra ? localDealer : interDealer,
    gstin: b.gstin || '',
    pan: b.pan || '',
    address: [b.add1, b.add2].filter(Boolean).join(', '),
    place: b.pla || '',
    pin: b.pin || '',
    state: b.state || '',
    applicableFrom: todayDate,
  };
}

function _rdTraderRow(t, todayDate, intra, interDealPur, localDealPur) {
  // `cr` carries the GSTIN with a "GSTIN." prefix for registered dealers
  const fullGstin = String(t.cr || '');
  const partyGstin = fullGstin.toUpperCase().startsWith('GST') ? fullGstin.slice(6, 21) : fullGstin;
  const isIntra = String(partyGstin).slice(0, 2) === String(intra);
  return {
    kind: 'party',
    partyKind: 'rd',
    name: t.name || '',
    parent: isIntra ? localDealPur : interDealPur,
    gstin: partyGstin,
    pan: t.pan || '',
    address: t.padd || '',
    place: t.ppla || '',
    pin: t.ppin || '',
    state: t.pstate || '',
    applicableFrom: todayDate,
  };
}

function _urdTraderRow(t, todayDate, auctionLDR) {
  return {
    kind: 'party',
    partyKind: 'urd',
    name: t.name || '',
    parent: auctionLDR,           // Agriculturists go under the auction-purchase parent
    gstin: '',
    pan: t.pan || '',
    address: t.padd || '',
    place: t.ppla || '',
    pin: t.ppin || '',
    state: t.pstate || '',
    applicableFrom: todayDate,
  };
}

/**
 * Build sales-party ledger rows (mirrors generLED).
 * One row per distinct buyer that appears in this auction's invoices.
 * Filter: optional `partyName` to limit output to a single buyer.
 */
function buildSalesPartyLedgerRows(db, auctionId, cfg, opts = {}) {
  const todayDate = toTallyDate(new Date());
  const intra = cfgGet(cfg, 'tally_state_code', '33');
  const interDealer = cfgGet(cfg, 'tally_dealer_sale_inter', 'Interstate Dealer-Purchase');
  const localDealer = cfgGet(cfg, 'tally_dealer_sale_intra', 'Local Dealer-Purchase');

  let sql = `
    SELECT DISTINCT b.*
    FROM invoices i
    JOIN buyers b ON b.buyer = i.buyer
    WHERE i.auction_id = ?
  `;
  const params = [auctionId];
  if (opts.partyName) {
    sql += ` AND (b.buyer1 = ? OR b.buyer = ?)`;
    params.push(opts.partyName, opts.partyName);
  }
  sql += ` ORDER BY b.buyer1`;

  const buyers = db.prepare(sql).all(...params);
  return buyers.map(b => _buyerRow(b, todayDate, intra, interDealer, localDealer));
}

/**
 * Build RD-purchase party ledger rows (mirrors generLEDGERD).
 * One row per distinct trader with `cr LIKE 'GSTIN.%'` in the auction's lots.
 */
function buildRDPartyLedgerRows(db, auctionId, cfg, opts = {}) {
  const todayDate = toTallyDate(new Date());
  // RD party ledgers belong in the ASP Tally company. The intra/local
  // determination must therefore use the ASP company's home GSTIN state
  // code (defaults to 32 = Kerala), not the ISP code (33 = Tamil Nadu).
  // Falls back to the ISP code if the ASP one isn't configured, so existing
  // setups without a separate ASP code keep working.
  const intra = cfgGet(cfg, 'tally_state_code_amazing', '') || cfgGet(cfg, 'tally_state_code', '33');
  const interDealPur = cfgGet(cfg, 'tally_purchase_dealer_inter', 'Interstate Dealer');
  const localDealPur = cfgGet(cfg, 'tally_purchase_dealer_intra', 'Local Dealer');

  let sql = `
    SELECT DISTINCT name, padd, ppla, ppin, pstate, cr, pan
    FROM lots
    WHERE auction_id = ? AND UPPER(cr) LIKE 'GSTIN.%'
  `;
  const params = [auctionId];
  if (opts.partyName) {
    sql += ` AND name = ?`;
    params.push(opts.partyName);
  }
  sql += ` ORDER BY name`;

  const traders = db.prepare(sql).all(...params);
  return traders.map(t => _rdTraderRow(t, todayDate, intra, interDealPur, localDealPur));
}

/**
 * Build URD-purchase party ledger rows (mirrors generLEDGERP).
 * One row per distinct agriculturist (no GSTIN) in the auction's lots.
 */
function buildURDPartyLedgerRows(db, auctionId, cfg, opts = {}) {
  const todayDate = toTallyDate(new Date());
  const auctionLDR = cfgGet(cfg, 'tally_purchase_auction', 'Purchase From Agriculturist');

  let sql = `
    SELECT DISTINCT name, padd, ppla, ppin, pstate, pan
    FROM lots
    WHERE auction_id = ? AND (cr = '' OR cr IS NULL OR UPPER(cr) NOT LIKE 'GSTIN.%')
      AND name != ''
  `;
  const params = [auctionId];
  if (opts.partyName) {
    sql += ` AND name = ?`;
    params.push(opts.partyName);
  }
  sql += ` ORDER BY name`;

  const traders = db.prepare(sql).all(...params);
  return traders.map(t => _urdTraderRow(t, todayDate, auctionLDR));
}

/**
 * List every party in an auction with the kind it would be exported as.
 * Powers the "single-party" picker UI on the To Tally page so dad can
 * pick exactly one and emit just that ledger.
 *
 * Returns: [{ kind: 'sales'|'rd_purchase'|'urd_purchase', name, gstin }]
 */
function listAuctionParties(db, auctionId) {
  const out = [];

  // Sales parties — buyers
  const buyers = db.prepare(`
    SELECT DISTINCT b.buyer1 AS name, b.gstin, b.pla AS place
    FROM invoices i
    JOIN buyers b ON b.buyer = i.buyer
    WHERE i.auction_id = ?
    ORDER BY b.buyer1
  `).all(auctionId);
  for (const b of buyers) {
    out.push({ kind: 'sales', name: b.name || '', gstin: b.gstin || '', place: b.place || '' });
  }

  // RD purchase parties — traders with GSTIN in lots
  const rd = db.prepare(`
    SELECT DISTINCT name, ppla AS place, cr
    FROM lots
    WHERE auction_id = ? AND UPPER(cr) LIKE 'GSTIN.%' AND name != ''
    ORDER BY name
  `).all(auctionId);
  for (const t of rd) {
    const fullGstin = String(t.cr || '');
    const gstin = fullGstin.toUpperCase().startsWith('GST') ? fullGstin.slice(6, 21) : fullGstin;
    out.push({ kind: 'rd_purchase', name: t.name || '', gstin, place: t.place || '' });
  }

  // URD purchase parties — agriculturists
  const urd = db.prepare(`
    SELECT DISTINCT name, ppla AS place
    FROM lots
    WHERE auction_id = ? AND (cr = '' OR cr IS NULL OR UPPER(cr) NOT LIKE 'GSTIN.%') AND name != ''
    ORDER BY name
  `).all(auctionId);
  for (const t of urd) {
    out.push({ kind: 'urd_purchase', name: t.name || '', gstin: '', place: t.place || '' });
  }

  return out;
}

/**
 * Backwards-compatible "all ledgers in one shot" builder.
 * Combines the 3 party builders + the master ledgers (sales/purchase/tax/
 * service) seeded from cfg. Useful for a one-click "prime a fresh Tally
 * company" workflow.
 */
function buildLedgerRows(db, auctionId, cfg) {
  const rows = [
    ...buildSalesPartyLedgerRows(db, auctionId, cfg),
    ...buildRDPartyLedgerRows(db, auctionId, cfg),
    ...buildURDPartyLedgerRows(db, auctionId, cfg),
  ];
  const todayDate = toTallyDate(new Date());

  // ── Master ledgers from cfg (sales / purchase / tax / service) ─
  const gstRate = cfgNum(cfg, 'tally_gst_rate', 5);
  const dnRate  = cfgNum(cfg, 'tally_dn_gst_rate', 18);
  const hsnCard = cfgGet(cfg, 'tally_hsn_cardamom', '09083120');
  const hsnService = cfgGet(cfg, 'tally_hsn_service', '996111');

  for (const [k, parent, taxability, hsn] of [
    ['tally_sales_inter',   'Sales Accounts',  'Taxable',   hsnCard],
    ['tally_sales_intra',   'Sales Accounts',  'Taxable',   hsnCard],
    ['tally_sales_export',  'Sales Accounts',  'Exempt',    hsnCard],
    ['tally_gunny_inter',   'Sales Accounts',  'Taxable',   cfgGet(cfg, 'tally_hsn_gunny', '63051040')],
    ['tally_gunny_intra',   'Sales Accounts',  'Taxable',   cfgGet(cfg, 'tally_hsn_gunny', '63051040')],
    ['tally_gunny_export',  'Sales Accounts',  'Exempt',    cfgGet(cfg, 'tally_hsn_gunny', '63051040')],
  ]) {
    const name = cfgGet(cfg, k, '');
    if (name) rows.push({ kind: 'sales', name, parent, taxability, hsn, applicableFrom: todayDate });
  }

  const purBase = cfgGet(cfg, 'tally_purchase_dealer', 'Trade Purchase from Dealer');
  if (purBase) {
    rows.push({ kind: 'purchase', name: `${purBase}-Local`,       parent: 'Purchase Accounts', taxability: 'Taxable', hsn: hsnCard, applicableFrom: todayDate });
    rows.push({ kind: 'purchase', name: `${purBase}-Inter_State`, parent: 'Purchase Accounts', taxability: 'Taxable', hsn: hsnCard, applicableFrom: todayDate });
  }
  const auctionLDRname = cfgGet(cfg, 'tally_purchase_auction', '');
  if (auctionLDRname) rows.push({ kind: 'purchase', name: auctionLDRname, parent: 'Purchase Accounts', taxability: 'Nil Rated', hsn: hsnCard, applicableFrom: todayDate });

  const tax = (key, dutyHead, rate) => {
    const name = cfgGet(cfg, key, '');
    if (name) rows.push({ kind: 'tax', name, parent: 'Duties & Taxes', dutyHead, rateOfTax: rate, applicableFrom: todayDate });
  };
  tax('tally_cgst',        'CGST', gstRate / 2);
  tax('tally_sgst',        'SGST/UTGST', gstRate / 2);
  tax('tally_igst',        'IGST', gstRate);
  tax('tally_cgst_input',  'CGST', gstRate / 2);
  tax('tally_sgst_input',  'SGST/UTGST', gstRate / 2);
  tax('tally_igst_input',  'IGST', gstRate);
  tax('tally_dn_cgst',     'CGST', dnRate / 2);
  tax('tally_dn_sgst',     'SGST/UTGST', dnRate / 2);
  tax('tally_dn_igst',     'IGST', dnRate);
  tax('tally_tcs',         'TCS',  cfgNum(cfg, 'tally_tcs_rate', 0.1));
  tax('tally_tds_ledger',  'TDS',  cfgNum(cfg, 'tally_tcs_rate', 0.1));

  const services = [
    ['tally_dn_discount',          'Indirect Incomes',   hsnService],
    ['tally_commission',           'Indirect Expenses',  hsnService],
    ['tally_cash_handling',        'Indirect Expenses',  hsnService],
    ['tally_cash_handling_planter','Indirect Expenses',  hsnService],
    ['tally_chc_planter',          'Indirect Expenses',  hsnService],
    ['tally_sample_planter',       'Indirect Expenses',  hsnService],
    ['tally_sample_dealer',        'Indirect Expenses',  hsnService],
    ['tally_transport',            'Indirect Expenses',  cfgGet(cfg, 'tally_hsn_transport', '996791')],
    ['tally_insurance',            'Indirect Expenses',  cfgGet(cfg, 'tally_hsn_insurance', '997136')],
    ['tally_round',                'Indirect Expenses',  ''],
    ['tally_tds_paid_sales',       'Duties & Taxes',     ''],
  ];
  for (const [k, parent, hsn] of services) {
    const name = cfgGet(cfg, k, '');
    if (name) rows.push({ kind: 'sales', name, parent, taxability: 'Taxable', hsn, applicableFrom: todayDate });
  }

  return rows;
}

module.exports = {
  generSalesXML,
  generRDPurchaseXML,
  generURDPurchaseXML,
  generDebitNoteXML,
  generLedgerXML,
  buildSalesRows,
  buildRDPurchaseRows,
  buildURDPurchaseRows,
  buildDebitNoteRows,
  buildLedgerRows,
  buildSalesPartyLedgerRows,
  buildRDPartyLedgerRows,
  buildURDPartyLedgerRows,
  listAuctionParties,
  // helpers (exported for tests)
  toTallyDate,
  findState,
};

'use strict';

/**
 * Import Format Mapper for IntelliMatch FIS.
 *
 * Transforms generated raw ledger/statement records into the specific field
 * schemas that IntelliMatch expects for each import template type.
 *
 * This runs AFTER scenario generation and BEFORE the file formatter,
 * so every file format (CSV, Excel, MT940, etc.) automatically gets
 * the correct field layout.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  LEDGER import formats                                          │
 * │    GL         — General Ledger (default internal ledger)        │
 * │    AP         — Accounts Payable (invoice/vendor payments)      │
 * │    AR         — Accounts Receivable (customer receipts)         │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  STATEMENT import formats                                       │
 * │    BANK       — Bank Statement (default bank transactions)      │
 * │    BROKERAGE  — Brokerage Statement (securities transactions)   │
 * │    CUSTODIAN  — Custodian Statement (asset custody)             │
 * └─────────────────────────────────────────────────────────────────┘
 */

const { randInt, randFrom, randomRef, randomBankName } = require('../utils/randomizer');

// ── Reference data pools ─────────────────────────────────────────────────────

const COST_CENTERS = ['CC-1000', 'CC-1100', 'CC-2000', 'CC-2100', 'CC-3000', 'CC-3100', 'CC-4000', 'CC-5000'];
const DOCUMENT_TYPES = ['ZP', 'SA', 'KR', 'DR', 'RE', 'AB', 'WA', 'ZA', 'KZ', 'DZ'];
const COMPANY_CODES  = ['1000', '2000', '3000', 'USCO', 'GBCO', 'DECO', 'AUCO', 'FRCO'];
const VENDOR_PREFIXES = ['VND', 'SUP', 'VEN'];
const CUSTOMER_PREFIXES = ['CUS', 'CLI', 'ACC'];
const VENDOR_NAMES   = [
  'Apex Supplies Ltd', 'Blue Ridge Corp', 'Cardinal Services Inc', 'Delta Systems',
  'Echo Networks', 'Fusion Tech LLC', 'Global Parts Co', 'Horizon Goods',
  'Infinity Materials', 'Junction Trade', 'Kinetic Resources', 'Lumina Exports',
  'Metro Fabrications', 'Nova Components', 'Orbit Industries', 'Pacific Traders'
];
const CUSTOMER_NAMES = [
  'Alpha Retail Group', 'Beta Commerce Ltd', 'Cascade Consumer Corp', 'Dawn Merchants',
  'Elysian Buyers Inc', 'Forte Trading', 'Gala Distributors', 'Harbor Clients',
  'Island Ventures', 'Jade Holdings', 'Kestrel Buyers', 'Lyric Retail',
  'Marble Importers', 'Nexus Consumers', 'Orion Procurement', 'Pinnacle Group'
];
const SECURITY_TYPES = [
  { id: 'AAPL.US',  isin: 'US0378331005', name: 'Apple Inc',             type: 'Equity' },
  { id: 'MSFT.US',  isin: 'US5949181045', name: 'Microsoft Corp',        type: 'Equity' },
  { id: 'AMZN.US',  isin: 'US0231351067', name: 'Amazon.com Inc',        type: 'Equity' },
  { id: 'TSLA.US',  isin: 'US88160R1014', name: 'Tesla Inc',             type: 'Equity' },
  { id: 'GOOGL.US', isin: 'US02079K3059', name: 'Alphabet Inc',          type: 'Equity' },
  { id: 'UST10Y',   isin: 'US912828ZT66', name: 'US Treasury 10Y 2.5%',  type: 'Bond'   },
  { id: 'UST05Y',   isin: 'US912828WJ58', name: 'US Treasury 5Y 1.75%',  type: 'Bond'   },
  { id: 'CORP01',   isin: 'XS2305523467', name: 'Corp Bond AAA 3.5%',    type: 'Bond'   },
  { id: 'EURIBOR',  isin: 'XS1234567890', name: 'EURIBOR FRN 2026',      type: 'Bond'   },
  { id: 'SPDR500',  isin: 'US78462F1030', name: 'SPDR S&P 500 ETF',      type: 'ETF'    },
  { id: 'XGLD',     isin: 'DE000A0S9GB0', name: 'Xetra-Gold ETC',        type: 'ETC'    },
  { id: 'FX-EURUSD',isin: 'N/A',          name: 'EUR/USD FX Forward',     type: 'FX'     }
];
const ASSET_CLASSES  = ['Equity', 'Fixed Income', 'Cash & Equivalents', 'FX', 'Derivatives', 'Commodities', 'Real Estate'];
const SUB_ACCOUNTS   = ['MAIN', 'COLLATERAL', 'INCOME', 'CAPITAL', 'MARGIN', 'RESERVE'];
const TXN_TYPES      = ['BUY', 'SELL', 'DIV', 'INT', 'FEE', 'CORP', 'TRIN', 'TROUT', 'SETL', 'MARG'];
const AP_STATUSES    = ['PAID', 'PARTIAL', 'OPEN', 'OVERDUE', 'DISPUTED'];
const AR_STATUSES    = ['COLLECTED', 'PARTIAL', 'OPEN', 'OVERDUE', 'WRITEOFF'];

// ── Utility helpers ──────────────────────────────────────────────────────────

function fiscalYear(dateStr) { return new Date(dateStr).getFullYear().toString(); }
function fiscalPeriod(dateStr) { return String(new Date(dateStr).getMonth() + 1).padStart(2, '0'); }
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function randomVendorId()   { return `${randFrom(VENDOR_PREFIXES)}${randInt(10000, 99999)}`; }
function randomCustomerId() { return `${randFrom(CUSTOMER_PREFIXES)}${randInt(10000, 99999)}`; }

// ── Ledger mappers ───────────────────────────────────────────────────────────

/**
 * GL — General Ledger import format.
 * Fields align with SAP GL / Oracle GL / standard ERP general ledger imports.
 */
function toLedgerGL(rec) {
  const netAmt = parseFloat(rec.CreditAmount) - parseFloat(rec.DebitAmount);
  return {
    TxnID:          rec.TxnID,
    GLAccount:      rec.LedgerAccount,
    CostCenter:     randFrom(COST_CENTERS),
    TxnDate:        rec.TransactionDate,
    PostDate:       rec.PostingDate,
    FiscalYear:     fiscalYear(rec.TransactionDate),
    Period:         fiscalPeriod(rec.TransactionDate),
    Currency:       rec.Currency,
    DebitAmount:    rec.DebitAmount,
    CreditAmount:   rec.CreditAmount,
    NetAmount:      netAmt.toFixed(2),
    DocumentType:   randFrom(DOCUMENT_TYPES),
    CompanyCode:    randFrom(COMPANY_CODES),
    Description:    rec.Description,
    Reference:      rec.ReferenceNumber,
    MatchType:      rec.MatchType
  };
}

/**
 * AP — Accounts Payable import format.
 * Represents vendor invoices and outgoing payment records.
 */
function toLedgerAP(rec) {
  const invoiceAmt   = parseFloat(rec.DebitAmount) || parseFloat(rec.CreditAmount);
  const paidAmt      = rec.MatchType === 'unmatchedLedger'
    ? 0
    : Math.round(invoiceAmt * (Math.random() > 0.2 ? 1 : (0.5 + Math.random() * 0.5)) * 100) / 100;
  const outstanding  = Math.round((invoiceAmt - paidAmt) * 100) / 100;
  const dueDate      = addDays(rec.TransactionDate, randInt(30, 90));
  const status       = outstanding === 0 ? 'PAID' : outstanding === invoiceAmt ? 'OPEN' : 'PARTIAL';

  return {
    InvoiceID:          rec.TxnID.replace('LDG', 'INV'),
    VendorID:           randomVendorId(),
    VendorName:         randFrom(VENDOR_NAMES),
    InvoiceDate:        rec.TransactionDate,
    DueDate:            dueDate,
    PostDate:           rec.PostingDate,
    Currency:           rec.Currency,
    InvoiceAmount:      invoiceAmt.toFixed(2),
    PaidAmount:         paidAmt.toFixed(2),
    OutstandingAmount:  outstanding.toFixed(2),
    PaymentReference:   rec.ReferenceNumber,
    GLAccount:          rec.LedgerAccount,
    CostCenter:         randFrom(COST_CENTERS),
    DocumentType:       randFrom(['KR', 'RE', 'KZ']),
    Description:        rec.Description,
    MatchType:          rec.MatchType
  };
}

/**
 * AR — Accounts Receivable import format.
 * Represents customer invoices and incoming payment records.
 */
function toLedgerAR(rec) {
  const invoiceAmt  = parseFloat(rec.CreditAmount) || parseFloat(rec.DebitAmount);
  const receivedAmt = rec.MatchType === 'unmatchedLedger'
    ? 0
    : Math.round(invoiceAmt * (Math.random() > 0.2 ? 1 : (0.5 + Math.random() * 0.5)) * 100) / 100;
  const outstanding = Math.round((invoiceAmt - receivedAmt) * 100) / 100;
  const dueDate     = addDays(rec.TransactionDate, randInt(30, 60));
  const status      = outstanding === 0 ? 'COLLECTED' : outstanding === invoiceAmt ? 'OPEN' : 'PARTIAL';

  return {
    InvoiceID:          rec.TxnID.replace('LDG', 'INV'),
    CustomerID:         randomCustomerId(),
    CustomerName:       randFrom(CUSTOMER_NAMES),
    InvoiceDate:        rec.TransactionDate,
    DueDate:            dueDate,
    PostDate:           rec.PostingDate,
    Currency:           rec.Currency,
    InvoiceAmount:      invoiceAmt.toFixed(2),
    ReceivedAmount:     receivedAmt.toFixed(2),
    OutstandingAmount:  outstanding.toFixed(2),
    PaymentReference:   rec.ReferenceNumber,
    GLAccount:          rec.LedgerAccount,
    DocumentType:       randFrom(['DR', 'DZ', 'ZP']),
    Description:        rec.Description,
    MatchType:          rec.MatchType
  };
}

// ── Statement mappers ────────────────────────────────────────────────────────

/**
 * BANK — Bank Statement import format.
 * Standard bank statement with IBAN, bank name, and remittance fields.
 */
function toStatementBANK(rec) {
  return {
    StatementID:          rec.StatementID,
    BankAccount:          rec.BankAccountNumber,
    IBAN:                 rec.BankAccountNumber,
    BankName:             randomBankName(),
    TxnDate:              rec.TransactionDate,
    ValueDate:            rec.ValueDate,
    Currency:             rec.Currency,
    Amount:               rec.Amount,
    DebitCreditIndicator: rec.DebitCreditIndicator,
    Description:          rec.Description,
    BankReference:        rec.BankReference,
    EndToEndRef:          rec.ReferenceNumber,
    RemittanceInfo:       rec.Description,
    MatchType:            rec.MatchType
  };
}

/**
 * BROKERAGE — Brokerage Statement import format.
 * Used for securities trading accounts (equities, bonds, ETFs, FX).
 */
function toStatementBROKERAGE(rec) {
  const security   = randFrom(SECURITY_TYPES);
  const amount     = parseFloat(rec.Amount);
  const price      = Math.round((10 + Math.random() * 4990) * 100) / 100;
  const quantity   = Math.round((amount / price) * 10000) / 10000;
  const fees       = Math.round(amount * (0.001 + Math.random() * 0.004) * 100) / 100;
  const netAmount  = rec.DebitCreditIndicator === 'C'
    ? Math.round((amount - fees) * 100) / 100
    : Math.round((amount + fees) * 100) / 100;
  const txnType    = randFrom(TXN_TYPES);
  const settleDate = addDays(rec.ValueDate, randInt(1, 3));

  return {
    StatementID:     rec.StatementID,
    AccountNumber:   rec.BankAccountNumber,
    SecurityID:      security.id,
    ISIN:            security.isin,
    SecurityName:    security.name,
    TxnDate:         rec.TransactionDate,
    SettleDate:      settleDate,
    TxnType:         txnType,
    Quantity:        quantity.toFixed(4),
    Price:           price.toFixed(4),
    Currency:        rec.Currency,
    GrossAmount:     amount.toFixed(2),
    Fees:            fees.toFixed(2),
    NetAmount:       netAmount.toFixed(2),
    Reference:       rec.ReferenceNumber,
    Description:     rec.Description,
    MatchType:       rec.MatchType
  };
}

/**
 * CUSTODIAN — Custodian Statement import format.
 * Used for asset custody accounts (fund administration, safekeeping).
 */
function toStatementCUSTODIAN(rec) {
  const security      = randFrom(SECURITY_TYPES);
  const amount        = parseFloat(rec.Amount);
  const accrued       = Math.round(amount * (0.005 + Math.random() * 0.02) * 100) / 100;
  const netAmount     = Math.round((amount + accrued) * 100) / 100;
  const settleDate    = addDays(rec.ValueDate, randInt(1, 5));

  return {
    StatementID:       rec.StatementID,
    CustodianAccount:  rec.BankAccountNumber,
    SubAccount:        randFrom(SUB_ACCOUNTS),
    AssetClass:        randFrom(ASSET_CLASSES),
    SecurityID:        security.id,
    SecurityName:      security.name,
    ISIN:              security.isin,
    TxnDate:           rec.TransactionDate,
    SettleDate:        settleDate,
    Currency:          rec.Currency,
    MarketValue:       amount.toFixed(2),
    AccruedInterest:   accrued.toFixed(2),
    NetAmount:         netAmount.toFixed(2),
    Reference:         rec.ReferenceNumber,
    Narrative:         rec.Description,
    MatchType:         rec.MatchType
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/** All valid import format names */
const VALID_IMPORT_FORMATS = {
  ledger:    ['GL', 'AP', 'AR'],
  statement: ['BANK', 'BROKERAGE', 'CUSTODIAN']
};

/** All valid names in one flat list for validation */
const ALL_IMPORT_FORMATS = [
  ...VALID_IMPORT_FORMATS.ledger,
  ...VALID_IMPORT_FORMATS.statement
];

/**
 * Applies the import format transformation to an array of ledger records.
 *
 * @param {object[]} records     - raw ledger records from ledgerGenerator
 * @param {string}   importFmt   - 'GL' | 'AP' | 'AR'
 * @returns {object[]}
 */
function applyLedgerImportFormat(records, importFmt) {
  switch (importFmt.toUpperCase()) {
    case 'GL': return records.map(toLedgerGL);
    case 'AP': return records.map(toLedgerAP);
    case 'AR': return records.map(toLedgerAR);
    default:   return records;  // passthrough for unknown — already validated upstream
  }
}

/**
 * Applies the import format transformation to an array of statement records.
 *
 * @param {object[]} records     - raw statement records from statementGenerator
 * @param {string}   importFmt   - 'BANK' | 'BROKERAGE' | 'CUSTODIAN'
 * @returns {object[]}
 */
function applyStatementImportFormat(records, importFmt) {
  switch (importFmt.toUpperCase()) {
    case 'BANK':      return records.map(toStatementBANK);
    case 'BROKERAGE': return records.map(toStatementBROKERAGE);
    case 'CUSTODIAN': return records.map(toStatementCUSTODIAN);
    default:          return records;
  }
}

/**
 * Returns a human-readable description for a given import format code.
 */
function describeImportFormat(fmt) {
  const map = {
    GL:        'General Ledger (ERP GL journal entries)',
    AP:        'Accounts Payable (vendor invoices & payments)',
    AR:        'Accounts Receivable (customer invoices & receipts)',
    BANK:      'Bank Statement (standard cash transactions)',
    BROKERAGE: 'Brokerage Statement (securities trading)',
    CUSTODIAN: 'Custodian Statement (asset custody & safekeeping)'
  };
  return map[fmt.toUpperCase()] || fmt;
}

module.exports = {
  applyLedgerImportFormat,
  applyStatementImportFormat,
  VALID_IMPORT_FORMATS,
  ALL_IMPORT_FORMATS,
  describeImportFormat
};

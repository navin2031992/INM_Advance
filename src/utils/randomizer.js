'use strict';

/**
 * Randomizer utility for IntelliMatch data generation.
 * Provides deterministic-ish but varied random data for financial transactions.
 */

const DESCRIPTIONS_CREDIT = [
  'Customer payment received', 'Wire transfer inbound', 'ACH credit settlement',
  'Invoice payment INV', 'Dividend income', 'Interest credit', 'Refund received',
  'SEPA credit transfer', 'Payroll funding', 'Intercompany transfer in',
  'Trade settlement receipt', 'Bond coupon payment', 'Deposit received',
  'Commission income', 'Grant proceeds', 'Sales proceeds', 'Loan drawdown',
  'FX contract settlement', 'Equity sale proceeds', 'Customer advance payment'
];

const DESCRIPTIONS_DEBIT = [
  'Supplier payment', 'Wire transfer outbound', 'ACH debit settlement',
  'Invoice payment to vendor', 'Tax remittance', 'Interest expense',
  'SEPA direct debit', 'Payroll disbursement', 'Intercompany transfer out',
  'Trade settlement payment', 'Bond redemption', 'Cheque payment',
  'Commission expense', 'Utility payment', 'Rent payment', 'Loan repayment',
  'FX contract payment', 'Equipment purchase', 'Service fee payment',
  'Insurance premium payment'
];

const BANK_NAMES = [
  'HSBC', 'Barclays', 'Deutsche Bank', 'BNP Paribas', 'Citibank',
  'JP Morgan', 'Wells Fargo', 'Bank of America', 'ANZ', 'Westpac',
  'Standard Chartered', 'UBS', 'Credit Suisse', 'Societe Generale', 'ING'
];

const SWIFT_CODES = [
  'HSBCGB2L', 'BARCGB22', 'DEUTDEDB', 'BNPAFRPP', 'CITIUS33',
  'CHASUS33', 'WFBIUS6S', 'BOFAUS3N', 'ANZBAU3M', 'WPACAU2S'
];

const COUNTERPARTY_NAMES = [
  'Acme Corp', 'Global Trade Ltd', 'Tech Solutions Inc', 'Alpha Finance',
  'Beta Investments', 'Gamma Holdings', 'Delta Manufacturing', 'Epsilon Services',
  'Zeta Logistics', 'Eta Consulting', 'Theta Capital', 'Iota Partners',
  'Kappa Group', 'Lambda Ventures', 'Mu Technologies', 'Nu Enterprises',
  'Xi Analytics', 'Omicron Systems', 'Pi Solutions', 'Rho Trading'
];

/**
 * Returns a random integer between min and max (inclusive).
 */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Returns a random element from an array.
 */
function randFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generates a random date between start and end date strings (YYYY-MM-DD).
 */
function randomDate(startStr, endStr) {
  const start = new Date(startStr);
  const end = new Date(endStr);
  const diff = end.getTime() - start.getTime();
  return new Date(start.getTime() + Math.random() * diff);
}

/**
 * Formats a Date object as YYYY-MM-DD string.
 */
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Formats a Date object as YYMMDD (SWIFT format).
 */
function formatDateSwift(date) {
  const y = String(date.getFullYear()).slice(2);
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Formats a Date as YYYYMMDD.
 */
function formatDateCompact(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Formats a Date as ISO 8601 datetime.
 */
function formatDateTimeISO(date) {
  return date.toISOString().replace('Z', '+00:00');
}

/**
 * Adds n business days to a date (skips weekends).
 */
function addBusinessDays(date, n) {
  const result = new Date(date);
  let added = 0;
  while (added < n) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return result;
}

/**
 * Generates a random amount between min and max with 2 decimal places.
 */
function randomAmount(min, max) {
  const raw = min + Math.random() * (max - min);
  return Math.round(raw * 100) / 100;
}

/**
 * Slightly modifies an amount to simulate a difference (±0.01 to ±5%).
 */
function slightAmountDiff(amount) {
  const pct = (Math.random() * 0.05 + 0.001);
  const delta = Math.round(amount * pct * 100) / 100;
  return Math.random() > 0.5 ? amount + delta : amount - delta;
}

/**
 * Generates a unique transaction ID with given prefix and zero-padded index.
 */
function txnId(prefix, index) {
  return `${prefix}${String(index).padStart(8, '0')}`;
}

/**
 * Generates a random reference number.
 */
function randomRef(prefix) {
  const n = randInt(10000000, 99999999);
  return `${prefix}${n}`;
}

/**
 * Generates a bank reference number.
 */
function randomBankRef() {
  return `BNK${randInt(100000000, 999999999)}`;
}

/**
 * Returns a random credit description.
 */
function randomCreditDescription() {
  const base = randFrom(DESCRIPTIONS_CREDIT);
  if (base.endsWith('INV')) return `${base}-${randInt(1000, 9999)}`;
  return base;
}

/**
 * Returns a random debit description.
 */
function randomDebitDescription() {
  return randFrom(DESCRIPTIONS_DEBIT);
}

/**
 * Returns a description for a given D/C indicator.
 */
function randomDescription(indicator) {
  return indicator === 'C' ? randomCreditDescription() : randomDebitDescription();
}

/**
 * Formats amount as SWIFT MT value (comma as decimal separator, no leading zeros beyond thousands).
 */
function formatAmountSwift(amount) {
  const [intPart, decPart] = amount.toFixed(2).split('.');
  return `${intPart},${decPart}`;
}

/**
 * Formats amount for BAI2 (integer, in cents).
 */
function formatAmountBAI2(amount) {
  return Math.round(amount * 100).toString();
}

/**
 * Reformats an ISO date string (YYYY-MM-DD) to the specified display format.
 * Supported formats: YYYY-MM-DD (default), DDMMYYYY, YYYYMMDD, DD/MM/YYYY, MM/DD/YYYY
 */
function reformatDate(isoStr, format) {
  if (!isoStr || !format || format === 'YYYY-MM-DD') return isoStr;
  const parts = isoStr.split('-');
  if (parts.length !== 3) return isoStr;
  const [yyyy, mm, dd] = parts;
  switch (format) {
    case 'DDMMYYYY':   return `${dd}${mm}${yyyy}`;
    case 'YYYYMMDD':   return `${yyyy}${mm}${dd}`;
    case 'DD/MM/YYYY': return `${dd}/${mm}/${yyyy}`;
    case 'MM/DD/YYYY': return `${mm}/${dd}/${yyyy}`;
    default:           return isoStr;
  }
}

/**
 * Pads a string to fixed width (left-aligned).
 */
function padRight(str, len, char = ' ') {
  return String(str).substring(0, len).padEnd(len, char);
}

/**
 * Pads a number string to fixed width (right-aligned).
 */
function padLeft(str, len, char = ' ') {
  return String(str).substring(0, len).padStart(len, char);
}

/**
 * Returns a random SWIFT BIC code.
 */
function randomSwiftBic() {
  return randFrom(SWIFT_CODES);
}

/**
 * Returns a random bank name.
 */
function randomBankName() {
  return randFrom(BANK_NAMES);
}

/**
 * Returns a random counterparty name.
 */
function randomCounterparty() {
  return randFrom(COUNTERPARTY_NAMES);
}

module.exports = {
  randInt,
  randFrom,
  randomDate,
  formatDate,
  formatDateSwift,
  formatDateCompact,
  formatDateTimeISO,
  addBusinessDays,
  randomAmount,
  slightAmountDiff,
  txnId,
  randomRef,
  randomBankRef,
  randomCreditDescription,
  randomDebitDescription,
  randomDescription,
  formatAmountSwift,
  formatAmountBAI2,
  padRight,
  padLeft,
  randomSwiftBic,
  randomBankName,
  randomCounterparty,
  reformatDate
};

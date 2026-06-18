'use strict';

/**
 * NACHA/ACH Formatter — US ACH (Automated Clearing House) payment file.
 *
 * Produces NACHA-standard ACH files used for US payroll, vendor payments,
 * and ACH collections. Standard Entry Class: CCD (Corporate Credit or Debit).
 *
 * Record layout: exactly 94 characters per record.
 * Blocking factor: 10 — file is padded to a multiple of 10 records.
 *
 * Record types:
 *   1 — File Header
 *   5 — Batch Header
 *   6 — Entry Detail
 *   8 — Batch Control
 *   9 — File Control
 *   999...9 (94 nines) — Block padding
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function padR(str, len)         { return String(str == null ? '' : str).substring(0, len).padEnd(len, ' '); }
function padL(num, len)         { return String(Math.abs(Math.round(Number(num) || 0))).padStart(len, '0').substring(0, len); }
function last10(n)              { return String(n).slice(-10).padStart(10, '0'); }

// ABA check digit: weights 3,7,1 repeated over the first 8 digits
function abaCheckDigit(base8) {
  const d = base8.split('').map(Number);
  const w = [3, 7, 1, 3, 7, 1, 3, 7];
  const s = d.reduce((acc, v, i) => acc + v * w[i], 0);
  return (10 - (s % 10)) % 10;
}

const ROUTING_BASES = [
  '02100002', // JPMorgan Chase
  '02100003', // Citibank
  '02100024', // Wells Fargo
  '06100015', // Bank of America
  '02600009', // HSBC
  '02100028', // Deutsche Bank Trust
  '02600014', // BNP Paribas
  '02100030', // Barclays
];

function randomRouting9() {
  const base = ROUTING_BASES[Math.floor(Math.random() * ROUTING_BASES.length)];
  return base + abaCheckDigit(base);
}

const ODFI_ROUTING8 = '02100002'; // originating bank (JPMorgan Chase)

// ── Record builders (each returns exactly 94 chars) ───────────────────────────

function fileHeader(companyName, bankName) {
  const now  = new Date();
  const yy   = String(now.getFullYear()).slice(2);
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const dd   = String(now.getDate()).padStart(2, '0');
  const hh   = String(now.getHours()).padStart(2, '0');
  const mi   = String(now.getMinutes()).padStart(2, '0');
  return (
    '1' +                         // (1)    Record Type Code
    '01' +                        // (2-3)  Priority Code
    ` ${ODFI_ROUTING8}0` +        // (4-13) Immediate Destination: space + 9-digit routing
    '1234567890' +                // (14-23) Immediate Origin: company EIN
    yy + mm + dd +                // (24-29) File Creation Date YYMMDD
    hh + mi +                     // (30-33) File Creation Time HHMM
    'A' +                         // (34)   File ID Modifier
    '094' +                       // (35-37) Record Size
    '10' +                        // (38-39) Blocking Factor
    '1' +                         // (40)   Format Code
    padR(bankName, 23) +          // (41-63) Immediate Destination Name
    padR(companyName, 23) +       // (64-86) Immediate Origin Name
    '        '                    // (87-94) Reference Code
  );
}

function batchHeader(companyName, companyId, effectiveDate, batchNum, svcClass) {
  return (
    '5' +                         // (1)    Record Type Code
    svcClass +                    // (2-4)  Service Class Code
    padR(companyName, 16) +       // (5-20) Company Name
    padR('', 20) +                // (21-40) Company Discretionary Data
    padR(companyId, 10) +         // (41-50) Company Identification
    'CCD' +                       // (51-53) Standard Entry Class Code
    padR('PAYMENTS', 10) +        // (54-63) Company Entry Description
    '      ' +                    // (64-69) Company Descriptive Date
    effectiveDate +               // (70-75) Effective Entry Date YYMMDD
    '   ' +                       // (76-78) Settlement Date (bank fills in)
    '1' +                         // (79)   Originator Status Code
    ODFI_ROUTING8 +               // (80-87) ODFI Routing (8 digits, no check)
    padL(batchNum, 7)             // (88-94) Batch Number
  );
}

function entryDetail(routing9, acctNum, amtCents, txCode, indivId, indivName, seqNum) {
  return (
    '6' +                         // (1)    Record Type Code
    String(txCode) +              // (2-3)  Transaction Code: 22=chk credit, 27=chk debit
    routing9 +                    // (4-12) RDFI Routing Transit Number (9 digits)
    padR(acctNum, 17) +           // (13-29) DFI Account Number
    padL(amtCents, 10) +          // (30-39) Amount in cents
    padR(indivId, 15) +           // (40-54) Individual ID Number
    padR(indivName, 22) +         // (55-76) Individual Name
    '  ' +                        // (77-78) Discretionary Data
    '0' +                         // (79)   Addenda Record Indicator
    ODFI_ROUTING8 + padL(seqNum, 7) // (80-94) Trace Number
  );
}

function batchControl(svcClass, entryCnt, entryHash, debitTotal, creditTotal, companyId, batchNum) {
  return (
    '8' +                         // (1)    Record Type Code
    svcClass +                    // (2-4)  Service Class Code
    padL(entryCnt, 6) +           // (5-10) Entry/Addenda Count
    last10(entryHash) +           // (11-20) Entry Hash
    padL(debitTotal, 12) +        // (21-32) Total Debit Amount (cents)
    padL(creditTotal, 12) +       // (33-44) Total Credit Amount (cents)
    padR(companyId, 10) +         // (45-54) Company Identification
    padR('', 19) +                // (55-73) Message Authentication Code
    '      ' +                    // (74-79) Reserved
    ODFI_ROUTING8 +               // (80-87) ODFI Routing
    padL(batchNum, 7)             // (88-94) Batch Number
  );
}

function fileControl(batchCnt, blockCnt, entryCnt, entryHash, debitTotal, creditTotal) {
  return (
    '9' +                         // (1)    Record Type Code
    padL(batchCnt, 6) +           // (2-7)  Batch Count
    padL(blockCnt, 6) +           // (8-13) Block Count
    padL(entryCnt, 8) +           // (14-21) Entry/Addenda Count
    last10(entryHash) +           // (22-31) Entry Hash
    padL(debitTotal, 12) +        // (32-43) Total Debit (cents)
    padL(creditTotal, 12) +       // (44-55) Total Credit (cents)
    padR('', 39)                  // (56-94) Reserved
  );
}

const BLOCK_PAD = '9'.repeat(94);

// ── Core builder ──────────────────────────────────────────────────────────────

function buildNACHA(entries) {
  const now           = new Date();
  const yy            = String(now.getFullYear()).slice(2);
  const mm            = String(now.getMonth() + 1).padStart(2, '0');
  const dd            = String(now.getDate()).padStart(2, '0');
  const effectiveDate = yy + mm + dd;

  const companyName = 'INTELLIMATCH CORP  ';
  const bankName    = 'JPMORGAN CHASE BANK';
  const companyId   = '1234567890';
  const batchNum    = 1;

  let debitTotal  = 0;
  let creditTotal = 0;
  let entryHash   = 0;
  const entryRecs = [];

  entries.forEach((e, idx) => {
    const routing9 = e.routing9 || randomRouting9();
    const txCode   = e.indicator === 'C' ? '22' : '27'; // 22=checking credit, 27=checking debit
    const amtCents = Math.round((parseFloat(e.amount) || 0) * 100);
    const acctNum  = String(e.accountNum || '').replace(/\s/g, '').padEnd(5, '0').substring(0, 17);
    const indivId  = String(e.refId  || '').substring(0, 15);
    const indivName= String(e.name   || '').substring(0, 22);

    entryRecs.push(entryDetail(routing9, acctNum, amtCents, txCode, indivId, indivName, idx + 1));

    if (e.indicator === 'C') creditTotal += amtCents;
    else                      debitTotal  += amtCents;

    entryHash += parseInt(routing9.substring(0, 8), 10);
  });

  const svcClass = (debitTotal > 0 && creditTotal > 0) ? '200'
    : creditTotal > 0 ? '220'
    : '225';

  const records = [
    fileHeader(companyName, bankName),
    batchHeader(companyName, companyId, effectiveDate, batchNum, svcClass),
    ...entryRecs,
    batchControl(svcClass, entryRecs.length, entryHash, debitTotal, creditTotal, companyId, batchNum),
  ];

  // +1 for file control, then pad to next multiple of 10
  const beforePad = records.length + 1;
  const blockCnt  = Math.ceil(beforePad / 10);
  const padCnt    = blockCnt * 10 - beforePad;

  records.push(fileControl(1, blockCnt, entryRecs.length, entryHash, debitTotal, creditTotal));
  for (let i = 0; i < padCnt; i++) records.push(BLOCK_PAD);

  return records.join('\n');
}

// ── Public formatters ─────────────────────────────────────────────────────────

function formatStatement(records) {
  if (records.length === 0) return '';
  return buildNACHA(records.map(rec => ({
    routing9:   randomRouting9(),
    accountNum: rec.BankAccountNumber.replace(/[^A-Z0-9]/gi, '').substring(0, 17) || '00000000000000000',
    indicator:  rec.DebitCreditIndicator,
    amount:     parseFloat(rec.Amount),
    refId:      rec.ReferenceNumber.substring(0, 15),
    name:       rec.Description.substring(0, 22),
  })));
}

function formatLedger(records) {
  if (records.length === 0) return '';
  return buildNACHA(records.map(rec => ({
    routing9:   randomRouting9(),
    accountNum: rec.LedgerAccount.padEnd(5, '0').substring(0, 17),
    indicator:  rec.CreditAmount !== '0.00' ? 'C' : 'D',
    amount:     parseFloat(rec.CreditAmount !== '0.00' ? rec.CreditAmount : rec.DebitAmount),
    refId:      rec.ReferenceNumber.substring(0, 15),
    name:       rec.Description.substring(0, 22),
  })));
}

module.exports = { formatLedger, formatStatement, ext: 'ach' };

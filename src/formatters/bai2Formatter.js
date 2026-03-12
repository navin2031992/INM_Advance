'use strict';

/**
 * BAI2 Formatter — Bank Administration Institute format version 2.
 *
 * BAI2 is a widely used US bank reporting standard for cash management.
 *
 * Structure:
 *   01 — File Header
 *   02 — Group Header
 *   03 — Account Identifier
 *   16 — Transaction Detail
 *   49 — Account Trailer
 *   98 — Group Trailer
 *   99 — File Trailer
 *
 * Amounts are in cents (no decimal point).
 * Records are comma-delimited, terminated with /
 */

const { formatDateCompact, formatAmountBAI2, randInt } = require('../utils/randomizer');

// BAI2 Type Codes (subset used in reconciliation)
const CREDIT_TYPE_CODES = [
  { code: '100', desc: 'Total Credits' },
  { code: '175', desc: 'ACH Credits' },
  { code: '195', desc: 'Incoming Money Transfer' },
  { code: '400', desc: 'Miscellaneous Credits' },
  { code: '410', desc: 'Credit Adjustment' },
  { code: '450', desc: 'Customer Payment' },
  { code: '460', desc: 'Trade Payment' },
  { code: '470', desc: 'Lockbox' }
];

const DEBIT_TYPE_CODES = [
  { code: '400', desc: 'Total Debits' },
  { code: '475', desc: 'ACH Debits' },
  { code: '495', desc: 'Outgoing Money Transfer' },
  { code: '500', desc: 'Miscellaneous Debits' },
  { code: '510', desc: 'Debit Adjustment' },
  { code: '550', desc: 'Vendor Payment' },
  { code: '560', desc: 'Payroll' },
  { code: '570', desc: 'Tax Payment' }
];

function randFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatStatement(records) {
  if (records.length === 0) return '';

  const senderId   = 'BANKID001';
  const receiverId = 'CORPID001';
  const fileDate   = formatDateCompact(new Date());
  const fileTime   = '1200';
  const fileId     = String(randInt(100000, 999999));

  // Group by bank account
  const accountMap = {};
  for (const rec of records) {
    const acct = rec.BankAccountNumber;
    if (!accountMap[acct]) accountMap[acct] = [];
    accountMap[acct].push(rec);
  }

  const lines = [];
  // File Header
  lines.push(`01,${senderId},${receiverId},${fileDate},${fileTime},${fileId},,,2/`);

  let fileTotalAmt    = 0;
  let fileRecordCount = 2; // header + trailer
  let accountCount    = 0;

  // One Group for all accounts
  const groupDate = fileDate;
  lines.push(`02,${senderId},${receiverId},1,${groupDate},${fileTime},,2/`);
  fileRecordCount++;

  let groupTotalAmt    = 0;
  let groupRecordCount = 2; // group header + trailer

  for (const [account, recs] of Object.entries(accountMap)) {
    const currency = recs[0].Currency;
    const sorted   = [...recs].sort((a, b) => a.TransactionDate.localeCompare(b.TransactionDate));
    const asOfDate = sorted[0].TransactionDate.replace(/-/g, '').substring(2); // YYMMDD

    // Calculate opening ledger balance (sum of all entries)
    let ledgerBalance = Math.round(Math.random() * 500000 * 100); // in cents
    let creditTotal   = 0;
    let creditCount   = 0;
    let debitTotal    = 0;
    let debitCount    = 0;

    for (const r of sorted) {
      const amtCents = Math.round(parseFloat(r.Amount) * 100);
      if (r.DebitCreditIndicator === 'C') { creditTotal += amtCents; creditCount++; }
      else                                { debitTotal  += amtCents; debitCount++;  }
    }

    // Account Identifier record
    // 03,ACCOUNT,BANK,CURRENCY,AS-OF-DATE,FUNDS-TYPE,TYPE-CODE,AMOUNT,...
    lines.push(
      `03,${account},${senderId},${currency},${asOfDate},,015,${ledgerBalance},` +
      `050,${creditCount * 100},055,${debitCount * 100}/`
    );
    fileRecordCount++;
    groupRecordCount++;

    let acctRecordCount = 1; // account identifier
    let acctTotalAmt    = 0;

    for (const rec of sorted) {
      const amtCents   = Math.round(parseFloat(rec.Amount) * 100);
      const typeEntry  = rec.DebitCreditIndicator === 'C'
        ? randFrom(CREDIT_TYPE_CODES)
        : randFrom(DEBIT_TYPE_CODES);
      const bankRef    = rec.BankReference.substring(0, 16);
      const custRef    = rec.ReferenceNumber.substring(0, 16);
      const desc       = rec.Description.substring(0, 40).replace(/,/g, ' ');
      const txnDate    = formatDateCompact(new Date(rec.TransactionDate)).substring(2); // YYMMDD

      // 16,TYPE-CODE,AMOUNT,FUNDS-TYPE,BANK-REF,CUST-REF,TEXT
      lines.push(`16,${typeEntry.code},${amtCents},0,${bankRef},${custRef},${desc}/`);

      acctTotalAmt    += amtCents;
      acctRecordCount++;
      fileRecordCount++;
      groupRecordCount++;
    }

    // Account Trailer: 49,CONTROL-TOTAL,RECORD-COUNT
    acctTotalAmt += ledgerBalance;
    lines.push(`49,${acctTotalAmt},${acctRecordCount + 1}/`); // +1 for trailer
    fileRecordCount++;
    groupRecordCount++;
    groupTotalAmt += acctTotalAmt;
    accountCount++;
  }

  // Group Trailer: 98,CONTROL-TOTAL,ACCOUNT-COUNT,RECORD-COUNT
  lines.push(`98,${groupTotalAmt},${accountCount},${groupRecordCount + 1}/`);
  fileTotalAmt += groupTotalAmt;
  fileRecordCount++;

  // File Trailer: 99,CONTROL-TOTAL,GROUP-COUNT,RECORD-COUNT
  lines.push(`99,${fileTotalAmt},1,${fileRecordCount + 1}/`);

  return lines.join('\n');
}

function formatLedger(records) {
  return formatStatement(records.map(r => ({
    StatementID:          r.TxnID,
    BankAccountNumber:    r.LedgerAccount,
    TransactionDate:      r.TransactionDate,
    ValueDate:            r.PostingDate,
    Currency:             r.Currency,
    Amount:               r.CreditAmount !== '0.00' ? r.CreditAmount : r.DebitAmount,
    DebitCreditIndicator: r.CreditAmount !== '0.00' ? 'C' : 'D',
    Description:          r.Description,
    BankReference:        r.ReferenceNumber,
    ReferenceNumber:      r.ReferenceNumber,
    MatchType:            r.MatchType
  })));
}

module.exports = { formatLedger, formatStatement, ext: 'bai2' };

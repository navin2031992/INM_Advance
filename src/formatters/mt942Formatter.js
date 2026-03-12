'use strict';

/**
 * SWIFT MT942 Formatter — Interim Transaction Report.
 *
 * Similar to MT940 but used for intraday reporting (no closing balance tag).
 * :20: TRN Reference
 * :25: Account
 * :28C: Statement/Sequence
 * :34F: Available Floor Limit Indicator
 * :13D: Date/Time indication
 * :61: Statement Line
 * :86: Information
 * :90D: Number and Sum of Debit Entries
 * :90C: Number and Sum of Credit Entries
 */

const { formatDateSwift, formatAmountSwift, randomSwiftBic } = require('../utils/randomizer');

function formatStatement(records) {
  if (records.length === 0) return '';

  const accountMap = {};
  for (const rec of records) {
    const acct = rec.BankAccountNumber;
    if (!accountMap[acct]) accountMap[acct] = [];
    accountMap[acct].push(rec);
  }

  const messages = [];
  let counter = 1;

  for (const [account, recs] of Object.entries(accountMap)) {
    const currency = recs[0].Currency;
    const senderBic   = randomSwiftBic();
    const receiverBic = randomSwiftBic();
    const sorted = [...recs].sort((a, b) => a.TransactionDate.localeCompare(b.TransactionDate));
    const firstDate = sorted[0].TransactionDate;
    const refId = `INTR${String(counter++).padStart(10, '0')}`;
    const stmtNo = String(counter).padStart(5, '0');

    let debitCount = 0, debitTotal = 0;
    let creditCount = 0, creditTotal = 0;

    let msg = '';
    msg += `{1:F01${senderBic}AXXX0000000000}`;
    msg += `{2:I942${receiverBic}XXXXN}`;
    msg += `{4:\n`;
    msg += `:20:${refId}\n`;
    msg += `:25:${account}/${currency}\n`;
    msg += `:28C:${stmtNo}/001\n`;
    msg += `:34F:${currency}${formatAmountSwift(0)}\n`;

    const nowSwift = formatDateSwift(new Date(firstDate));
    msg += `:13D:${nowSwift}1200+0000\n`;

    for (const rec of sorted) {
      const amt    = parseFloat(rec.Amount);
      const swDate = formatDateSwift(new Date(rec.TransactionDate));
      const swVal  = formatDateSwift(new Date(rec.ValueDate));
      const dc     = rec.DebitCreditIndicator;
      const bankRef = rec.BankReference.substring(0, 16);
      const custRef = rec.ReferenceNumber.substring(0, 16);

      if (dc === 'D') { debitCount++;  debitTotal  += amt; }
      else            { creditCount++; creditTotal += amt; }

      msg += `:61:${swVal}${swDate}${dc}${formatAmountSwift(amt)}NTRN${custRef}//${bankRef}\n`;
      msg += `:86:${rec.Description.substring(0, 65)}\n`;
    }

    msg += `:90D:${debitCount}${currency}${formatAmountSwift(debitTotal)}\n`;
    msg += `:90C:${creditCount}${currency}${formatAmountSwift(creditTotal)}\n`;
    msg += `-}`;

    messages.push(msg);
  }

  return messages.join('\n\n');
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

module.exports = { formatLedger, formatStatement, ext: 'txt' };

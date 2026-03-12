'use strict';

/**
 * SWIFT MT950 Formatter — Bank Statement Message (bank-to-bank).
 *
 * MT950 is similar to MT940 but exchanged between financial institutions.
 * :20: TRN Reference
 * :25: Account Identification
 * :28C: Statement / Sequence Number
 * :60F: Opening Balance
 * :61: Statement Line
 * :62F: Closing Balance
 * :64: Available Balance (optional)
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

    let balance = 0;
    for (const r of sorted) {
      const amt = parseFloat(r.Amount);
      if (r.DebitCreditIndicator === 'C') balance += amt;
      else balance -= amt;
    }
    const openingBalance = Math.abs(balance) + Math.random() * 50000;
    const closingBalance = openingBalance + balance;
    const closingIndicator = closingBalance >= 0 ? 'C' : 'D';
    const availableBalance = Math.abs(closingBalance) - Math.random() * 10000;

    const firstDate = sorted[0].TransactionDate;
    const lastDate  = sorted[sorted.length - 1].TransactionDate;
    const refId     = `BST${String(counter++).padStart(11, '0')}`;
    const stmtNo    = String(counter).padStart(5, '0');

    let msg = '';
    msg += `{1:F01${senderBic}AXXX0000000000}`;
    msg += `{2:I950${receiverBic}XXXXN}`;
    msg += `{4:\n`;
    msg += `:20:${refId}\n`;
    msg += `:25:${account}\n`;
    msg += `:28C:${stmtNo}/001\n`;
    msg += `:60F:C${formatDateSwift(new Date(firstDate))}${currency}${formatAmountSwift(openingBalance)}\n`;

    for (const rec of sorted) {
      const amt    = parseFloat(rec.Amount);
      const swDate = formatDateSwift(new Date(rec.TransactionDate));
      const swVal  = formatDateSwift(new Date(rec.ValueDate));
      const dc     = rec.DebitCreditIndicator;
      const bankRef = rec.BankReference.substring(0, 16);
      const custRef = rec.ReferenceNumber.substring(0, 16);
      msg += `:61:${swVal}${swDate}${dc}${formatAmountSwift(amt)}NTRN${custRef}//${bankRef}\n`;
    }

    msg += `:62F:${closingIndicator}${formatDateSwift(new Date(lastDate))}${currency}${formatAmountSwift(Math.abs(closingBalance))}\n`;
    msg += `:64:${closingIndicator}${formatDateSwift(new Date(lastDate))}${currency}${formatAmountSwift(Math.max(0, availableBalance))}\n`;
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

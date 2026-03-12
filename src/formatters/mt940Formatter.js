'use strict';

/**
 * SWIFT MT940 Formatter — Customer Statement Message.
 *
 * Format: ISO 15022 block structure
 * {1:F01...}{2:I940...}{4:
 *   :20: Transaction Reference
 *   :25: Account Identification
 *   :28C: Statement/Sequence Number
 *   :60F: Opening Balance
 *   :61: Statement Line (one per transaction)
 *   :86: Information to Account Owner
 *   :62F: Closing Balance
 *   -}
 *
 * Applied to: Statement records (bank statement data)
 */

const { formatDateSwift, formatAmountSwift, randomSwiftBic } = require('../utils/randomizer');

function formatStatement(records) {
  if (records.length === 0) return '';

  // Group records by bank account number
  const accountMap = {};
  for (const rec of records) {
    const acct = rec.BankAccountNumber;
    if (!accountMap[acct]) accountMap[acct] = [];
    accountMap[acct].push(rec);
  }

  const messages = [];
  let stmtCounter = 1;

  for (const [account, recs] of Object.entries(accountMap)) {
    const currency = recs[0].Currency;
    const senderBic   = randomSwiftBic();
    const receiverBic = randomSwiftBic();

    // Calculate opening and closing balance
    let balance = 0;
    for (const r of recs) {
      const amt = parseFloat(r.Amount);
      if (r.DebitCreditIndicator === 'C') balance += amt;
      else balance -= amt;
    }
    const openingBalance = Math.abs(balance) + Math.random() * 100000;
    const closingBalance = openingBalance + balance;
    const closingIndicator = closingBalance >= 0 ? 'C' : 'D';

    // Sort by transaction date
    const sorted = [...recs].sort((a, b) => a.TransactionDate.localeCompare(b.TransactionDate));
    const firstDate = sorted[0].TransactionDate;

    const refId = `STMT${String(stmtCounter++).padStart(10, '0')}`;
    const stmtNo = String(stmtCounter).padStart(5, '0');

    let msg = '';
    msg += `{1:F01${senderBic}AXXX0000000000}`;
    msg += `{2:I940${receiverBic}XXXXN}`;
    msg += `{4:\n`;
    msg += `:20:${refId}\n`;
    msg += `:25:${account}/${currency}\n`;
    msg += `:28C:${stmtNo}/001\n`;
    msg += `:60F:C${formatDateSwift(new Date(firstDate))}${currency}${formatAmountSwift(openingBalance)}\n`;

    for (const rec of sorted) {
      const amt    = parseFloat(rec.Amount);
      const swDate = formatDateSwift(new Date(rec.TransactionDate));
      const swVal  = formatDateSwift(new Date(rec.ValueDate));
      const dc     = rec.DebitCreditIndicator;
      const bankRef = rec.BankReference.substring(0, 16);
      const custRef = rec.ReferenceNumber.substring(0, 16);

      // :61: ValueDate [BookDate] D/C Amount SwiftCode CustomerRef [//BankRef]
      msg += `:61:${swVal}${swDate}${dc}${formatAmountSwift(amt)}NTRN${custRef}//${bankRef}\n`;
      // :86: Narrative
      const desc = rec.Description.substring(0, 65);
      msg += `:86:${desc}\n`;
    }

    const closeDate = sorted[sorted.length - 1].TransactionDate;
    msg += `:62F:${closingIndicator}${formatDateSwift(new Date(closeDate))}${currency}${formatAmountSwift(Math.abs(closingBalance))}\n`;
    msg += `-}`;

    messages.push(msg);
  }

  return messages.join('\n\n');
}

// MT940 is bank-statement oriented; no ledger format
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

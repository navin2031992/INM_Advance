'use strict';

/**
 * SWIFT MT103 Formatter — Single Customer Credit Transfer.
 *
 * One MT103 message per transaction.
 * :20: Sender's Reference
 * :23B: Bank Operation Code (CRED)
 * :32A: Value Date / Currency / Amount
 * :50K: Ordering Customer
 * :59: Beneficiary Customer
 * :70: Remittance Information
 * :71A: Details of Charges (OUR/SHA/BEN)
 */

const { formatDateSwift, formatAmountSwift, randomSwiftBic, randomCounterparty, randomBankName } = require('../utils/randomizer');

function formatStatement(records) {
  if (records.length === 0) return '';
  const messages = [];

  for (const rec of records) {
    const senderBic   = randomSwiftBic();
    const receiverBic = randomSwiftBic();
    const dc          = rec.DebitCreditIndicator;
    const amt         = parseFloat(rec.Amount);
    const swDate      = formatDateSwift(new Date(rec.ValueDate || rec.TransactionDate));
    const orderCust   = randomCounterparty();
    const beneCust    = randomCounterparty();
    const bankName    = randomBankName();
    const ref         = rec.ReferenceNumber.substring(0, 16);

    let msg = '';
    msg += `{1:F01${senderBic}AXXX0000000000}`;
    msg += `{2:I103${receiverBic}XXXXN}`;
    msg += `{4:\n`;
    msg += `:20:${ref}\n`;
    msg += `:23B:CRED\n`;
    msg += `:32A:${swDate}${rec.Currency}${formatAmountSwift(amt)}\n`;
    msg += `:50K:/${rec.BankAccountNumber || rec.LedgerAccount}\n`;
    msg += `${orderCust}\n`;
    msg += `${bankName}\n`;
    msg += `:59:/${rec.BankAccountNumber || rec.LedgerAccount}\n`;
    msg += `${beneCust}\n`;
    msg += `:70:${rec.Description.substring(0, 35)}\n`;
    msg += `:71A:SHA\n`;
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

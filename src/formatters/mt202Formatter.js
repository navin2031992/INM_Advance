'use strict';

/**
 * SWIFT MT202 Formatter — Bank Transfer (Financial Institution Transfer).
 *
 * Used for bank-to-bank transfers.
 * :20: Sender's Reference
 * :21: Related Reference
 * :32A: Value Date / Currency / Amount
 * :52A: Ordering Institution (BIC)
 * :53A: Sender's Correspondent
 * :58A: Beneficiary Institution (BIC)
 * :72: Sender to Receiver Information
 */

const { formatDateSwift, formatAmountSwift, randomSwiftBic } = require('../utils/randomizer');

function formatStatement(records) {
  if (records.length === 0) return '';
  const messages = [];

  for (const rec of records) {
    const senderBic    = randomSwiftBic();
    const receiverBic  = randomSwiftBic();
    const orderBic     = randomSwiftBic();
    const corrBic      = randomSwiftBic();
    const beneBic      = randomSwiftBic();
    const amt          = parseFloat(rec.Amount);
    const swDate       = formatDateSwift(new Date(rec.ValueDate || rec.TransactionDate));
    const ref          = rec.ReferenceNumber.substring(0, 16);
    const relRef       = (rec.BankReference || rec.ReferenceNumber).substring(0, 16);

    let msg = '';
    msg += `{1:F01${senderBic}AXXX0000000000}`;
    msg += `{2:I202${receiverBic}XXXXN}`;
    msg += `{4:\n`;
    msg += `:20:${ref}\n`;
    msg += `:21:${relRef}\n`;
    msg += `:32A:${swDate}${rec.Currency}${formatAmountSwift(amt)}\n`;
    msg += `:52A:${orderBic}\n`;
    msg += `:53A:${corrBic}\n`;
    msg += `:58A:${beneBic}\n`;
    msg += `:72:/ACC/${rec.BankAccountNumber || rec.LedgerAccount}\n`;
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

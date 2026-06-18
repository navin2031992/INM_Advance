'use strict';

/**
 * SWIFT MT910/MT900 Formatter — Confirmation of Credit / Confirmation of Debit.
 *
 * MT910: Sent by the receiving bank to confirm it has credited the beneficiary.
 *        The counterpart to an outgoing MT103 or MT202 — the "ping back" that
 *        proves the payment landed.
 *
 * MT900: Sent by the bank to confirm it has debited the ordering customer.
 *        The counterpart to an MT103 or MT202 debit instruction.
 *
 * IntelliMatch use case:
 *   Ledger (payment instruction) ↔ MT910/MT900 (bank confirmation)
 *   This reconciliation scenario cannot be tested without these messages.
 *
 * Fields:
 *   :20:  Sender's Reference
 *   :21:  Related Reference (original payment ref)
 *   :25:  Account Identification
 *   :32A: Value Date / Currency / Amount
 *   :52A: Ordering Institution (for MT910 — who sent the funds)
 *   :72:  Sender to Receiver Information
 */

const {
  formatDateSwift,
  formatAmountSwift,
  randomSwiftBic,
  randomBankName
} = require('../utils/randomizer');

function buildMessage(rec, msgType) {
  const senderBic   = randomSwiftBic();
  const receiverBic = randomSwiftBic();
  const amt         = parseFloat(rec.Amount);
  const swDate      = formatDateSwift(new Date(rec.ValueDate || rec.TransactionDate));
  const ref         = rec.ReferenceNumber.substring(0, 16);
  const bankRef     = (rec.BankReference || rec.ReferenceNumber).substring(0, 16);
  const acct        = (rec.BankAccountNumber || rec.LedgerAccount || '').substring(0, 34);
  const narrative   = rec.Description.substring(0, 35);

  let msg = '';
  msg += `{1:F01${senderBic}AXXX0000000000}`;
  msg += `{2:I${msgType}${receiverBic}XXXXN}`;
  msg += `{4:\n`;
  msg += `:20:${ref}\n`;           // Sender's Reference
  msg += `:21:${bankRef}\n`;       // Related Reference (original payment)
  msg += `:25:${acct}\n`;          // Account Identification
  msg += `:32A:${swDate}${rec.Currency}${formatAmountSwift(amt)}\n`; // Date/Ccy/Amount
  msg += `:52A:${randomSwiftBic()}\n`;  // Ordering Institution BIC
  msg += `:72:/NARR/${narrative}\n`;    // Sender-to-Receiver narrative
  msg += `-}`;

  return msg;
}

function formatStatement(records) {
  if (records.length === 0) return '';
  return records
    .map(rec => {
      // MT910 = Confirmation of Credit (we received money)
      // MT900 = Confirmation of Debit  (we sent money)
      const msgType = rec.DebitCreditIndicator === 'C' ? '910' : '900';
      return buildMessage(rec, msgType);
    })
    .join('\n\n');
}

function formatLedger(records) {
  if (records.length === 0) return '';
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
    MatchType:            r.MatchType,
  })));
}

module.exports = { formatLedger, formatStatement, ext: 'txt' };

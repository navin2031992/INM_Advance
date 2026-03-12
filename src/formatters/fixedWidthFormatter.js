'use strict';

/**
 * Fixed-Width Formatter — produces positional flat-file output.
 *
 * Ledger layout (positions):
 *   TxnID           1-12   (12)
 *   LedgerAccount   13-22  (10)
 *   TransactionDate 23-32  (10)
 *   PostingDate     33-42  (10)
 *   Currency        43-45  (3)
 *   DebitAmount     46-58  (13, right-aligned)
 *   CreditAmount    59-71  (13, right-aligned)
 *   Description     72-111 (40)
 *   ReferenceNumber 112-131(20)
 *   MatchType       132-150(19)
 *
 * Statement layout (positions):
 *   StatementID          1-12  (12)
 *   BankAccountNumber    13-40 (28)
 *   TransactionDate      41-50 (10)
 *   ValueDate            51-60 (10)
 *   Currency             61-63 (3)
 *   Amount               64-76 (13)
 *   DebitCreditIndicator 77-77 (1)
 *   Description          78-117(40)
 *   BankReference        118-137(20)
 *   ReferenceNumber      138-157(20)
 *   MatchType            158-176(19)
 */

const { padRight, padLeft } = require('../utils/randomizer');

function formatLedger(records) {
  const header =
    padRight('TxnID', 12) +
    padRight('LedgerAcct', 10) +
    padRight('TxnDate', 10) +
    padRight('PostDate', 10) +
    padRight('Ccy', 3) +
    padLeft('DebitAmt', 13) +
    padLeft('CreditAmt', 13) +
    padRight('Description', 40) +
    padRight('Reference', 20) +
    padRight('MatchType', 19);

  const separator = '-'.repeat(150);
  const lines = [header, separator];

  for (const rec of records) {
    const line =
      padRight(rec.TxnID,           12) +
      padRight(rec.LedgerAccount,   10) +
      padRight(rec.TransactionDate, 10) +
      padRight(rec.PostingDate,     10) +
      padRight(rec.Currency,        3) +
      padLeft(rec.DebitAmount,      13) +
      padLeft(rec.CreditAmount,     13) +
      padRight(rec.Description,     40) +
      padRight(rec.ReferenceNumber, 20) +
      padRight(rec.MatchType,       19);
    lines.push(line);
  }

  return lines.join('\n');
}

function formatStatement(records) {
  const header =
    padRight('StatementID', 12) +
    padRight('BankAccount', 28) +
    padRight('TxnDate', 10) +
    padRight('ValueDate', 10) +
    padRight('Ccy', 3) +
    padLeft('Amount', 13) +
    padRight('DC', 1) +
    padRight('Description', 40) +
    padRight('BankRef', 20) +
    padRight('Reference', 20) +
    padRight('MatchType', 19);

  const separator = '-'.repeat(176);
  const lines = [header, separator];

  for (const rec of records) {
    const line =
      padRight(rec.StatementID,          12) +
      padRight(rec.BankAccountNumber,    28) +
      padRight(rec.TransactionDate,      10) +
      padRight(rec.ValueDate,            10) +
      padRight(rec.Currency,             3) +
      padLeft(rec.Amount,                13) +
      padRight(rec.DebitCreditIndicator, 1) +
      padRight(rec.Description,          40) +
      padRight(rec.BankReference,        20) +
      padRight(rec.ReferenceNumber,      20) +
      padRight(rec.MatchType,            19);
    lines.push(line);
  }

  return lines.join('\n');
}

module.exports = { formatLedger, formatStatement, ext: 'txt' };

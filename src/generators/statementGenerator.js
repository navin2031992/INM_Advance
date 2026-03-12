'use strict';

/**
 * Bank Statement Record Generator for IntelliMatch.
 *
 * Produces bank statement records from match groups.
 *
 * Statement Record fields:
 *   StatementID, BankAccountNumber, TransactionDate, ValueDate,
 *   Currency, Amount, DebitCreditIndicator, Description, BankReference, ReferenceNumber, MatchType
 */

const { txnId, randomDescription } = require('../utils/randomizer');

/**
 * Generates an array of statement record objects from match groups.
 *
 * @param {object[]} matchGroups
 * @param {object}   config
 * @returns {object[]} statement records
 */
function generateStatementRecords(matchGroups, config) {
  const records = [];

  for (const group of matchGroups) {
    if (group.stmtIds.length === 0) continue; // unmatchedLedger has no statement entries

    const { indicator, currency, txnDate, type } = group;

    group.stmtIds.forEach((seqId, idx) => {
      const id       = txnId('STM', seqId);
      const amount   = group.stmtAmounts[idx];
      const ref      = (group.stmtRefs    || [])[idx] || group.ref;
      const bankRef  = (group.stmtBankRefs|| [])[idx] || group.bankRef;
      const valueDate = group.stmtValueDate || group.valueDate;
      const desc     = randomDescription(indicator);

      const record = {
        StatementID:          id,
        BankAccountNumber:    group.bankAcc,
        TransactionDate:      txnDate,
        ValueDate:            valueDate,
        Currency:             currency,
        Amount:               amount.toFixed(2),
        DebitCreditIndicator: indicator,
        Description:          desc,
        BankReference:        bankRef,
        ReferenceNumber:      ref,
        MatchType:            type
      };

      records.push(record);
    });
  }

  return records;
}

module.exports = { generateStatementRecords };

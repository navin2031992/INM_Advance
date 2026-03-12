'use strict';

/**
 * Ledger Record Generator for IntelliMatch.
 *
 * Produces ledger records from match groups.
 *
 * Ledger Record fields:
 *   TxnID, LedgerAccount, TransactionDate, PostingDate,
 *   Currency, DebitAmount, CreditAmount, Description, ReferenceNumber, MatchType
 */

const { txnId, randomDescription, randomRef, randFrom } = require('../utils/randomizer');

/**
 * Generates an array of ledger record objects from match groups.
 *
 * @param {object[]} matchGroups
 * @param {object}   config
 * @returns {object[]} ledger records
 */
function generateLedgerRecords(matchGroups, config) {
  const records = [];

  for (const group of matchGroups) {
    if (group.ledgerIds.length === 0) continue; // unmatchedStatement has no ledger entries

    const { indicator, currency, txnDate, postDate, ref, type } = group;

    // For manyToOne groups, each ledger entry has its own split amount
    const amounts = group.ledgerAmounts || group.ledgerIds.map(() => group.amount);

    group.ledgerIds.forEach((seqId, idx) => {
      const id     = txnId('LDG', seqId);
      const amount = amounts[idx];
      const desc   = randomDescription(indicator);
      const recRef = ref + (group.ledgerIds.length > 1 ? `-${idx + 1}` : '');

      const record = {
        TxnID:           id,
        LedgerAccount:   group.ledgerAcc,
        TransactionDate: txnDate,
        PostingDate:     postDate,
        Currency:        currency,
        DebitAmount:     indicator === 'D' ? amount.toFixed(2) : '0.00',
        CreditAmount:    indicator === 'C' ? amount.toFixed(2) : '0.00',
        Description:     desc,
        ReferenceNumber: recRef,
        MatchType:       type
      };

      records.push(record);
    });
  }

  return records;
}

module.exports = { generateLedgerRecords };

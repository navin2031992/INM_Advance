'use strict';

/**
 * SWIFT MT300 Formatter — Foreign Exchange Confirmation.
 *
 * One MT300 message per transaction. Each record's currency is treated
 * as the bought currency; a complementary sold currency is derived using
 * approximate FX rates.
 *
 * :15A:   New sequence A (General)
 * :20:    Sender's reference
 * :21:    Related reference
 * :22A:   Type of operation (NEWT = new transaction)
 * :94A:   Scope of operation (ASPO = spot)
 * :22C:   Common reference
 * :17T:   Fund or fees (N)
 * :17U:   FX type (N = spot)
 * :30T:   Trade date (YYMMDD)
 * :30V:   Value date (YYMMDD)
 * :36:    Exchange rate
 * :15B:   New sequence B (Bought Currency)
 * :32B:   Currency / Bought amount
 * :57A:   Account with institution (Bought side)
 * :58A:   Beneficiary institution (Bought side)
 * :15C:   New sequence C (Sold Currency)
 * :33B:   Currency / Sold amount
 * :57A:   Account with institution (Sold side)
 * :58A:   Beneficiary institution (Sold side)
 */

const { formatDateSwift, formatAmountSwift, randomSwiftBic, randInt, randFrom } = require('../utils/randomizer');

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'CHF', 'JPY', 'CAD', 'SGD'];

// Approximate FX rates relative to USD (used to derive sold amount)
const FX_RATES = {
  USD: 1.0000, EUR: 0.9200, GBP: 0.7900, AUD: 1.5400,
  CHF: 0.8900, JPY: 149.50, CAD: 1.3600, SGD: 1.3400
};

function getExchangeRate(boughtCcy, soldCcy) {
  const bRate = FX_RATES[boughtCcy] || 1.0;
  const sRate = FX_RATES[soldCcy]   || 1.0;
  return (sRate / bRate).toFixed(4);
}

function formatStatement(records) {
  if (records.length === 0) return '';
  const messages = [];

  for (const rec of records) {
    const senderBic   = randomSwiftBic();
    const receiverBic = randomSwiftBic();
    const boughtBic   = randomSwiftBic();
    const soldBic     = randomSwiftBic();

    const boughtCcy = rec.Currency;
    const soldCcy   = randFrom(CURRENCIES.filter(c => c !== boughtCcy));

    const tradeDate = formatDateSwift(new Date(rec.TransactionDate || rec.ValueDate));
    const valueDate = formatDateSwift(new Date(rec.ValueDate       || rec.TransactionDate));
    const postDate  = formatDateSwift(new Date(rec.PostingDate     || rec.ValueDate || rec.TransactionDate));

    const boughtAmt = parseFloat(rec.Amount);
    const rate      = parseFloat(getExchangeRate(boughtCcy, soldCcy));
    const soldAmt   = (boughtAmt * rate).toFixed(2);

    const ref       = rec.ReferenceNumber.substring(0, 16);
    const relRef    = (rec.BankReference || rec.ReferenceNumber).substring(0, 16);
    const commonRef = `${senderBic.substring(0, 4)}${receiverBic.substring(0, 4)}${randInt(100000, 999999)}`;

    let msg = '';
    msg += `{1:F01${senderBic}AXXX0000000000}`;
    msg += `{2:I300${receiverBic}XXXXN}`;
    msg += `{4:\n`;
    msg += `:15A:\n`;
    msg += `:20:${ref}\n`;
    msg += `:21:${relRef}\n`;
    msg += `:22A:NEWT\n`;
    msg += `:94A:ASPO\n`;
    msg += `:22C:${commonRef}\n`;
    msg += `:17T:N\n`;
    msg += `:17U:N\n`;
    msg += `:30T:${tradeDate}\n`;
    msg += `:30V:${valueDate}\n`;
    msg += `:30P:${postDate}\n`;
    msg += `:36:${rate}\n`;
    msg += `:15B:\n`;
    msg += `:32B:${boughtCcy}${formatAmountSwift(boughtAmt)}\n`;
    msg += `:57A:${boughtBic}\n`;
    msg += `:58A:${soldBic}\n`;
    msg += `:15C:\n`;
    msg += `:33B:${soldCcy}${formatAmountSwift(parseFloat(soldAmt))}\n`;
    msg += `:57A:${soldBic}\n`;
    msg += `:58A:${boughtBic}\n`;
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
    PostingDate:          r.PostingDate,
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

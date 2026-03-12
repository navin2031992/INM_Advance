'use strict';

/**
 * SWIFT MT535 Formatter — Statement of Holdings.
 *
 * Reports securities holdings in a safekeeping account.
 * One MT535 message per unique account across all records.
 *
 * :16R:GENL        General block
 * :28E:            Statement number / page indicator
 * :20C:SEME//      Sender's message reference
 * :23G:            Function of message (NEWM)
 * :98A:STAT//      Statement date (YYMMDD)
 * :22F:SFRE//DAIL  Statement frequency
 * :22F:CODE//SECU  Statement code
 * :97A:SAFE//      Safekeeping account
 * :17B:ACTI//Y     Activity flag
 * :16S:GENL
 * :16R:SUBSAFE     Sub-safekeeping account block
 * :97A:SAFE//
 * :16R:FIN         One block per holding
 * :35B:            ISIN + security name
 * :16R:FIAN        Financial instrument attributes
 * :90B:MRKT//      Market price
 * :94B:SAFE//      Place of safekeeping
 * :16S:FIAN
 * :93B:AGGR//      Aggregate balance (market value)
 * :16S:FIN
 * :16S:SUBSAFE
 */

const { formatDateSwift, formatAmountSwift, randomSwiftBic, randInt, randFrom } = require('../utils/randomizer');

const SECURITIES = [
  { isin: 'US0378331005', name: 'APPLE INC' },
  { isin: 'US5949181045', name: 'MICROSOFT CORP' },
  { isin: 'US02079K3059', name: 'ALPHABET INC CLASS A' },
  { isin: 'US4592001014', name: 'INTERNATIONAL BUSINESS MACHINES' },
  { isin: 'US38141G1040', name: 'GOLDMAN SACHS GROUP INC' },
  { isin: 'GB0007980591', name: 'BP PLC' },
  { isin: 'DE0007164600', name: 'SAP SE' },
  { isin: 'FR0000131104', name: 'BNP PARIBAS SA' },
  { isin: 'JP3633400001', name: 'TOYOTA MOTOR CORP' },
  { isin: 'CH0012221716', name: 'ABB LTD' },
  { isin: 'US9311421039', name: 'WALMART INC' },
  { isin: 'US88160R1014', name: 'TESLA INC' },
  { isin: 'US2546871060', name: 'DISNEY WALT CO' },
  { isin: 'US30303M1027', name: 'META PLATFORMS INC' },
  { isin: 'US6745991058', name: 'OCCIDENTAL PETROLEUM CORP' },
];

const CUSTODIANS = ['EUROCLEAR', 'DTCC', 'CLEARSTREAM', 'SIX SIS', 'MONTE TITOLI'];

function formatStatement(records) {
  if (records.length === 0) return '';

  // Group records by account — one MT535 per account
  const accountMap = new Map();
  for (const rec of records) {
    const acct = rec.BankAccountNumber || rec.StatementID || 'ACC001';
    if (!accountMap.has(acct)) accountMap.set(acct, []);
    accountMap.get(acct).push(rec);
  }

  const messages = [];

  for (const [acct, recs] of accountMap.entries()) {
    const senderBic   = randomSwiftBic();
    const receiverBic = randomSwiftBic();
    const custodian   = randFrom(CUSTODIANS);
    const stmtDate    = formatDateSwift(new Date(recs[0].ValueDate    || recs[0].TransactionDate));
    const postDate    = formatDateSwift(new Date(recs[0].PostingDate  || recs[0].ValueDate || recs[0].TransactionDate));
    const stmtNum     = String(randInt(1, 99999)).padStart(5, '0');
    const semeRef     = `STMT${stmtNum}${stmtDate}`;

    let msg = '';
    msg += `{1:F01${senderBic}AXXX0000000000}`;
    msg += `{2:O535${stmtDate}1200${receiverBic}AXXX${stmtDate}1200N}`;
    msg += `{4:\n`;

    // Block A — General
    msg += `:16R:GENL\n`;
    msg += `:28E:${stmtNum}/LAST\n`;
    msg += `:20C:SEME//${semeRef}\n`;
    msg += `:23G:NEWM\n`;
    msg += `:98A:STAT//${stmtDate}\n`;
    msg += `:98A:POST//${postDate}\n`;
    msg += `:22F:SFRE//DAIL\n`;
    msg += `:22F:CODE//SECU\n`;
    msg += `:97A:SAFE//${acct}\n`;
    msg += `:17B:ACTI//Y\n`;
    msg += `:16S:GENL\n`;

    // Block B — Sub-safekeeping account
    msg += `:16R:SUBSAFE\n`;
    msg += `:97A:SAFE//${acct}\n`;

    // One FIN block per record (holding)
    for (const rec of recs) {
      const sec      = randFrom(SECURITIES);
      const price    = (Math.random() * 200 + 10).toFixed(4);
      const qty      = Math.max(1, Math.round(parseFloat(rec.Amount) / parseFloat(price)));
      const mktVal   = (qty * parseFloat(price)).toFixed(2);

      msg += `:16R:FIN\n`;
      msg += `:35B:ISIN ${sec.isin}\n`;
      msg += `/${sec.name}\n`;
      msg += `:16R:FIAN\n`;
      msg += `:90B:MRKT//ACTU/${rec.Currency}${formatAmountSwift(parseFloat(price))}\n`;
      msg += `:94B:SAFE//SHHE/${custodian}\n`;
      msg += `:16S:FIAN\n`;
      msg += `:93B:AGGR//FAMT/${formatAmountSwift(parseFloat(mktVal))}\n`;
      msg += `:16S:FIN\n`;
    }

    msg += `:16S:SUBSAFE\n`;
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

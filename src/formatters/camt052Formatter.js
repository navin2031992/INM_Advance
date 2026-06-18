'use strict';

/**
 * ISO 20022 camt.052 Formatter — Bank-to-Customer Account Report (intraday).
 *
 * camt.052 is the intraday companion to camt.053.  It is used for same-day
 * or near-real-time reporting where final settlement may still be pending.
 * Unlike camt.053 (end-of-day statement), entries here may carry status
 * PDNG (pending) as well as BOOK (booked).  Balance elements are omitted
 * because the intraday position is not yet final.
 *
 * Schema: urn:iso:std:iso:20022:tech:xsd:camt.052.001.08
 */

const { formatDateTimeISO } = require('../utils/randomizer');

function xmlEsc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatStatement(records) {
  if (records.length === 0) return '';

  const accountMap = {};
  for (const rec of records) {
    const k = rec.BankAccountNumber;
    if (!accountMap[k]) accountMap[k] = [];
    accountMap[k].push(rec);
  }

  const documents = [];
  let msgCounter  = 1;

  for (const [account, recs] of Object.entries(accountMap)) {
    const currency  = recs[0].Currency;
    const createdAt = formatDateTimeISO(new Date());
    const msgId     = `CAMT052-${String(msgCounter++).padStart(8, '0')}`;
    const rptId     = `RPT-${msgId}`;
    const sorted    = [...recs].sort((a, b) => a.TransactionDate.localeCompare(b.TransactionDate));
    const rptDate   = sorted[0].TransactionDate;

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08"\n';
    xml += '          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n';
    xml += '          xsi:schemaLocation="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08 camt.052.001.08.xsd">\n';
    xml += '  <BkToCstmrAcctRpt>\n';
    xml += '    <GrpHdr>\n';
    xml += `      <MsgId>${xmlEsc(msgId)}</MsgId>\n`;
    xml += `      <CreDtTm>${xmlEsc(createdAt)}</CreDtTm>\n`;
    xml += '    </GrpHdr>\n';
    xml += '    <Rpt>\n';
    xml += `      <Id>${xmlEsc(rptId)}</Id>\n`;
    xml += `      <CreDtTm>${xmlEsc(createdAt)}</CreDtTm>\n`;
    xml += `      <FrToDt><FrDtTm>${rptDate}T00:00:00+00:00</FrDtTm><ToDtTm>${rptDate}T23:59:59+00:00</ToDtTm></FrToDt>\n`;
    xml += '      <Acct>\n';
    xml += `        <Id><IBAN>${xmlEsc(account)}</IBAN></Id>\n`;
    xml += `        <Ccy>${xmlEsc(currency)}</Ccy>\n`;
    xml += '      </Acct>\n';
    xml += '      <TxsSummry>\n';
    xml += `        <TtlNtries><NbOfNtries>${recs.length}</NbOfNtries></TtlNtries>\n`;
    xml += '      </TxsSummry>\n';

    for (const rec of sorted) {
      const cdtDbt = rec.DebitCreditIndicator === 'C' ? 'CRDT' : 'DBIT';
      const amt    = parseFloat(rec.Amount);
      // Intraday: ~30 % of entries are still pending (just arrived, not yet settled)
      const status = Math.random() > 0.3 ? 'BOOK' : 'PDNG';

      xml += '      <Ntry>\n';
      xml += `        <NtryRef>${xmlEsc(rec.StatementID)}</NtryRef>\n`;
      xml += `        <Amt Ccy="${xmlEsc(rec.Currency)}">${amt.toFixed(2)}</Amt>\n`;
      xml += `        <CdtDbtInd>${cdtDbt}</CdtDbtInd>\n`;
      xml += `        <Sts><Cd>${status}</Cd></Sts>\n`;
      xml += `        <BookgDt><Dt>${xmlEsc(rec.TransactionDate)}</Dt></BookgDt>\n`;
      xml += `        <ValDt><Dt>${xmlEsc(rec.ValueDate)}</Dt></ValDt>\n`;
      xml += `        <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>RCDT</Cd><SubFmlyCd>ESCT</SubFmlyCd></Fmly></Domn></BkTxCd>\n`;
      xml += '        <NtryDtls><TxDtls>\n';
      xml += '          <Refs>\n';
      xml += `            <EndToEndId>${xmlEsc(rec.ReferenceNumber)}</EndToEndId>\n`;
      xml += `            <TxId>${xmlEsc(rec.BankReference)}</TxId>\n`;
      xml += '          </Refs>\n';
      xml += `          <RmtInf><Ustrd>${xmlEsc(rec.Description)}</Ustrd></RmtInf>\n`;
      xml += '        </TxDtls></NtryDtls>\n';
      xml += '      </Ntry>\n';
    }

    xml += '    </Rpt>\n';
    xml += '  </BkToCstmrAcctRpt>\n';
    xml += '</Document>';

    documents.push(xml);
  }

  return documents.join('\n\n<!-- ===== NEXT ACCOUNT ===== -->\n\n');
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

module.exports = { formatLedger, formatStatement, ext: 'xml' };

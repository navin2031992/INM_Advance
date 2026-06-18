'use strict';

/**
 * ISO 20022 camt.054 Formatter — Bank-to-Customer Debit/Credit Notification.
 *
 * camt.054 completes the camt.05x suite:
 *   camt.052  Intraday Account Report         (current activity, may be pending)
 *   camt.053  Bank-to-Customer Statement       (end-of-day, settled)
 *   camt.054  Debit/Credit Notification        ← this file
 *
 * camt.054 is sent per individual transaction — usually for high-value
 * credits/debits that need immediate notification rather than waiting for the
 * end-of-day camt.053 statement.
 *
 * IntelliMatch use case:
 *   Reconcile outstanding payment instructions (pain.001 / MT103) against
 *   real-time debit/credit notifications as funds actually move.
 *
 * Schema: urn:iso:std:iso:20022:tech:xsd:camt.054.001.08
 * One Ntfctn block per bank account. One Ntry per transaction.
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
    const msgId     = `CAMT054-${String(msgCounter++).padStart(8, '0')}`;
    const ntfctnId  = `NTF-${msgId}`;
    const sorted    = [...recs].sort((a, b) => a.TransactionDate.localeCompare(b.TransactionDate));

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08"\n';
    xml += '          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n';
    xml += '          xsi:schemaLocation="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08 camt.054.001.08.xsd">\n';
    xml += '  <BkToCstmrDbtCdtNtfctn>\n';
    xml += '    <GrpHdr>\n';
    xml += `      <MsgId>${xmlEsc(msgId)}</MsgId>\n`;
    xml += `      <CreDtTm>${xmlEsc(createdAt)}</CreDtTm>\n`;
    xml += '    </GrpHdr>\n';
    xml += '    <Ntfctn>\n';
    xml += `      <Id>${xmlEsc(ntfctnId)}</Id>\n`;
    xml += `      <CreDtTm>${xmlEsc(createdAt)}</CreDtTm>\n`;
    xml += '      <Acct>\n';
    xml += `        <Id><IBAN>${xmlEsc(account)}</IBAN></Id>\n`;
    xml += `        <Ccy>${xmlEsc(currency)}</Ccy>\n`;
    xml += '      </Acct>\n';

    for (const rec of sorted) {
      const cdtDbt = rec.DebitCreditIndicator === 'C' ? 'CRDT' : 'DBIT';
      const amt    = parseFloat(rec.Amount);

      xml += '      <Ntry>\n';
      xml += `        <NtryRef>${xmlEsc(rec.StatementID)}</NtryRef>\n`;
      xml += `        <Amt Ccy="${xmlEsc(rec.Currency)}">${amt.toFixed(2)}</Amt>\n`;
      xml += `        <CdtDbtInd>${cdtDbt}</CdtDbtInd>\n`;
      xml += `        <Sts><Cd>BOOK</Cd></Sts>\n`;
      xml += `        <BookgDt><Dt>${xmlEsc(rec.TransactionDate)}</Dt></BookgDt>\n`;
      xml += `        <ValDt><Dt>${xmlEsc(rec.ValueDate)}</Dt></ValDt>\n`;
      xml += `        <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>RCDT</Cd><SubFmlyCd>ESCT</SubFmlyCd></Fmly></Domn></BkTxCd>\n`;
      xml += '        <NtryDtls><TxDtls>\n';
      xml += '          <Refs>\n';
      xml += `            <EndToEndId>${xmlEsc(rec.ReferenceNumber)}</EndToEndId>\n`;
      xml += `            <TxId>${xmlEsc(rec.BankReference)}</TxId>\n`;
      xml += '          </Refs>\n';
      xml += `          <AmtDtls><InstdAmt><Amt Ccy="${xmlEsc(rec.Currency)}">${amt.toFixed(2)}</Amt></InstdAmt></AmtDtls>\n`;
      xml += `          <RmtInf><Ustrd>${xmlEsc(rec.Description)}</Ustrd></RmtInf>\n`;
      xml += '        </TxDtls></NtryDtls>\n';
      xml += '      </Ntry>\n';
    }

    xml += '    </Ntfctn>\n';
    xml += '  </BkToCstmrDbtCdtNtfctn>\n';
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

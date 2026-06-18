'use strict';

/**
 * ISO 20022 pacs.008 Formatter — FI-to-FI Customer Credit Transfer.
 *
 * pacs.008 is the SWIFT MX replacement for MT103.
 * SWIFT mandated ISO 20022 for all cross-border payments from November 2023
 * under the CBPR+ (Cross-Border Payments and Reporting Plus) programme.
 *
 * IntelliMatch use case:
 *   Banks receiving SWIFT MX payments import pacs.008 files.
 *   IntelliMatch reconciles pacs.008 entries against internal ledger debits
 *   and against camt.053 / camt.054 confirmations.
 *
 * Schema: urn:iso:std:iso:20022:tech:xsd:pacs.008.001.09
 *
 * Structure:
 *   GrpHdr — message header (1 per file)
 *   CdtTrfTxInf — one block per payment transaction
 *
 * Key difference from pain.001:
 *   - pain.001 = Corporate → Bank (customer-initiated)
 *   - pacs.008  = Bank → Bank (FI-to-FI, interbank clearing)
 *   - pacs.008 includes UETR (Unique End-to-end Transaction Reference) per SWIFT gpi
 */

const {
  formatDateTimeISO,
  randomSwiftBic,
  randomCounterparty
} = require('../utils/randomizer');

const IBANS = [
  'GB29NWBK60161331926819',
  'DE89370400440532013000',
  'FR7614508059144921279050070',
  'NL91ABNA0417164300',
  'IT60X0542811101000000123456',
  'US123456789012345678',
  'CH9300762011623852957',
  'AU123456789012345678',
];

function xmlEsc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateUETR(seed) {
  // RFC 4122 UUID v4 format — used as SWIFT gpi UETR
  const h = seed.toString(16).padStart(8, '0');
  return `${h.slice(0,8)}-${h.slice(0,4)}-4${h.slice(1,4)}-a${h.slice(0,3)}-${h.padEnd(12,'0').slice(0,12)}`;
}

function randIBAN() {
  return IBANS[Math.floor(Math.random() * IBANS.length)];
}

function buildDoc(recs, msgId, currency) {
  const createdAt = formatDateTimeISO(new Date());
  const txCount   = recs.length;
  const ctrlSum   = recs.reduce((s, r) => {
    return s + parseFloat(r.CreditAmount !== '0.00' ? r.CreditAmount : r.DebitAmount);
  }, 0);
  const sttlmDt   = recs[0].PostingDate;

  // Interbank parties
  const instgAgentBIC = randomSwiftBic();   // Instructing Agent (sender bank)
  const instdAgentBIC = randomSwiftBic();   // Instructed Agent (receiver bank)

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.09"\n';
  xml += '          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n';
  xml += '          xsi:schemaLocation="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.09 pacs.008.001.09.xsd">\n';
  xml += '  <FIToFICstmrCdtTrf>\n';
  xml += '    <GrpHdr>\n';
  xml += `      <MsgId>${xmlEsc(msgId)}</MsgId>\n`;
  xml += `      <CreDtTm>${xmlEsc(createdAt)}</CreDtTm>\n`;
  xml += `      <NbOfTxs>${txCount}</NbOfTxs>\n`;
  xml += `      <CtrlSum>${ctrlSum.toFixed(2)}</CtrlSum>\n`;
  xml += `      <SttlmInf><SttlmMtd>CLRG</SttlmMtd></SttlmInf>\n`;
  xml += `      <InstgAgt><FinInstnId><BICFI>${xmlEsc(instgAgentBIC)}</BICFI></FinInstnId></InstgAgt>\n`;
  xml += `      <InstdAgt><FinInstnId><BICFI>${xmlEsc(instdAgentBIC)}</BICFI></FinInstnId></InstdAgt>\n`;
  xml += '    </GrpHdr>\n';

  recs.forEach((rec, idx) => {
    const amt       = parseFloat(rec.CreditAmount !== '0.00' ? rec.CreditAmount : rec.DebitAmount);
    const e2eId     = rec.ReferenceNumber;
    const txId      = rec.TxnID || rec.StatementID;
    const uetr      = generateUETR(idx + 1);
    const dbtrIBAN  = randIBAN();
    const cdtrIBAN  = randIBAN();
    const dbtrBIC   = randomSwiftBic();
    const cdtrBIC   = randomSwiftBic();
    const dbtrName  = randomCounterparty();
    const cdtrName  = randomCounterparty();
    const remit     = rec.Description;

    xml += '    <CdtTrfTxInf>\n';
    xml += '      <PmtId>\n';
    xml += `        <InstrId>${xmlEsc(txId)}</InstrId>\n`;
    xml += `        <EndToEndId>${xmlEsc(e2eId)}</EndToEndId>\n`;
    xml += `        <UETR>${xmlEsc(uetr)}</UETR>\n`;
    xml += '      </PmtId>\n';
    xml += '      <IntrBkSttlmAmt Ccy="' + xmlEsc(currency) + '">' + amt.toFixed(2) + '</IntrBkSttlmAmt>\n';
    xml += `      <IntrBkSttlmDt>${xmlEsc(sttlmDt)}</IntrBkSttlmDt>\n`;
    xml += `      <InstgAgt><FinInstnId><BICFI>${xmlEsc(dbtrBIC)}</BICFI></FinInstnId></InstgAgt>\n`;
    xml += `      <InstdAgt><FinInstnId><BICFI>${xmlEsc(cdtrBIC)}</BICFI></FinInstnId></InstdAgt>\n`;
    xml += `      <Dbtr><Nm>${xmlEsc(dbtrName)}</Nm></Dbtr>\n`;
    xml += `      <DbtrAcct><Id><IBAN>${xmlEsc(dbtrIBAN)}</IBAN></Id></DbtrAcct>\n`;
    xml += `      <DbtrAgt><FinInstnId><BICFI>${xmlEsc(dbtrBIC)}</BICFI></FinInstnId></DbtrAgt>\n`;
    xml += `      <CdtrAgt><FinInstnId><BICFI>${xmlEsc(cdtrBIC)}</BICFI></FinInstnId></CdtrAgt>\n`;
    xml += `      <Cdtr><Nm>${xmlEsc(cdtrName)}</Nm></Cdtr>\n`;
    xml += `      <CdtrAcct><Id><IBAN>${xmlEsc(cdtrIBAN)}</IBAN></Id></CdtrAcct>\n`;
    xml += `      <RmtInf><Ustrd>${xmlEsc(remit)}</Ustrd></RmtInf>\n`;
    xml += '    </CdtTrfTxInf>\n';
  });

  xml += '  </FIToFICstmrCdtTrf>\n';
  xml += '</Document>';
  return xml;
}

function formatLedger(records) {
  if (records.length === 0) return '';

  const groupMap = {};
  for (const rec of records) {
    const key = `${rec.LedgerAccount}::${rec.Currency}`;
    if (!groupMap[key]) groupMap[key] = [];
    groupMap[key].push(rec);
  }

  const docs   = [];
  let counter  = 1;
  for (const [key, recs] of Object.entries(groupMap)) {
    const currency = key.split('::')[1];
    docs.push(buildDoc(recs, `PACS008-${String(counter++).padStart(8, '0')}`, currency));
  }
  return docs.join('\n\n<!-- ===== NEXT MESSAGE ===== -->\n\n');
}

function formatStatement(records) {
  if (records.length === 0) return '';
  return formatLedger(records.map(r => ({
    TxnID:           r.StatementID,
    LedgerAccount:   r.BankAccountNumber,
    TransactionDate: r.TransactionDate,
    PostingDate:     r.ValueDate,
    Currency:        r.Currency,
    DebitAmount:     r.DebitCreditIndicator === 'D' ? r.Amount : '0.00',
    CreditAmount:    r.DebitCreditIndicator === 'C' ? r.Amount : '0.00',
    Description:     r.Description,
    ReferenceNumber: r.ReferenceNumber,
    MatchType:       r.MatchType,
  })));
}

module.exports = { formatLedger, formatStatement, ext: 'xml' };

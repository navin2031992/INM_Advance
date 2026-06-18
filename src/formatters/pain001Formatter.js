'use strict';

/**
 * ISO 20022 pain.001 Formatter — Customer Credit Transfer Initiation.
 *
 * pain.001 is the payment instruction file a corporate sends to its bank.
 * It is the "outbound" side of reconciliation — these payments later appear
 * as entries on the bank statement (camt.053 / MT940 / BAI2).
 *
 * Schema: urn:iso:std:iso:20022:tech:xsd:pain.001.001.09
 *
 * One XML document per debtor account / currency combination.
 * All entries in a group form a single PmtInf (payment information) block.
 */

const { formatDateTimeISO, randomSwiftBic, randomCounterparty } = require('../utils/randomizer');

const CREDITOR_IBANS = [
  'GB29NWBK60161331926819',
  'DE89370400440532013000',
  'FR7614508059144921279050070',
  'NL91ABNA0417164300',
  'IT60X0542811101000000123456',
  'ES9121000418450200051332',
  'BE68539007547034',
  'CH9300762011623852957',
  'AT611904300234573201',
  'SE4550000000058398257466',
];

const DEBTOR_IBAN = 'GB29NWBK60161331926819';
const DEBTOR_BIC  = 'HSBCGB2L';

function xmlEsc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function randIBAN() {
  return CREDITOR_IBANS[Math.floor(Math.random() * CREDITOR_IBANS.length)];
}

function buildDoc(recs, msgId, currency) {
  const createdAt = formatDateTimeISO(new Date());
  const pmtInfId  = `PMTINF-${msgId}`;
  const txCount   = recs.length;
  const ctrlSum   = recs.reduce((sum, r) => {
    return sum + parseFloat(r.CreditAmount !== '0.00' ? r.CreditAmount : r.DebitAmount);
  }, 0);
  const reqExcDt  = recs[0].PostingDate;

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"\n';
  xml += '          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n';
  xml += '          xsi:schemaLocation="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09 pain.001.001.09.xsd">\n';
  xml += '  <CstmrCdtTrfInitn>\n';
  xml += '    <GrpHdr>\n';
  xml += `      <MsgId>${xmlEsc(msgId)}</MsgId>\n`;
  xml += `      <CreDtTm>${xmlEsc(createdAt)}</CreDtTm>\n`;
  xml += `      <NbOfTxs>${txCount}</NbOfTxs>\n`;
  xml += `      <CtrlSum>${ctrlSum.toFixed(2)}</CtrlSum>\n`;
  xml += '      <InitgPty><Nm>IntelliMatch Corp</Nm></InitgPty>\n';
  xml += '    </GrpHdr>\n';
  xml += '    <PmtInf>\n';
  xml += `      <PmtInfId>${xmlEsc(pmtInfId)}</PmtInfId>\n`;
  xml += '      <PmtMtd>TRF</PmtMtd>\n';
  xml += `      <NbOfTxs>${txCount}</NbOfTxs>\n`;
  xml += `      <CtrlSum>${ctrlSum.toFixed(2)}</CtrlSum>\n`;
  xml += '      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>\n';
  xml += `      <ReqdExctnDt><Dt>${xmlEsc(reqExcDt)}</Dt></ReqdExctnDt>\n`;
  xml += '      <Dbtr><Nm>IntelliMatch Corp</Nm></Dbtr>\n';
  xml += `      <DbtrAcct><Id><IBAN>${xmlEsc(DEBTOR_IBAN)}</IBAN></Id><Ccy>${xmlEsc(currency)}</Ccy></DbtrAcct>\n`;
  xml += `      <DbtrAgt><FinInstnId><BICFI>${xmlEsc(DEBTOR_BIC)}</BICFI></FinInstnId></DbtrAgt>\n`;

  for (const rec of recs) {
    const amt      = parseFloat(rec.CreditAmount !== '0.00' ? rec.CreditAmount : rec.DebitAmount);
    const credIBAN = randIBAN();
    const credBIC  = randomSwiftBic();
    const credName = randomCounterparty();
    const e2eId    = rec.ReferenceNumber;
    const remit    = rec.Description;

    xml += '      <CdtTrfTxInf>\n';
    xml += `        <PmtId><EndToEndId>${xmlEsc(e2eId)}</EndToEndId></PmtId>\n`;
    xml += `        <Amt><InstdAmt Ccy="${xmlEsc(currency)}">${amt.toFixed(2)}</InstdAmt></Amt>\n`;
    xml += `        <CdtrAgt><FinInstnId><BICFI>${xmlEsc(credBIC)}</BICFI></FinInstnId></CdtrAgt>\n`;
    xml += `        <Cdtr><Nm>${xmlEsc(credName)}</Nm></Cdtr>\n`;
    xml += `        <CdtrAcct><Id><IBAN>${xmlEsc(credIBAN)}</IBAN></Id></CdtrAcct>\n`;
    xml += `        <RmtInf><Ustrd>${xmlEsc(remit)}</Ustrd></RmtInf>\n`;
    xml += '      </CdtTrfTxInf>\n';
  }

  xml += '    </PmtInf>\n';
  xml += '  </CstmrCdtTrfInitn>\n';
  xml += '</Document>';
  return xml;
}

function formatLedger(records) {
  if (records.length === 0) return '';

  // Group by debtor account + currency so each group is one payment batch
  const groupMap = {};
  for (const rec of records) {
    const key = `${rec.LedgerAccount}::${rec.Currency}`;
    if (!groupMap[key]) groupMap[key] = [];
    groupMap[key].push(rec);
  }

  const docs    = [];
  let counter   = 1;
  for (const [key, recs] of Object.entries(groupMap)) {
    const currency = key.split('::')[1];
    const msgId    = `PAIN001-${String(counter++).padStart(8, '0')}`;
    docs.push(buildDoc(recs, msgId, currency));
  }

  return docs.join('\n\n<!-- ===== NEXT BATCH ===== -->\n\n');
}

function formatStatement(records) {
  if (records.length === 0) return '';
  // Map statement fields to ledger shape so buildDoc can handle both sides
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

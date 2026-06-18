'use strict';

/**
 * ISO 20022 pain.002 Formatter — Customer Payment Status Report.
 *
 * pain.002 is the bank's response to a pain.001 payment instruction.
 * The bank sends it back to confirm acceptance, rejection, or pending status
 * for each credit transfer in the original pain.001 message.
 *
 * IntelliMatch use case:
 *   pain.001 (what you sent) ↔ pain.002 (bank's acceptance/rejection)
 *   Reconciling payment instructions against status reports is a core
 *   IntelliMatch scenario for straight-through processing (STP) testing.
 *
 * Schema: urn:iso:std:iso:20022:tech:xsd:pain.002.001.11
 *
 * Transaction status codes used:
 *   ACCP  — Accepted by the bank (will be processed)
 *   ACSC  — Accepted Settlement Completed (funds moved)
 *   RJCT  — Rejected (with reason code)
 *   PDNG  — Pending (awaiting further processing)
 *
 * Rejection reason codes (SWIFT pacs.002 standard):
 *   AC01  — Incorrect Account Number
 *   AC06  — Blocked Account
 *   AM04  — Insufficient Funds
 *   FF01  — Invalid File Format
 *   MS03  — Not Specified Reason
 *   RC01  — Bank Identifier Incorrect
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

// Weighted status distribution matching typical bank STP rates
const STATUS_WEIGHTS = [
  { status: 'ACSC', weight: 75 },  // 75% — accepted and settled
  { status: 'ACCP', weight: 15 },  // 15% — accepted, pending settlement
  { status: 'PDNG', weight: 5  },  // 5%  — pending further checks
  { status: 'RJCT', weight: 5  },  // 5%  — rejected
];

const REJECT_CODES = ['AC01', 'AC06', 'AM04', 'FF01', 'MS03', 'RC01'];

function pickStatus() {
  const roll = Math.random() * 100;
  let cumulative = 0;
  for (const { status, weight } of STATUS_WEIGHTS) {
    cumulative += weight;
    if (roll < cumulative) return status;
  }
  return 'ACSC';
}

function buildDoc(recs, msgId, origMsgId, currency) {
  const createdAt = formatDateTimeISO(new Date());
  const txCount   = recs.length;

  // Determine group status: PART if some rejected, ACCP if all accepted
  let groupStatus = 'ACCP';

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.002.001.11"\n';
  xml += '          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n';
  xml += '          xsi:schemaLocation="urn:iso:std:iso:20022:tech:xsd:pain.002.001.11 pain.002.001.11.xsd">\n';
  xml += '  <CstmrPmtStsRpt>\n';
  xml += '    <GrpHdr>\n';
  xml += `      <MsgId>${xmlEsc(msgId)}</MsgId>\n`;
  xml += `      <CreDtTm>${xmlEsc(createdAt)}</CreDtTm>\n`;
  xml += `      <InitgPty><Nm>IntelliMatch Bank</Nm></InitgPty>\n`;
  xml += `      <DbtrAgt><FinInstnId><BICFI>HSBCGB2LXXX</BICFI></FinInstnId></DbtrAgt>\n`;
  xml += '    </GrpHdr>\n';
  xml += '    <OrgnlGrpInfAndSts>\n';
  xml += `      <OrgnlMsgId>${xmlEsc(origMsgId)}</OrgnlMsgId>\n`;
  xml += `      <OrgnlMsgNmId>pain.001.001.09</OrgnlMsgNmId>\n`;
  xml += `      <OrgnlNbOfTxs>${txCount}</OrgnlNbOfTxs>\n`;
  xml += `      <OrgnlCtrlSum>${recs.reduce((s, r) => s + parseFloat(r.CreditAmount !== '0.00' ? r.CreditAmount : r.DebitAmount), 0).toFixed(2)}</OrgnlCtrlSum>\n`;
  xml += `      <GrpSts>${groupStatus}</GrpSts>\n`;
  xml += '    </OrgnlGrpInfAndSts>\n';

  let rejCount = 0;
  for (const rec of recs) {
    const amt      = parseFloat(rec.CreditAmount !== '0.00' ? rec.CreditAmount : rec.DebitAmount);
    const txStatus = pickStatus();
    const e2eId    = rec.ReferenceNumber;
    const txId     = rec.TxnID || rec.StatementID || e2eId;

    if (txStatus === 'RJCT') rejCount++;

    xml += '    <OrgnlPmtInfAndSts>\n';
    xml += `      <OrgnlPmtInfId>PMTINF-${xmlEsc(txId)}</OrgnlPmtInfId>\n`;
    xml += `      <PmtInfSts>${txStatus}</PmtInfSts>\n`;
    xml += '      <TxInfAndSts>\n';
    xml += `        <OrgnlEndToEndId>${xmlEsc(e2eId)}</OrgnlEndToEndId>\n`;
    xml += `        <OrgnlTxId>${xmlEsc(txId)}</OrgnlTxId>\n`;
    xml += `        <TxSts>${txStatus}</TxSts>\n`;

    if (txStatus === 'RJCT') {
      const rjctCode = REJECT_CODES[Math.floor(Math.random() * REJECT_CODES.length)];
      xml += '        <StsRsnInf>\n';
      xml += `          <Rsn><Cd>${rjctCode}</Cd></Rsn>\n`;
      xml += `          <AddtlInf>Payment rejected — ${rjctCode}</AddtlInf>\n`;
      xml += '        </StsRsnInf>\n';
    }

    xml += `        <OrgnlTxRef>\n`;
    xml += `          <Amt><InstdAmt Ccy="${xmlEsc(currency)}">${amt.toFixed(2)}</InstdAmt></Amt>\n`;
    xml += `          <ReqdExctnDt><Dt>${xmlEsc(rec.PostingDate || rec.TransactionDate)}</Dt></ReqdExctnDt>\n`;
    xml += `          <RmtInf><Ustrd>${xmlEsc(rec.Description)}</Ustrd></RmtInf>\n`;
    xml += `        </OrgnlTxRef>\n`;
    xml += '      </TxInfAndSts>\n';
    xml += '    </OrgnlPmtInfAndSts>\n';
  }

  xml += '  </CstmrPmtStsRpt>\n';
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

  const docs  = [];
  let counter = 1;
  for (const [key, recs] of Object.entries(groupMap)) {
    const currency  = key.split('::')[1];
    const msgId     = `PAIN002-${String(counter).padStart(8, '0')}`;
    const origMsgId = `PAIN001-${String(counter++).padStart(8, '0')}`;
    docs.push(buildDoc(recs, msgId, origMsgId, currency));
  }
  return docs.join('\n\n<!-- ===== NEXT STATUS REPORT ===== -->\n\n');
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

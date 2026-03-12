'use strict';

/**
 * ISO 20022 camt.053 Formatter — Bank-to-Customer Statement.
 *
 * Produces valid camt.053.001.06 XML messages grouped by bank account.
 * One XML document per account, all transactions as <Ntry> elements.
 *
 * Schema: urn:iso:std:iso:20022:tech:xsd:camt.053.001.06
 */

const { formatDateTimeISO } = require('../utils/randomizer');

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatStatement(records) {
  if (records.length === 0) return '';

  // Group by bank account
  const accountMap = {};
  for (const rec of records) {
    const acct = rec.BankAccountNumber;
    if (!accountMap[acct]) accountMap[acct] = [];
    accountMap[acct].push(rec);
  }

  const documents = [];
  let msgCounter = 1;

  for (const [account, recs] of Object.entries(accountMap)) {
    const currency   = recs[0].Currency;
    const createdAt  = formatDateTimeISO(new Date());
    const msgId      = `CAMT053-${String(msgCounter++).padStart(8, '0')}`;
    const stmtId     = `STMT-${msgId}`;

    // Calculate balances
    const sorted = [...recs].sort((a, b) => a.TransactionDate.localeCompare(b.TransactionDate));
    let openBal  = Math.round(Math.random() * 500000 * 100) / 100;
    let closeBal = openBal;
    for (const r of sorted) {
      const amt = parseFloat(r.Amount);
      if (r.DebitCreditIndicator === 'C') closeBal += amt;
      else closeBal -= amt;
    }

    const fromDate = sorted[0].TransactionDate;
    const toDate   = sorted[sorted.length - 1].TransactionDate;

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.06"\n';
    xml += '          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n';
    xml += '          xsi:schemaLocation="urn:iso:std:iso:20022:tech:xsd:camt.053.001.06 camt.053.001.06.xsd">\n';
    xml += '  <BkToCstmrStmt>\n';
    xml += '    <GrpHdr>\n';
    xml += `      <MsgId>${xmlEscape(msgId)}</MsgId>\n`;
    xml += `      <CreDtTm>${xmlEscape(createdAt)}</CreDtTm>\n`;
    xml += '    </GrpHdr>\n';
    xml += '    <Stmt>\n';
    xml += `      <Id>${xmlEscape(stmtId)}</Id>\n`;
    xml += `      <StmtPgntn><PgNb>1</PgNb><LastPgInd>true</LastPgInd></StmtPgntn>\n`;
    xml += `      <CreDtTm>${xmlEscape(createdAt)}</CreDtTm>\n`;
    xml += `      <FrToDt><FrDtTm>${fromDate}T00:00:00+00:00</FrDtTm><ToDtTm>${toDate}T23:59:59+00:00</ToDtTm></FrToDt>\n`;
    xml += '      <Acct>\n';
    xml += '        <Id>\n';
    xml += `          <IBAN>${xmlEscape(account)}</IBAN>\n`;
    xml += '        </Id>\n';
    xml += `        <Ccy>${xmlEscape(currency)}</Ccy>\n`;
    xml += '      </Acct>\n';
    xml += '      <TxsSummry>\n';
    xml += `        <TtlNtries><NbOfNtries>${recs.length}</NbOfNtries></TtlNtries>\n`;
    xml += '      </TxsSummry>\n';

    // Opening balance
    xml += '      <Bal>\n';
    xml += '        <Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp>\n';
    xml += `        <Amt Ccy="${xmlEscape(currency)}">${openBal.toFixed(2)}</Amt>\n`;
    xml += `        <CdtDbtInd>${openBal >= 0 ? 'CRDT' : 'DBIT'}</CdtDbtInd>\n`;
    xml += `        <Dt><Dt>${fromDate}</Dt></Dt>\n`;
    xml += '      </Bal>\n';

    // Closing balance
    xml += '      <Bal>\n';
    xml += '        <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>\n';
    xml += `        <Amt Ccy="${xmlEscape(currency)}">${Math.abs(closeBal).toFixed(2)}</Amt>\n`;
    xml += `        <CdtDbtInd>${closeBal >= 0 ? 'CRDT' : 'DBIT'}</CdtDbtInd>\n`;
    xml += `        <Dt><Dt>${toDate}</Dt></Dt>\n`;
    xml += '      </Bal>\n';

    // Entries
    for (const rec of sorted) {
      const cdtDbt = rec.DebitCreditIndicator === 'C' ? 'CRDT' : 'DBIT';
      const amt    = parseFloat(rec.Amount);

      xml += '      <Ntry>\n';
      xml += `        <NtryRef>${xmlEscape(rec.StatementID)}</NtryRef>\n`;
      xml += `        <Amt Ccy="${xmlEscape(rec.Currency)}">${amt.toFixed(2)}</Amt>\n`;
      xml += `        <CdtDbtInd>${cdtDbt}</CdtDbtInd>\n`;
      xml += `        <Sts><Cd>BOOK</Cd></Sts>\n`;
      xml += `        <BookgDt><Dt>${xmlEscape(rec.TransactionDate)}</Dt></BookgDt>\n`;
      xml += `        <ValDt><Dt>${xmlEscape(rec.ValueDate)}</Dt></ValDt>\n`;
      xml += `        <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>RCDT</Cd><SubFmlyCd>ESCT</SubFmlyCd></Fmly></Domn></BkTxCd>\n`;
      xml += '        <NtryDtls>\n';
      xml += '          <TxDtls>\n';
      xml += '            <Refs>\n';
      xml += `              <EndToEndId>${xmlEscape(rec.ReferenceNumber)}</EndToEndId>\n`;
      xml += `              <TxId>${xmlEscape(rec.BankReference)}</TxId>\n`;
      xml += '            </Refs>\n';
      xml += `            <RmtInf><Ustrd>${xmlEscape(rec.Description)}</Ustrd></RmtInf>\n`;
      xml += '          </TxDtls>\n';
      xml += '        </NtryDtls>\n';
      xml += '      </Ntry>\n';
    }

    xml += '    </Stmt>\n';
    xml += '  </BkToCstmrStmt>\n';
    xml += '</Document>';

    documents.push(xml);
  }

  return documents.join('\n\n<!-- ===== NEXT ACCOUNT ===== -->\n\n');
}

function formatLedger(records) {
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
    MatchType:            r.MatchType
  })));
}

module.exports = { formatLedger, formatStatement, ext: 'xml' };

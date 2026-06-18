'use strict';

/**
 * OFX (Open Financial Exchange) Formatter — version 2.2 XML.
 *
 * Used by QuickBooks, Sage, Quicken, and most business accounting tools
 * to import bank statement data for reconciliation.
 *
 * One OFX document per bank account. Statement amounts are signed:
 *   positive = credit (money received)
 *   negative = debit  (money paid out)
 */

function xmlEsc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ofxDt(isoDate) {
  // OFX datetime: YYYYMMDDHHMMSS
  return isoDate.replace(/-/g, '') + '120000';
}

function formatStatement(records) {
  if (records.length === 0) return '';

  // Group by bank account
  const accountMap = {};
  for (const rec of records) {
    const k = rec.BankAccountNumber;
    if (!accountMap[k]) accountMap[k] = [];
    accountMap[k].push(rec);
  }

  const dtServer  = ofxDt(new Date().toISOString().substring(0, 10));
  const documents = [];
  let trnUid = 1001;

  for (const [account, recs] of Object.entries(accountMap)) {
    const currency = recs[0].Currency;
    const sorted   = [...recs].sort((a, b) => a.TransactionDate.localeCompare(b.TransactionDate));
    const dtStart  = ofxDt(sorted[0].TransactionDate);
    const dtEnd    = ofxDt(sorted[sorted.length - 1].TransactionDate);

    // Running balance (open balance randomised + entries applied)
    let balance = Math.round(Math.random() * 500000 * 100) / 100;
    for (const r of sorted) {
      const amt = parseFloat(r.Amount);
      if (r.DebitCreditIndicator === 'C') balance += amt;
      else                                balance -= amt;
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<?OFX OFXHEADER:100 DATA:OFXSGML VERSION:220 SECURITY:NONE ENCODING:UTF-8 CHARSET:1252 COMPRESSION:NONE OLDFILEUID:NONE NEWFILEUID:NONE?>\n';
    xml += '<OFX>\n';
    xml += '  <SIGNONMSGSRSV1>\n';
    xml += '    <SONRS>\n';
    xml += '      <STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>\n';
    xml += `      <DTSERVER>${dtServer}</DTSERVER>\n`;
    xml += '      <LANGUAGE>ENG</LANGUAGE>\n';
    xml += '    </SONRS>\n';
    xml += '  </SIGNONMSGSRSV1>\n';
    xml += '  <BANKMSGSRSV1>\n';
    xml += '    <STMTTRNRS>\n';
    xml += `      <TRNUID>${trnUid++}</TRNUID>\n`;
    xml += '      <STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>\n';
    xml += '      <STMTRS>\n';
    xml += `        <CURDEF>${xmlEsc(currency)}</CURDEF>\n`;
    xml += '        <BANKACCTFROM>\n';
    xml += '          <BANKID>021000021</BANKID>\n';
    xml += `          <ACCTID>${xmlEsc(account)}</ACCTID>\n`;
    xml += '          <ACCTTYPE>CHECKING</ACCTTYPE>\n';
    xml += '        </BANKACCTFROM>\n';
    xml += '        <BANKTRANLIST>\n';
    xml += `          <DTSTART>${dtStart}</DTSTART>\n`;
    xml += `          <DTEND>${dtEnd}</DTEND>\n`;

    for (const rec of sorted) {
      const amt     = parseFloat(rec.Amount);
      const signAmt = rec.DebitCreditIndicator === 'C' ? amt : -amt;
      const trnType = rec.DebitCreditIndicator === 'C' ? 'CREDIT' : 'DEBIT';

      xml += '          <STMTTRN>\n';
      xml += `            <TRNTYPE>${trnType}</TRNTYPE>\n`;
      xml += `            <DTPOSTED>${ofxDt(rec.TransactionDate)}</DTPOSTED>\n`;
      xml += `            <DTAVAIL>${ofxDt(rec.ValueDate)}</DTAVAIL>\n`;
      xml += `            <TRNAMT>${signAmt.toFixed(2)}</TRNAMT>\n`;
      xml += `            <FITID>${xmlEsc(rec.StatementID)}</FITID>\n`;
      xml += `            <REFNUM>${xmlEsc(rec.ReferenceNumber)}</REFNUM>\n`;
      xml += `            <NAME>${xmlEsc(rec.Description.substring(0, 32))}</NAME>\n`;
      xml += `            <MEMO>${xmlEsc(rec.BankReference)}</MEMO>\n`;
      xml += '          </STMTTRN>\n';
    }

    xml += '        </BANKTRANLIST>\n';
    xml += '        <LEDGERBAL>\n';
    xml += `          <BALAMT>${balance.toFixed(2)}</BALAMT>\n`;
    xml += `          <DTASOF>${dtEnd}</DTASOF>\n`;
    xml += '        </LEDGERBAL>\n';
    xml += '      </STMTRS>\n';
    xml += '    </STMTTRNRS>\n';
    xml += '  </BANKMSGSRSV1>\n';
    xml += '</OFX>';

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

module.exports = { formatLedger, formatStatement, ext: 'ofx' };

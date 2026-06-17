# IntelliMatch MCP — Sample Prompts

Copy any prompt below directly into Claude Code, Roo Code, or Cline to generate financial test data.

---

## Discovery

```
What output formats are available in IntelliMatch?
```

```
List all reconciliation scenarios with descriptions.
```

```
Show me all available import schemas.
```

---

## Basic Generation

```
Generate 100 CSV records with mixed scenarios.
```

```
Generate 500 records in Excel format for both ledger and statement.
```

```
Generate 1000 pipe-delimited records and save to ./output.
```

```
Generate 200 JSON records using the perfect match scenario.
```

```
Generate 50 fixed-width records for the amountDiff scenario.
```

---

## Format-Specific

```
Generate 300 records in SWIFT MT940 format.
```

```
Generate 200 BAI2 cash management records.
```

```
Generate 500 records as ISO 20022 camt.053 XML.
```

```
Generate 100 records in every available format at once.
```

```
Generate 200 SWIFT MT103 customer credit transfer records.
```

```
Generate 150 MT535 statement of holdings records.
```

---

## Scenario-Specific

```
Generate 500 records for the oneToMany scenario (split payments).
```

```
Generate 300 manyToOne records — consolidation scenario.
```

```
Generate 200 unmatched ledger records only.
```

```
Generate 200 unmatched statement records only.
```

```
Generate 400 records with amount discrepancies (amountDiff scenario).
```

```
Generate 300 records where value dates differ by 1–5 days (dateDiff).
```

```
Generate 500 records combining perfect match and amountDiff scenarios.
```

```
Generate 1000 records across all 7 reconciliation scenarios equally.
```

---

## Import Schema — Ledger Side

```
Generate 500 CSV records using the General Ledger (GL) import schema.
```

```
Generate 300 records with the Accounts Payable (AP) import format in Excel.
```

```
Generate 400 records using the Accounts Receivable (AR) schema as pipe-delimited.
```

---

## Import Schema — Statement Side

```
Generate 500 records with the BANK statement import schema in CSV.
```

```
Generate 300 brokerage statement records (BROKERAGE schema) in JSON format.
```

```
Generate 400 custodian statement records (CUSTODIAN schema) in Excel.
```

---

## Combined Ledger + Statement Schemas

```
Generate 1000 records using GL ledger schema and BANK statement schema in CSV.
```

```
Generate 500 AP ledger records paired with BANK statement records in Excel.
```

```
Generate 300 AR ledger records with CUSTODIAN statement records in CSV.
```

```
Generate 500 GL:BANK records for the perfect match scenario in Excel.
```

```
Generate 1000 AP:BANK records for the manyToOne scenario in all formats.
```

```
Generate 200 AR:BROKERAGE records with the oneToMany scenario, 3-way splits.
```

---

## Date Formats

```
Generate 500 CSV records with dates formatted as DD/MM/YYYY.
```

```
Generate 300 records with compact YYYYMMDD date format for SAP import.
```

```
Generate 400 records using MM/DD/YYYY date format for US systems.
```

```
Generate 200 GL:BANK records with DDMMYYYY date format in pipe-delimited.
```

---

## Currency Override

```
Generate 500 records in EUR currency only.
```

```
Generate 300 AP records using GBP currency in Excel format.
```

```
Generate 200 BANK statement records with JPY currency.
```

---

## Scenario + Split / Consolidate Control

```
Generate 200 oneToMany records with exactly 3 statement entries per ledger group.
```

```
Generate 300 oneToMany records with exactly 2 statement splits per group in CSV.
```

```
Generate 200 manyToOne records with exactly 2 ledger entries per statement group.
```

```
Generate 100 manyToOne records consolidating exactly 3 ledger entries per group.
```

---

## Preview Before Generating

```
Preview what a SWIFT MT940 format looks like for the oneToMany scenario.
```

```
Show me a sample of 10 AP import records in CSV format.
```

```
Preview the BROKERAGE statement schema output in pipe format.
```

```
Show me what a BAI2 amountDiff record looks like.
```

```
Preview the camt.053 XML format for a perfect match scenario.
```

```
Show me a GL:BANK combined schema preview in CSV.
```

---

## Large-Scale Generation

```
Generate 5000 records in CSV for load testing — mixed scenarios.
```

```
Generate 10000 GL:BANK records in Excel format for regression testing.
```

```
Generate 2000 records in all formats for a full reconciliation test suite.
```

---

## Real-World Test Scenarios

```
Generate a reconciliation test file with 1000 records:
- Format: Excel
- Scenario: mixed (default distribution)
- Import: GL ledger + BANK statement
- Currency: EUR
- Date format: DD/MM/YYYY
```

```
Create test data for a split-payment reconciliation scenario:
500 records, oneToMany with 3-way splits, AP:BANK import schema, CSV format.
```

```
Generate UAT test data:
1000 records, all 7 scenarios, GL:BANK schema, Excel format, EUR currency.
```

```
Generate regression test data for the date-mismatch scenario:
300 records, dateDiff, AR:CUSTODIAN schema, CSV, YYYYMMDD date format.
```

```
Create a brokerage reconciliation test file:
500 records, perfect + amountDiff scenarios, BROKERAGE statement schema, JSON format.
```

---

## Adding New Output Formats (Dynamic Extension)

```
Create a new tab-separated (TSV) output format named "tsv" with file extension "tsv".
```

```
Create a semicolon-delimited format named "sapcsv" for SAP mass upload,
file extension "csv", delimiter ";".
```

```
Create a new tilde-delimited format named "tilde" for legacy mainframe import,
delimiter "~", file extension "dat".
```

```
Create a custom XML output format named "simplexml" with this code:

'use strict';
function formatLedger(records) {
  const rows = records.map(r =>
    `  <Transaction id="${r.TxnID}" date="${r.TransactionDate}" currency="${r.Currency}" debit="${r.DebitAmount}" credit="${r.CreditAmount}" ref="${r.ReferenceNumber}" />`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Ledger>\n${rows}\n</Ledger>`;
}
function formatStatement(records) {
  const rows = records.map(r =>
    `  <Entry id="${r.StatementID}" date="${r.ValueDate}" currency="${r.Currency}" amount="${r.Amount}" indicator="${r.DebitCreditIndicator}" ref="${r.ReferenceNumber}" />`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Statement>\n${rows}\n</Statement>`;
}
module.exports = { formatLedger, formatStatement, ext: 'xml' };
```

```
After creating the tsv format, generate 500 records using it:
Generate 500 TSV records with GL:BANK schema and perfect scenario.
```

---

## Adding New Import Schemas (Dynamic Extension)

```
Add a new ledger import schema named "DYNAMICS365" for Microsoft Dynamics 365
General Journal with these fields:
- JournalNum from rec.TxnID
- AccountNum from rec.LedgerAccount
- TransDate from rec.TransactionDate
- CurrencyCode from rec.Currency
- AmountCurDebit from rec.DebitAmount
- AmountCurCredit from rec.CreditAmount
- Txt from rec.Description
- Voucher from rec.ReferenceNumber

Description: "Microsoft Dynamics 365 General Journal import"
```

```
Add a new ledger schema named "SAP_HANA" for SAP S/4HANA with these fields:
- BUKRS from rec.LedgerAccount (company code)
- BELNR from rec.TxnID (document number)
- BLDAT from rec.TransactionDate (document date)
- BUDAT from rec.PostingDate (posting date)
- WAERS from rec.Currency
- DMBTR from rec.CreditAmount (amount)
- BKTXT from rec.Description (header text)
- ZUONR from rec.ReferenceNumber (assignment)

Description: "SAP S/4HANA BKPF/BSEG general ledger structure"
```

```
Add a new statement schema named "BLOOMBERG_FEED" for Bloomberg terminal data:
- msg_id from rec.StatementID
- acct_num from rec.BankAccountNumber
- trade_dt from rec.TransactionDate
- settle_dt from rec.ValueDate
- ccy from rec.Currency
- net_amt from rec.Amount
- side with expression: rec.DebitCreditIndicator === 'C' ? 'CREDIT' : 'DEBIT'
- ref_num from rec.ReferenceNumber
- narrative from rec.Description

Description: "Bloomberg terminal bank message feed"
```

```
Add a new ledger schema named "NETSUITE" for Oracle NetSuite journal entries:
- externalId from rec.TxnID
- tranDate from rec.TransactionDate
- currency from rec.Currency
- debit from rec.DebitAmount
- credit from rec.CreditAmount
- memo from rec.Description
- custcol_ref from rec.ReferenceNumber
- account from rec.LedgerAccount

Description: "Oracle NetSuite general journal import"
```

```
After adding DYNAMICS365, generate 500 records using it:
Generate 500 CSV records with DYNAMICS365 import schema and mixed scenarios.
```

---

## List Generated Files

```
Show me all the files that have been generated so far.
```

```
List the most recent 10 generated output files.
```

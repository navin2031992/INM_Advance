# IntelliMatch FIS — Dummy Data Generator

> Generate realistic financial transaction data for IntelliMatch FIS reconciliation testing.  
> Supports 14+ file formats, 7 reconciliation scenarios, and 6 import schemas — all extensible via AI prompts through the built-in MCP server.

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Quick Start](#quick-start)
4. [CLI Usage](#cli-usage)
5. [Output Formats](#output-formats)
6. [Reconciliation Scenarios](#reconciliation-scenarios)
7. [Import Schemas](#import-schemas)
8. [MCP Server — AI-Powered Generation](#mcp-server--ai-powered-generation)
9. [Adding New Formats via AI Prompt](#adding-new-formats-via-ai-prompt)
10. [Adding New Import Schemas via AI Prompt](#adding-new-import-schemas-via-ai-prompt)
11. [Configuration Reference](#configuration-reference)
12. [Architecture](#architecture)
13. [Examples](#examples)

---

## Overview

This tool generates paired **ledger** and **bank statement** transaction records that exercise every reconciliation scenario that IntelliMatch FIS handles:

- Perfect 1:1 matches
- Split payments (1 ledger → many statement entries)
- Consolidated payments (many ledger → 1 statement)
- Unmatched orphan records on either side
- Amount discrepancies
- Date discrepancies

All data is **synthetic but realistic** — real IBAN formats, SWIFT BICs, ISO currencies, and ERP-style reference numbers.

---

## Features

| Capability | Detail |
|---|---|
| **14 output formats** | CSV, pipe, JSON, fixed-width, Excel, SWIFT MT940/942/950/103/202/300/535, BAI2, ISO 20022 camt.053 |
| **7 reconciliation scenarios** | perfect, oneToMany, manyToOne, unmatchedLedger, unmatchedStatement, amountDiff, dateDiff |
| **6 import schemas** | GL, AP, AR (ledger) · BANK, BROKERAGE, CUSTODIAN (statement) |
| **MCP server** | 8 tools for AI-driven generation, format creation, and schema extension |
| **AI-extensible** | Add new formats and import schemas via natural language prompts |
| **Configurable** | Records, date range, currencies, amount range, account lists — all via config or CLI |

---

## Quick Start

```bash
# Install dependencies
npm install

# Generate 1000 CSV records (ledger + statement)
npm run generate -- --records=1000 --format=csv

# Generate Excel with General Ledger import schema
npm run generate -- --records=500 --importFormat=GL:BANK --format=excel

# Generate only perfect-match scenario
npm run generate -- --records=200 --scenario=perfect --format=csv

# Generate all 14 formats at once
npm run generate -- --records=100 --format=all
```

Output files are written to `./output/ledger/` and `./output/statement/`.

---

## CLI Usage

```
node src/index.js [options]
npm run generate -- [options]
```

### Options

| Option | Description | Default |
|---|---|---|
| `--records=N` | Number of ledger records | `1000` |
| `--format=FORMAT` | Output format (see table below) | `csv` |
| `--file=TYPE` | `ledger` \| `statement` \| `both` | `both` |
| `--scenario=NAME` | Reconciliation scenario (comma-separate for multiple) | mixed |
| `--split=N` | For `oneToMany`: fixed statement entries per ledger (≥2) | random 2–3 |
| `--consolidate=N` | For `manyToOne`: fixed ledger entries per statement (≥2) | random 2–3 |
| `--importFormat=FMT` | Import schema, e.g. `GL`, `AP:BANK`, `AR:CUSTODIAN` | raw layout |
| `--currency=CUR` | Override default currency | `USD` |
| `--dateFormat=FMT` | Date format for tabular output | `YYYY-MM-DD` |
| `--config=PATH` | Path to config JSON | `./generator.config.json` |
| `--output=DIR` | Output directory | `./output` |
| `--help` | Show help | — |

### Date Formats

| Value | Example |
|---|---|
| `YYYY-MM-DD` | `2026-01-15` (default) |
| `DDMMYYYY` | `15012026` |
| `YYYYMMDD` | `20260115` |
| `DD/MM/YYYY` | `15/01/2026` |
| `MM/DD/YYYY` | `01/15/2026` |

---

## Output Formats

| Key | Format | Extension |
|---|---|---|
| `csv` | Comma-separated values (RFC 4180) | `.csv` |
| `pipe` | Pipe-delimited flat file | `.txt` |
| `json` | JSON array | `.json` |
| `fixedwidth` | Fixed-width positional | `.txt` |
| `excel` | Excel workbook with summary sheet | `.xlsx` |
| `mt940` | SWIFT MT940 Customer Statement | `.txt` |
| `mt942` | SWIFT MT942 Interim Transaction Report | `.txt` |
| `mt950` | SWIFT MT950 Bank-to-Bank Statement | `.txt` |
| `mt103` | SWIFT MT103 Customer Credit Transfer | `.txt` |
| `mt202` | SWIFT MT202 Bank Transfer | `.txt` |
| `mt300` | SWIFT MT300 FX Confirmation | `.txt` |
| `mt535` | SWIFT MT535 Statement of Holdings | `.txt` |
| `bai2` | BAI2 Cash Management (US banking) | `.bai2` |
| `camt053` | ISO 20022 camt.053 XML | `.xml` |
| `all` | All formats above | — |

> **Custom formats** added via the MCP server also appear here automatically.

---

## Reconciliation Scenarios

| Scenario | Distribution | Description |
|---|---|---|
| `perfect` | 50% | 1 ledger ↔ 1 statement — exact match on amount, date, and reference |
| `oneToMany` | 15% | 1 ledger → 2–3 statement entries (split payment/receipt) |
| `manyToOne` | 15% | 2–3 ledger entries → 1 statement (consolidation) |
| `unmatchedLedger` | 5% | Ledger entry with no statement counterpart |
| `unmatchedStatement` | 5% | Statement entry with no ledger counterpart |
| `amountDiff` | 5% | Same reference, amounts differ by ±0.1–5% |
| `dateDiff` | 5% | Same reference, value date differs by 1–5 business days |

### Usage

```bash
# Single scenario
--scenario=perfect

# Multiple scenarios
--scenario=perfect,amountDiff,dateDiff

# Fixed splits for oneToMany
--scenario=oneToMany --split=3

# Fixed consolidation for manyToOne
--scenario=manyToOne --consolidate=2
```

---

## Import Schemas

Import schemas transform raw generated records into the specific field layout that IntelliMatch import templates expect.

### Ledger schemas

| Schema | Fields |
|---|---|
| `GL` | TxnID, GLAccount, CostCenter, TxnDate, PostDate, FiscalYear, Period, Currency, DebitAmount, CreditAmount, NetAmount, DocumentType, CompanyCode, Description, Reference |
| `AP` | InvoiceID, VendorID, VendorName, InvoiceDate, DueDate, PostDate, Currency, InvoiceAmount, PaidAmount, OutstandingAmount, PaymentReference, GLAccount, CostCenter, DocumentType |
| `AR` | InvoiceID, CustomerID, CustomerName, InvoiceDate, DueDate, PostDate, Currency, InvoiceAmount, ReceivedAmount, OutstandingAmount, PaymentReference, GLAccount, DocumentType |

### Statement schemas

| Schema | Fields |
|---|---|
| `BANK` | StatementID, BankAccount, IBAN, BankName, TxnDate, ValueDate, Currency, Amount, DebitCreditIndicator, BankReference, EndToEndRef, RemittanceInfo |
| `BROKERAGE` | StatementID, AccountNumber, SecurityID, ISIN, SecurityName, TxnDate, SettleDate, TxnType, Quantity, Price, Currency, GrossAmount, Fees, NetAmount, Reference |
| `CUSTODIAN` | StatementID, CustodianAccount, SubAccount, AssetClass, SecurityID, SecurityName, ISIN, TxnDate, SettleDate, Currency, MarketValue, AccruedInterest, NetAmount, Reference, Narrative |

### Combined syntax

```bash
# GL ledger + BANK statement
--importFormat=GL:BANK

# AP ledger + CUSTODIAN statement
--importFormat=AP:CUSTODIAN

# AR ledger + BROKERAGE statement
--importFormat=AR:BROKERAGE
```

---

## MCP Server — AI-Powered Generation

The MCP server wraps the generator and exposes it as a set of tools that AI assistants can call. This enables natural-language data generation without remembering CLI flags.

### Setup

```bash
# Install MCP server dependencies
cd mcp-server && npm install && cd ..
```

The project root `.mcp.json` is pre-configured for Claude Code. See [QUICK_SETUP.md](QUICK_SETUP.md) for Roo Code and Cline setup instructions.

### Available Tools

| Tool | Purpose |
|---|---|
| `generate_test_data` | Generate files with any combination of parameters |
| `list_formats` | List all available output formats |
| `list_scenarios` | List reconciliation scenarios with descriptions |
| `list_import_schemas` | List all import schemas (including custom ones) |
| `preview_data` | Preview 10 records as inline text |
| `create_output_format` | **Create a new file format dynamically** |
| `add_import_schema` | **Add a new import schema row layout dynamically** |
| `get_generated_files` | List recently generated output files |

### Example AI Prompts

```
Generate 500 CSV records with perfect match scenario and GL:BANK import schema

Preview what a BAI2 format looks like for the oneToMany scenario

Generate 1000 Excel records in all scenarios and save to ./test-data/

What formats are available?

List all reconciliation scenarios
```

---

## Adding New Formats via AI Prompt

When a **new file format** requirement arrives, you can add it without writing code manually. Just describe it to the AI assistant.

### Example prompts

#### Tab-separated values (TSV)
```
Create a new TSV (tab-separated) output format named "tsv" 
with file extension "tsv"
```

#### Semicolon-delimited for SAP
```
Create a new output format named "sapcsv" with semicolon delimiter 
for SAP import, file extension "csv", 
description "Semicolon-delimited for SAP mass upload"
```

#### Custom XML format
```
Create a custom output format named "customxml" with this JavaScript code:

'use strict';
function formatLedger(records) {
  const rows = records.map(r =>
    `  <Transaction id="${r.TxnID}" amount="${r.CreditAmount || r.DebitAmount}" currency="${r.Currency}" />`
  ).join('\n');
  return `<?xml version="1.0"?>\n<Ledger>\n${rows}\n</Ledger>`;
}
function formatStatement(records) {
  const rows = records.map(r =>
    `  <Entry id="${r.StatementID}" amount="${r.Amount}" currency="${r.Currency}" />`
  ).join('\n');
  return `<?xml version="1.0"?>\n<Statement>\n${rows}\n</Statement>`;
}
module.exports = { formatLedger, formatStatement, ext: 'xml' };
```

After the tool call, the format is immediately available:

```bash
node src/index.js --format=tsv
node src/index.js --format=sapcsv
node src/index.js --format=customxml
```

The formatter is written to `src/formatters/<name>Formatter.js` and automatically registered in `src/index.js`.

---

## Adding New Import Schemas via AI Prompt

When a **new ERP system or row layout** is required, describe the field mapping to the AI assistant.

### Example prompts

#### SAP HANA GL schema
```
Add a new ledger import schema named "SAP_HANA" with these fields:
- BUKRS from rec.LedgerAccount (company code)
- GJAHR from fiscal year of rec.TransactionDate
- BELNR from rec.TxnID
- BLDAT from rec.TransactionDate (document date)
- BUDAT from rec.PostingDate (posting date)
- WAERS from rec.Currency
- DMBTR from rec.CreditAmount or rec.DebitAmount
- BKTXT from rec.Description (header text)
- ZUONR from rec.ReferenceNumber (assignment)

Description: "SAP HANA General Ledger (BKPF/BSEG structure)"
```

#### NetSuite AP schema
```
Add a new ledger import schema named "NETSUITE_AP" for Accounts Payable with:
- externalId: rec.TxnID
- vendor: a random vendor name
- trandate: rec.TransactionDate
- currency: rec.Currency
- amount: rec.DebitAmount
- duedate: 30 days after rec.TransactionDate
- memo: rec.Description
- status: "Pending Approval"

Description: "NetSuite Accounts Payable import format"
```

After the tool call:
```bash
node src/index.js --importFormat=SAP_HANA
node src/index.js --importFormat=NETSUITE_AP:BANK
```

The mapper function is written into `src/formatters/importFormatMapper.js` and registered automatically.

---

## Configuration Reference

**`generator.config.json`** — default settings (overridden by CLI flags):

```json
{
  "records": 1000,
  "format": "csv",
  "file": "both",
  "currency": "USD",
  "dateRange": {
    "start": "2026-01-01",
    "end":   "2026-03-31"
  },
  "matchingPercentages": {
    "perfectMatch":     50,
    "oneToMany":        15,
    "manyToOne":        15,
    "unmatched":        10,
    "amountDifference":  5,
    "dateDifference":    5
  },
  "accounts": {
    "ledger": ["10001", "10002", "20001", "20002", "30001"],
    "bank":   ["GB29NWBK60161331926819", "DE89370400440532013000"]
  },
  "currencies":   ["USD", "EUR", "GBP", "AUD", "CHF", "JPY", "CAD"],
  "amountRange":  { "min": 100, "max": 500000 },
  "outputDir":    "./output"
}
```

---

## Architecture

```
generator.config.json + CLI args
          │
          ▼
  Argument validation
          │
          ▼
  matchingEngine.js        ← builds 7 scenario types as match groups
          │
          ▼
  ledgerGenerator.js       ← generates TxnID, amounts, dates, accounts
  statementGenerator.js    ← generates StatementID, bank data
          │
          ▼
  importFormatMapper.js    ← optionally remaps fields to ERP schemas
          │
          ▼
  Formatter (csv/mt940/…)  ← serializes to target file format
          │
          ▼
  fileWriter.js            ← writes timestamped files to ./output/
```

### Key source files

| File | Purpose |
|---|---|
| `src/index.js` | CLI entry point, orchestration |
| `src/generators/matchingEngine.js` | Builds reconciliation match groups |
| `src/generators/ledgerGenerator.js` | Creates raw ledger records |
| `src/generators/statementGenerator.js` | Creates raw statement records |
| `src/formatters/csvFormatter.js` | CSV output |
| `src/formatters/importFormatMapper.js` | ERP schema transformations |
| `src/utils/randomizer.js` | Random data generation helpers |
| `src/utils/fileWriter.js` | File I/O and path building |
| `mcp-server/index.js` | MCP server (8 tools) |
| `generator.config.json` | Default configuration |
| `.mcp.json` | MCP server config for Claude Code / Roo / Cline |

---

## Examples

```bash
# 1000 records, mixed scenarios, CSV
node src/index.js --records=1000 --format=csv

# 500 records, GL:BANK import, Excel
node src/index.js --records=500 --importFormat=GL:BANK --format=excel

# Pure perfect-match scenario, 200 records, JSON
node src/index.js --records=200 --scenario=perfect --format=json

# Amount-diff + date-diff combined, pipe format
node src/index.js --records=300 --scenario=amountDiff,dateDiff --format=pipe

# AP ledger, CUSTODIAN statement, 1000 records, all formats
node src/index.js --records=1000 --importFormat=AP:CUSTODIAN --format=all

# BROKERAGE statement only, CSV, DD/MM/YYYY dates
node src/index.js --records=500 --importFormat=BROKERAGE --format=csv \
  --file=statement --dateFormat=DD/MM/YYYY

# SWIFT MT940 for oneToMany with fixed 3-way split
node src/index.js --records=100 --scenario=oneToMany --split=3 --format=mt940

# ISO 20022 camt.053 XML
node src/index.js --records=200 --format=camt053

# BAI2 US banking format
node src/index.js --records=500 --format=bai2

# manyToOne with fixed consolidation count
node src/index.js --records=600 --scenario=manyToOne --consolidate=2 --format=csv
```

### npm scripts shortcuts

```bash
npm run generate:csv
npm run generate:excel
npm run generate:all
npm run scenario:perfect
npm run scenario:oneToMany
npm run scenario:manyToOne
npm run import:GL
npm run import:GL:BANK
```

---

## File Naming Convention

Generated files follow the pattern:

```
{type}_{format}_{scenario}_{N}rec_{YYYY-MM-DD}_{HH-MM-SS}.{ext}
```

Examples:
```
output/ledger/ledger_csv_mixed_1000rec_2026-06-17_14-30-00.csv
output/statement/statement_excel_perfect_GL_200rec_2026-06-17_14-30-00.xlsx
```

---

*IntelliMatch FIS — Dummy Data Generator v1.0.0*

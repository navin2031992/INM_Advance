#!/usr/bin/env node
'use strict';

/**
 * IntelliMatch Dummy Data Generator
 * ===================================
 * Generates financial transaction data for IntelliMatch FIS reconciliation testing.
 *
 * Usage:
 *   node src/index.js [options]
 *   npm run generate-data -- --records=1000 --format=csv --file=both
 *
 * Options:
 *   --records=N          Number of ledger records to generate (default: 1000)
 *   --format=FORMAT      Output format: csv|pipe|json|fixedwidth|excel|mt940|mt942|mt950|mt103|mt202|mt300|mt535|bai2|camt053|all
 *   --file=TYPE          Which files: ledger|statement|both (default: both)
 *   --scenario=SCENARIO  Focus on specific scenario(s): perfect|oneToMany|manyToOne|
 *                        unmatchedLedger|unmatchedStatement|amountDiff|dateDiff
 *                        Comma-separate for multiple: perfect,oneToMany
 *                        Omit for default percentage-based mixed distribution.
 *   --split=N            For oneToMany: fixed number of statement splits (default: random 2-3)
 *   --consolidate=N      For manyToOne: fixed number of ledger entries (default: random 2-3)
 *   --importFormat=FMT   IntelliMatch import template schema:
 *                          Ledger   : GL | AP | AR
 *                          Statement: BANK | BROKERAGE | CUSTODIAN
 *                          Combined : GL:BANK | AP:BANK | AR:CUSTODIAN | etc.
 *                          Omit to use the default raw field layout.
 *   --currency=CUR       Override default currency (e.g. USD, EUR)
 *   --config=PATH        Path to config file (default: ./generator.config.json)
 *   --output=DIR         Output directory (default: ./output)
 *   --help               Show this help
 */

const path = require('path');
const fs   = require('fs');

// ── Argument parsing (minimist-based with fallback) ──────────────────────────
let argv;
try {
  argv = require('minimist')(process.argv.slice(2));
} catch (e) {
  // Manual fallback parser if minimist not yet installed
  argv = { _: [] };
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--?([^=]+)(?:=(.*))?$/);
    if (m) argv[m[1]] = m[2] !== undefined ? m[2] : true;
  }
}

if (argv.help || argv.h) {
  printHelp();
  process.exit(0);
}

// ── Load configuration ───────────────────────────────────────────────────────
const configPath = argv.config
  ? path.resolve(argv.config)
  : path.join(__dirname, '..', 'generator.config.json');

let config = {};
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.warn(`[WARN] Could not load config from ${configPath}: ${e.message}`);
  console.warn('[WARN] Using built-in defaults.');
  config = getDefaultConfig();
}

// CLI overrides take precedence
if (argv.records)     config.records    = parseInt(argv.records, 10);
if (argv.format)      config.format     = argv.format;
if (argv.file)        config.file       = argv.file;
if (argv.currency)    config.currency   = argv.currency;
if (argv.output)      config.outputDir  = argv.output;
if (argv.scenario)     config.scenario     = String(argv.scenario);
if (argv.split)        config.split        = parseInt(argv.split, 10);
if (argv.consolidate)  config.consolidate  = parseInt(argv.consolidate, 10);
if (argv.importFormat) config.importFormat = String(argv.importFormat).toUpperCase();
if (argv.dateFormat)   config.dateFormat   = String(argv.dateFormat);

// Validate records
if (!config.records || config.records < 1) {
  console.error('[ERROR] --records must be a positive integer.');
  process.exit(1);
}

const VALID_DATE_FORMATS = ['YYYY-MM-DD', 'DDMMYYYY', 'YYYYMMDD', 'DD/MM/YYYY', 'MM/DD/YYYY'];
if (config.dateFormat && !VALID_DATE_FORMATS.includes(config.dateFormat)) {
  console.error(`[ERROR] Unknown date format "${config.dateFormat}". Valid: ${VALID_DATE_FORMATS.join(', ')}`);
  process.exit(1);
}

const VALID_FORMATS = ['csv','pipe','json','fixedwidth','excel','mt940','mt942','mt950','mt103','mt202','mt300','mt535','bai2','camt053','all'];
if (!VALID_FORMATS.includes(config.format)) {
  console.error(`[ERROR] Unknown format "${config.format}". Valid: ${VALID_FORMATS.join(', ')}`);
  process.exit(1);
}

// Validate scenario names if provided
const { VALID_SCENARIOS } = require('./generators/matchingEngine');
if (config.scenario && config.scenario !== 'all') {
  const requested = config.scenario.split(',').map(s => s.trim());
  for (const s of requested) {
    if (!VALID_SCENARIOS.includes(s)) {
      console.error(`[ERROR] Unknown scenario "${s}". Valid: ${VALID_SCENARIOS.join(', ')}`);
      process.exit(1);
    }
  }
}

// Validate importFormat if provided
const {
  applyLedgerImportFormat,
  applyStatementImportFormat,
  VALID_IMPORT_FORMATS,
  ALL_IMPORT_FORMATS,
  describeImportFormat
} = require('./formatters/importFormatMapper');

if (config.importFormat) {
  // Accept combined syntax "GL:BANK", otherwise single value applies to both sides
  const [ledgerFmt, stmtFmt] = config.importFormat.includes(':')
    ? config.importFormat.split(':')
    : [config.importFormat, config.importFormat];

  if (ledgerFmt && !VALID_IMPORT_FORMATS.ledger.includes(ledgerFmt) && !VALID_IMPORT_FORMATS.statement.includes(ledgerFmt)) {
    console.error(`[ERROR] Unknown import format "${ledgerFmt}". Valid ledger: ${VALID_IMPORT_FORMATS.ledger.join(', ')} | Valid statement: ${VALID_IMPORT_FORMATS.statement.join(', ')}`);
    process.exit(1);
  }
  if (stmtFmt && ledgerFmt !== stmtFmt &&
      !VALID_IMPORT_FORMATS.statement.includes(stmtFmt)) {
    console.error(`[ERROR] Unknown statement import format "${stmtFmt}". Valid: ${VALID_IMPORT_FORMATS.statement.join(', ')}`);
    process.exit(1);
  }
}

// Validate split / consolidate
if (config.split && (isNaN(config.split) || config.split < 2)) {
  console.error('[ERROR] --split must be an integer >= 2.');
  process.exit(1);
}
if (config.consolidate && (isNaN(config.consolidate) || config.consolidate < 2)) {
  console.error('[ERROR] --consolidate must be an integer >= 2.');
  process.exit(1);
}

// ── Load generator modules ───────────────────────────────────────────────────
const { buildMatchGroups, buildScenarioGroups } = require('./generators/matchingEngine');
const { generateLedgerRecords }                 = require('./generators/ledgerGenerator');
const { generateStatementRecords }              = require('./generators/statementGenerator');
const { writeFile, buildFilePath }              = require('./utils/fileWriter');
const { reformatDate }                          = require('./utils/randomizer');

// Formats that output dates as plain text strings (apply --dateFormat to them).
// SWIFT/structured formats parse ISO dates internally and reformat themselves.
const TABULAR_FORMATS = new Set(['csv', 'pipe', 'json', 'fixedwidth', 'excel']);
const ISO_DATE_RE     = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns a copy of records with every YYYY-MM-DD value reformatted to dateFormat.
 * Leaves records unchanged if dateFormat is falsy or 'YYYY-MM-DD'.
 */
function applyDateFormatToRecords(records, dateFormat) {
  if (!dateFormat || dateFormat === 'YYYY-MM-DD') return records;
  return records.map(r => {
    const out = Object.assign({}, r);
    for (const key of Object.keys(out)) {
      if (typeof out[key] === 'string' && ISO_DATE_RE.test(out[key])) {
        out[key] = reformatDate(out[key], dateFormat);
      }
    }
    return out;
  });
}

// ── Format registry ──────────────────────────────────────────────────────────
const formatters = {
  csv:        require('./formatters/csvFormatter'),
  pipe:       require('./formatters/pipeFormatter'),
  json:       require('./formatters/jsonFormatter'),
  fixedwidth: require('./formatters/fixedWidthFormatter'),
  excel:      require('./formatters/excelFormatter'),
  mt940:      require('./formatters/mt940Formatter'),
  mt942:      require('./formatters/mt942Formatter'),
  mt950:      require('./formatters/mt950Formatter'),
  mt103:      require('./formatters/mt103Formatter'),
  mt202:      require('./formatters/mt202Formatter'),
  mt300:      require('./formatters/mt300Formatter'),
  mt535:      require('./formatters/mt535Formatter'),
  bai2:       require('./formatters/bai2Formatter'),
  camt053:    require('./formatters/camt053Formatter')
};

// ── Main generation logic ────────────────────────────────────────────────────
function run() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(  '║    IntelliMatch FIS — Dummy Data Generator v1.0.0   ║');
  console.log(  '╚══════════════════════════════════════════════════════╝\n');

  // Resolve scenario mode
  const scenarioMode   = config.scenario && config.scenario !== 'all';
  const scenarioList   = scenarioMode
    ? config.scenario.split(',').map(s => s.trim())
    : null;
  const scenarioLabel  = scenarioMode ? scenarioList.join('+') : 'mixed';
  const scenarioOpts   = { split: config.split, consolidate: config.consolidate };

  // Resolve import format
  let ledgerImportFmt   = null;
  let stmtImportFmt     = null;
  if (config.importFormat) {
    if (config.importFormat.includes(':')) {
      [ledgerImportFmt, stmtImportFmt] = config.importFormat.split(':');
    } else {
      // Single value: auto-assign to correct side, or both if user gave a raw name
      const upper = config.importFormat;
      if (VALID_IMPORT_FORMATS.ledger.includes(upper))     { ledgerImportFmt = upper; }
      if (VALID_IMPORT_FORMATS.statement.includes(upper))  { stmtImportFmt   = upper; }
      // If user typed something valid for both sides (impossible with current schema — just safety)
    }
  }
  const importLabel = config.importFormat || 'default';

  console.log(`[INFO] Configuration:`);
  console.log(`       Records       : ${config.records}`);
  console.log(`       Format        : ${config.format}`);
  console.log(`       File type     : ${config.file || 'both'}`);
  console.log(`       Scenario      : ${scenarioLabel}`);
  if (scenarioMode && scenarioList.includes('oneToMany') && config.split) {
    console.log(`       Split         : ${config.split} (fixed statement entries per ledger)`);
  }
  if (scenarioMode && scenarioList.includes('manyToOne') && config.consolidate) {
    console.log(`       Consolidate   : ${config.consolidate} (fixed ledger entries per statement)`);
  }
  if (ledgerImportFmt) {
    console.log(`       Ledger import : ${ledgerImportFmt} — ${describeImportFormat(ledgerImportFmt)}`);
  }
  if (stmtImportFmt) {
    console.log(`       Stmt import   : ${stmtImportFmt} — ${describeImportFormat(stmtImportFmt)}`);
  }
  console.log(`       Currency      : ${config.currency}`);
  console.log(`       Date format   : ${config.dateFormat || 'YYYY-MM-DD (default)'}`);
  console.log(`       Date range    : ${config.dateRange.start} → ${config.dateRange.end}`);
  console.log(`       Output dir    : ${config.outputDir}`);
  if (!scenarioMode) {
    console.log(`       Match dist    : ${JSON.stringify(config.matchingPercentages)}`);
  }
  console.log('');

  // Step 1: Build match groups
  console.log('[STEP 1/4] Building reconciliation match groups...');
  let matchGroups;
  if (scenarioMode) {
    matchGroups = buildScenarioGroups(scenarioList, config.records, config, scenarioOpts);
    console.log(`[INFO]  Mode: SCENARIO-FOCUSED (${scenarioLabel})`);
  } else {
    matchGroups = buildMatchGroups(config.records, config);
    console.log('[INFO]  Mode: MIXED (percentage-based distribution)');
  }

  const scenarioCounts = {};
  for (const g of matchGroups) {
    scenarioCounts[g.type] = (scenarioCounts[g.type] || 0) + 1;
  }
  console.log('[INFO]  Match group distribution:');
  for (const [type, count] of Object.entries(scenarioCounts)) {
    console.log(`         ${type.padEnd(22)}: ${count} groups`);
  }

  // Print oneToMany / manyToOne detail when in scenario mode
  if (scenarioMode) {
    if (scenarioList.includes('oneToMany')) {
      const stmtTotal = matchGroups
        .filter(g => g.type === 'oneToMany')
        .reduce((sum, g) => sum + g.stmtIds.length, 0);
      const ldgTotal  = matchGroups.filter(g => g.type === 'oneToMany').length;
      console.log(`[INFO]  oneToMany detail: ${ldgTotal} ledger group(s) → ${stmtTotal} statement entries`);
      const splitCounts = {};
      matchGroups.filter(g => g.type === 'oneToMany').forEach(g => {
        const k = g.splitCount; splitCounts[k] = (splitCounts[k] || 0) + 1;
      });
      for (const [k, v] of Object.entries(splitCounts)) {
        console.log(`           Split=${k}: ${v} group(s)`);
      }
    }
    if (scenarioList.includes('manyToOne')) {
      const ldgTotal  = matchGroups
        .filter(g => g.type === 'manyToOne')
        .reduce((sum, g) => sum + g.ledgerIds.length, 0);
      const stmtTotal = matchGroups.filter(g => g.type === 'manyToOne').length;
      console.log(`[INFO]  manyToOne detail: ${ldgTotal} ledger entries → ${stmtTotal} statement group(s)`);
      const consCounts = {};
      matchGroups.filter(g => g.type === 'manyToOne').forEach(g => {
        const k = g.consolidateCount; consCounts[k] = (consCounts[k] || 0) + 1;
      });
      for (const [k, v] of Object.entries(consCounts)) {
        console.log(`           Consolidate=${k}: ${v} group(s)`);
      }
    }
  }

  // Step 2: Generate records
  console.log('\n[STEP 2/4] Generating records from match groups...');
  let ledgerRecords    = generateLedgerRecords(matchGroups, config);
  let statementRecords = generateStatementRecords(matchGroups, config);
  console.log(`[INFO]  Ledger records    : ${ledgerRecords.length} (raw)`);
  console.log(`[INFO]  Statement records : ${statementRecords.length} (raw)`);

  // Apply import format schema mapping
  if (ledgerImportFmt) {
    ledgerRecords = applyLedgerImportFormat(ledgerRecords, ledgerImportFmt);
    console.log(`[INFO]  Ledger mapped to  : ${ledgerImportFmt} import format (${Object.keys(ledgerRecords[0] || {}).length} fields)`);
  }
  if (stmtImportFmt) {
    statementRecords = applyStatementImportFormat(statementRecords, stmtImportFmt);
    console.log(`[INFO]  Statement mapped  : ${stmtImportFmt} import format (${Object.keys(statementRecords[0] || {}).length} fields)`);
  }

  // Step 3: Determine which formats to generate
  const formatsToRun = config.format === 'all'
    ? Object.keys(formatters)
    : [config.format];

  const fileType = config.file || 'both';
  const outputDir = config.outputDir || './output';
  const writtenFiles = [];

  console.log(`\n[STEP 3/4] Formatting and writing files (format(s): ${formatsToRun.join(', ')})...`);

  for (const fmt of formatsToRun) {
    const formatter = formatters[fmt];
    if (!formatter) {
      console.warn(`[WARN] No formatter found for "${fmt}", skipping.`);
      continue;
    }

    // Compose tags: scenario + importFormat for filenames
    const ledgerTag = [scenarioLabel, ledgerImportFmt].filter(Boolean).join('_');
    const stmtTag   = [scenarioLabel, stmtImportFmt].filter(Boolean).join('_');

    // Apply --dateFormat only for tabular formats; SWIFT/structured formats
    // parse ISO dates internally and apply their own date formatting.
    const dateFormat      = TABULAR_FORMATS.has(fmt) ? config.dateFormat : null;
    const fmtLedgerRecs   = applyDateFormatToRecords(ledgerRecords,    dateFormat);
    const fmtStmtRecs     = applyDateFormatToRecords(statementRecords, dateFormat);

    // Ledger file
    if (fileType === 'ledger' || fileType === 'both') {
      try {
        const content  = formatter.formatLedger(fmtLedgerRecs);
        const filePath = buildFilePath(outputDir, 'ledger', fmt, formatter.ext, fmtLedgerRecs.length, ledgerTag || undefined);
        writeFile(filePath, content, formatter.isBinary === true);
        writtenFiles.push(filePath);
        console.log(`[OK]   ledger  → ${filePath}`);
      } catch (err) {
        console.error(`[ERR]  ledger  ${fmt}: ${err.message}`);
      }
    }

    // Statement file
    if (fileType === 'statement' || fileType === 'both') {
      try {
        const content  = formatter.formatStatement(fmtStmtRecs);
        const filePath = buildFilePath(outputDir, 'statement', fmt, formatter.ext, fmtStmtRecs.length, stmtTag || undefined);
        writeFile(filePath, content, formatter.isBinary === true);
        writtenFiles.push(filePath);
        console.log(`[OK]   stmt    → ${filePath}`);
      } catch (err) {
        console.error(`[ERR]  stmt    ${fmt}: ${err.message}`);
      }
    }
  }

  // Step 4: Summary
  console.log('\n[STEP 4/4] Generation complete.');
  console.log('\n┌──────────────────────────────────────────────────────┐');
  console.log(  '│                    SUMMARY REPORT                   │');
  console.log(  '├──────────────────────────────────────────────────────┤');
  console.log(`│  Ledger records generated    : ${String(ledgerRecords.length).padStart(8)}              │`);
  console.log(`│  Statement records generated : ${String(statementRecords.length).padStart(8)}              │`);
  console.log(`│  Files written               : ${String(writtenFiles.length).padStart(8)}              │`);
  console.log(  '├──────────────────────────────────────────────────────┤');
  console.log(  '│  Reconciliation Scenario Breakdown                   │');
  for (const [type, count] of Object.entries(scenarioCounts)) {
    const pct = ((count / matchGroups.length) * 100).toFixed(1);
    console.log(`│    ${type.padEnd(26)}: ${String(count).padStart(5)} groups (${pct}%)  │`);
  }
  console.log(  '├──────────────────────────────────────────────────────┤');
  console.log(`│  Import Format                                       │`);
  console.log(`│    Ledger   : ${(ledgerImportFmt || 'default (raw)').padEnd(37)}│`);
  console.log(`│    Statement: ${(stmtImportFmt   || 'default (raw)').padEnd(37)}│`);
  console.log(  '└──────────────────────────────────────────────────────┘\n');
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getDefaultConfig() {
  return {
    records: 1000,
    format: 'csv',
    file: 'both',
    currency: 'USD',
    dateRange: { start: '2026-01-01', end: '2026-03-31' },
    matchingPercentages: {
      perfectMatch: 50, oneToMany: 15, manyToOne: 15,
      unmatched: 10, amountDifference: 5, dateDifference: 5
    },
    accounts: {
      ledger: ['10001','10002','20001','20002','30001','40001','40002','50001','60001','70001'],
      bank:   ['GB29NWBK60161331926819','DE89370400440532013000','FR7614508059144921279050070','US123456789012345678']
    },
    currencies:  ['USD','EUR','GBP','AUD','CHF'],
    amountRange: { min: 100, max: 500000 },
    outputDir:   './output'
  };
}

function printHelp() {
  console.log(`
IntelliMatch FIS — Dummy Data Generator
========================================

Usage:
  node src/index.js [options]
  npm run generate-data -- [options]

Options:
  --records=N          Ledger records to generate          (default: 1000)
  --format=FORMAT      Output format:
                         csv, pipe, json, fixedwidth, excel
                         mt940, mt942, mt950, mt103, mt202
                         mt300, mt535, bai2, camt053, all  (default: csv)
  --file=TYPE          Which files: ledger|statement|both  (default: both)
  --scenario=SCENARIO  Generate ONLY the specified scenario(s).
                       Single:   perfect | oneToMany | manyToOne |
                                 unmatchedLedger | unmatchedStatement |
                                 amountDiff | dateDiff
                       Multiple: perfect,oneToMany  (comma-separated)
                       Omit for default mixed distribution.
  --split=N            oneToMany: fixed statement-entry count per group
                         N >= 2  (default: random 2 or 3)
  --consolidate=N      manyToOne: fixed ledger-entry count per group
                         N >= 2  (default: random 2 or 3)
  --importFormat=FMT   IntelliMatch import template (reshapes field schema):
                         Ledger formats    : GL | AP | AR
                         Statement formats : BANK | BROKERAGE | CUSTODIAN
                         Auto-assign       : GL, AP, AR  → ledger only
                                            BANK, BROKERAGE, CUSTODIAN → statement only
                         Combined (colon)  : GL:BANK | AP:CUSTODIAN | AR:BROKERAGE
                         Omit to keep default raw field layout.
  --dateFormat=FMT     Date format for tabular outputs (csv/pipe/json/fixedwidth/excel):
                         YYYY-MM-DD  ISO standard             (default)
                         DDMMYYYY    Day-Month-Year compact
                         YYYYMMDD    Year-Month-Day compact
                         DD/MM/YYYY  Day/Month/Year separated
                         MM/DD/YYYY  Month/Day/Year separated
                       SWIFT formats (mt*) always use YYMMDD per the standard.
  --currency=CUR       Override currency (e.g. USD, EUR, GBP)
  --config=PATH        Config file path      (default: generator.config.json)
  --output=DIR         Output directory      (default: ./output)
  --help               Show this help

Examples:
  # Default mixed run
  node src/index.js --records=1000 --format=csv

  # General Ledger import format (GL schema for ledger, BANK schema for statement)
  node src/index.js --records=500 --importFormat=GL:BANK --format=csv

  # Accounts Payable import format (AP ledger schema only)
  node src/index.js --records=300 --importFormat=AP --format=excel

  # Brokerage statement import format (securities fields)
  node src/index.js --records=200 --importFormat=BROKERAGE --format=csv --file=statement

  # AR ledger + Custodian statement — combined import
  node src/index.js --records=1000 --importFormat=AR:CUSTODIAN --format=csv

  # Scenario + import format together
  node src/index.js --records=500 --scenario=perfect --importFormat=GL:BANK --format=excel

  npm run generate-data -- --records=5000 --scenario=manyToOne --importFormat=AP:BANK --format=all

Supported Formats (--format):
  csv         Comma-separated values
  pipe        Pipe-delimited flat file
  json        JSON array
  fixedwidth  Fixed-width positional flat file
  excel       Microsoft Excel (.xlsx) with Summary sheet
  mt940       SWIFT MT940 Customer Statement
  mt942       SWIFT MT942 Interim Transaction Report
  mt950       SWIFT MT950 Bank Statement
  mt103       SWIFT MT103 Customer Credit Transfer
  mt202       SWIFT MT202 Bank Transfer
  mt300       SWIFT MT300 Foreign Exchange Confirmation
  mt535       SWIFT MT535 Statement of Holdings
  bai2        BAI2 Cash Management (US banking standard)
  camt053     ISO 20022 camt.053 Bank-to-Customer Statement (XML)
  all         Generate all formats above

Import Format Schemas (--importFormat):
  GL          General Ledger: TxnID, GLAccount, CostCenter, TxnDate, PostDate,
              FiscalYear, Period, Currency, DebitAmount, CreditAmount, NetAmount,
              DocumentType, CompanyCode, Description, Reference
  AP          Accounts Payable: InvoiceID, VendorID, VendorName, InvoiceDate,
              DueDate, PostDate, Currency, InvoiceAmount, PaidAmount,
              OutstandingAmount, PaymentReference, GLAccount, CostCenter, DocumentType
  AR          Accounts Receivable: InvoiceID, CustomerID, CustomerName, InvoiceDate,
              DueDate, PostDate, Currency, InvoiceAmount, ReceivedAmount,
              OutstandingAmount, PaymentReference, GLAccount, DocumentType
  BANK        Bank Statement: StatementID, BankAccount, IBAN, BankName, TxnDate,
              ValueDate, Currency, Amount, DebitCreditIndicator, BankReference,
              EndToEndRef, RemittanceInfo
  BROKERAGE   Brokerage: StatementID, AccountNumber, SecurityID, ISIN, SecurityName,
              TxnDate, SettleDate, TxnType, Quantity, Price, Currency, GrossAmount,
              Fees, NetAmount, Reference
  CUSTODIAN   Custodian: StatementID, CustodianAccount, SubAccount, AssetClass,
              SecurityID, SecurityName, ISIN, TxnDate, SettleDate, Currency,
              MarketValue, AccruedInterest, NetAmount, Reference, Narrative

Scenario Values (--scenario):
  perfect            1:1 — exact match: amount, date, reference
  oneToMany          1:N — one ledger → 2+ statement entries (split payment)
  manyToOne          N:1 — N ledger entries → 1 statement (consolidation)
  unmatchedLedger    Ledger entry with no statement counterpart
  unmatchedStatement Statement entry with no ledger counterpart
  amountDiff         Same reference but amounts differ slightly (±0.1–5%)
  dateDiff           Same reference but value date differs by 1–5 days
`);
}

// ── Execute ──────────────────────────────────────────────────────────────────
run();

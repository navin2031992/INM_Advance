IntelliMatch FIS Dummy Data Generator — Complete
Project Structure

c:/Intellimatch/
├── package.json                     # npm project + scripts
├── generator.config.json            # Default configuration
├── src/
│   ├── index.js                     # Main CLI entry point
│   ├── generators/
│   │   ├── matchingEngine.js        # Reconciliation scenario builder
│   │   ├── ledgerGenerator.js       # Ledger record producer
│   │   └── statementGenerator.js   # Statement record producer
│   ├── formatters/
│   │   ├── csvFormatter.js          # CSV output
│   │   ├── pipeFormatter.js         # Pipe-separated output
│   │   ├── jsonFormatter.js         # JSON array output
│   │   ├── fixedWidthFormatter.js   # Fixed-width positional flat file
│   │   ├── excelFormatter.js        # .xlsx with Summary sheet (SheetJS)
│   │   ├── mt940Formatter.js        # SWIFT MT940 Customer Statement
│   │   ├── mt942Formatter.js        # SWIFT MT942 Interim Report
│   │   ├── mt950Formatter.js        # SWIFT MT950 Bank Statement
│   │   ├── mt103Formatter.js        # SWIFT MT103 Credit Transfer
│   │   ├── mt202Formatter.js        # SWIFT MT202 Bank Transfer
│   │   ├── bai2Formatter.js         # BAI2 (US cash management)
│   │   └── camt053Formatter.js      # ISO 20022 camt.053 XML
│   └── utils/
│       ├── randomizer.js            # Random data helpers
│       └── fileWriter.js            # File I/O utility
└── output/
    ├── ledger/                      # Generated ledger files
    └── statement/                   # Generated statement files
CLI Usage

# Basic: 1000 records as CSV (ledger + statement)
npm run generate-data -- --records=1000 --format=csv --file=both

# SWIFT MT940 statement only
npm run generate-data -- --records=500 --format=mt940 --file=statement

# All formats at once
npm run generate-data -- --records=5000 --format=all

# Specific currency and custom output directory
node src/index.js --records=2000 --format=excel --currency=EUR --output=./test-data

# Show help
node src/index.js --help
Reconciliation Scenarios Generated
Scenario	%	Description
perfectMatch	50%	1:1 exact match — same amount, date, ref
oneToMany	15%	1 ledger → 2-3 statement entries (split payment)
manyToOne	15%	2-3 ledger → 1 statement entry (consolidated)
unmatchedLedger	5%	Ledger with no statement counterpart
unmatchedStatement	5%	Statement with no ledger counterpart
amountDiff	5%	Matched by ref but amounts differ ±0.1–5%
dateDiff	5%	Matched by ref but value date differs 1-5 days
Supported Output Formats (12 total)
Flat Files: CSV, Pipe |, Fixed-Width, JSON, Excel (.xlsx with Summary tab)

SWIFT MT: MT940, MT942, MT950, MT103, MT202

ISO 20022: camt.053 (XML — valid schema)

US Banking: BAI2 (full record structure: 01/02/03/16/49/98/99)


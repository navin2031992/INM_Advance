#!/usr/bin/env node
/**
 * IntelliMatch MCP Server
 * ========================
 * Exposes the IntelliMatch FIS Dummy Data Generator as an MCP (Model Context Protocol)
 * server so AI assistants (Claude Code, Roo Code, Cline) can:
 *
 *   1. Generate test data files via natural language prompts
 *   2. Preview output before committing to full generation
 *   3. Create entirely new output formats on-the-fly
 *   4. Add new import schema rows without manual coding
 *
 * Tools exposed:
 *   generate_test_data    — run the generator with given parameters
 *   list_formats          — list all registered output formats
 *   list_scenarios        — list reconciliation scenario types
 *   list_import_schemas   — list all import schema definitions
 *   preview_data          — preview 10 records as inline text
 *   create_output_format  — add a brand-new file formatter dynamically
 *   add_import_schema     — add a new ERP/import schema row mapping
 *   get_generated_files   — list recently generated output files
 *
 * Security model (internal organisational use):
 *   - Transport: stdio only — NOT a network socket, not reachable from outside the machine
 *   - spawn() uses shell:false + array args — no shell injection
 *   - All user-supplied paths are confined to PROJECT_ROOT
 *   - customCode and expressions are scanned for dangerous Node.js APIs
 *   - All enum-style inputs are validated against known-good allow-lists
 *   - Records are capped to prevent memory/disk exhaustion
 */

import { Server }               from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { spawn }        from 'child_process';
import {
  readFileSync, writeFileSync,
  readdirSync, existsSync, rmSync
} from 'fs';
import { join, dirname, resolve, normalize } from 'path';
import { fileURLToPath }                     from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

// ── Allow-lists & limits ──────────────────────────────────────────────────────

const VALID_FORMATS = new Set([
  'csv','pipe','json','fixedwidth','excel','tsv',
  'mt940','mt942','mt950','mt103','mt202','mt300','mt535','mt910',
  'bai2','camt053','camt052','camt054',
  'nacha','ofx','pain001','pain002','pacs008','all'
]);

const VALID_SCENARIOS = new Set([
  'perfect','oneToMany','manyToOne',
  'unmatchedLedger','unmatchedStatement',
  'amountDiff','dateDiff'
]);

const VALID_FILE_TYPES   = new Set(['ledger','statement','both']);
const VALID_DATE_FORMATS = new Set(['YYYY-MM-DD','DDMMYYYY','YYYYMMDD','DD/MM/YYYY','MM/DD/YYYY']);
const CURRENCY_RE        = /^[A-Z]{3}$/;
const IDENTIFIER_RE      = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXT_RE             = /^[a-z0-9]{1,10}$/;

const MAX_RECORDS         = 50_000;
const MAX_LIST_LIMIT      = 100;
const MAX_FIELD_MAPPINGS  = 100;

// ── Security guards ───────────────────────────────────────────────────────────

/**
 * Ensures a user-supplied path resolves inside PROJECT_ROOT.
 * Throws on path traversal or absolute paths that escape the project.
 */
function assertWithinProject(userPath) {
  const abs = resolve(PROJECT_ROOT, userPath);
  const rel = abs.startsWith(PROJECT_ROOT + '\\') || abs.startsWith(PROJECT_ROOT + '/');
  if (!rel && abs !== PROJECT_ROOT) {
    throw new Error(
      `Path "${userPath}" resolves outside the project directory. ` +
      'Only paths inside the project folder are allowed.'
    );
  }
  return abs;
}

/**
 * Scans code strings for dangerous Node.js APIs that have no place in a
 * data-formatting function. Throws with the matched pattern if found.
 *
 * This is a defence-in-depth measure for internal use — it stops accidental
 * or naive misuse. It is NOT a full sandbox.
 */
const DANGEROUS_CODE_PATTERNS = [
  { re: /\bchild_process\b/,          label: 'child_process module' },
  { re: /\bexecSync\s*\(/,            label: 'execSync()' },
  { re: /\bexecFileSync\s*\(/,        label: 'execFileSync()' },
  { re: /\bspawnSync\s*\(/,           label: 'spawnSync()' },
  { re: /\bexec\s*\(\s*[`'"]/,        label: 'exec() with string argument' },
  { re: /\beval\s*\(/,                label: 'eval()' },
  { re: /new\s+Function\s*\(/,        label: 'new Function()' },
  { re: /\bprocess\s*\.\s*exit/,      label: 'process.exit()' },
  { re: /\bprocess\s*\.\s*env\b/,     label: 'process.env access' },
  { re: /\bprocess\s*\.\s*kill/,      label: 'process.kill()' },
  { re: /\brequire\s*\(\s*['"`](?!\.)[^./]/, label: 'require() of non-relative module' },
  { re: /\bimport\s*\(/,              label: 'dynamic import()' },
  { re: /\bfs\s*\.\s*(unlinkSync|rmSync|rmdirSync|writeFile|appendFile|unlink|rm)\s*\(/, label: 'fs destructive write/delete' },
  { re: /\bnet\b|\bhttp\b|\bhttps\b/, label: 'network module (net/http/https)' },
];

function checkDangerousCode(code, context = 'code') {
  for (const { re, label } of DANGEROUS_CODE_PATTERNS) {
    if (re.test(code)) {
      throw new Error(
        `Rejected: ${context} contains "${label}" which is not permitted in generator extensions. ` +
        'Formatter code must only transform the records array into a string — no system calls, ' +
        'no network, no file I/O.'
      );
    }
  }
}

/**
 * Validates that a string is a safe JS identifier (used for outputField / sourceField).
 */
function assertIdentifier(value, fieldLabel) {
  if (!value || !IDENTIFIER_RE.test(value)) {
    throw new Error(
      `"${fieldLabel}" value "${value}" is not a valid JavaScript identifier. ` +
      'Use only letters, digits, and underscores, starting with a letter or underscore.'
    );
  }
}

/**
 * Strips characters that could break out of a JS comment or single-quoted string.
 * Used for user-supplied description / label text embedded in generated source.
 */
function sanitizeText(text) {
  return String(text || '')
    .replace(/\*\//g, '*-/')      // prevent comment escape
    .replace(/'/g, "\\'")         // escape single quotes
    .replace(/[\r\n]/g, ' ')      // flatten newlines
    .slice(0, 256);               // hard length cap
}

/**
 * Escapes a value that will be written inside a JS single-quoted string literal.
 */
function escapeForSingleQuotedString(value) {
  return String(value === undefined ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/[\r\n]/g, ' ');
}

// ── Static metadata ───────────────────────────────────────────────────────────

const FORMAT_DESCRIPTIONS = {
  csv:        'Comma-separated values (RFC 4180 compliant)',
  pipe:       'Pipe-delimited flat file',
  json:       'JSON array with 2-space indentation',
  fixedwidth: 'Fixed-width positional flat file with header/separator lines',
  excel:      'Microsoft Excel (.xlsx) — data sheet + summary sheet',
  tsv:        'Tab-Separated Values — SAP / Oracle / analytics tool import',
  mt940:      'SWIFT MT940 Customer Statement',
  mt942:      'SWIFT MT942 Interim Transaction Report (intraday)',
  mt950:      'SWIFT MT950 Bank-to-Bank Statement',
  mt103:      'SWIFT MT103 Single Customer Credit Transfer',
  mt202:      'SWIFT MT202 Bank Transfer',
  mt300:      'SWIFT MT300 Foreign Exchange Confirmation',
  mt535:      'SWIFT MT535 Statement of Holdings (securities)',
  bai2:       'BAI2 Cash Management (US banking standard)',
  camt053:    'ISO 20022 camt.053 Bank-to-Customer Statement (XML)',
  nacha:      'US ACH / NACHA payment file — 94-char fixed-width, CCD standard entry',
  ofx:        'OFX 2.2 XML — QuickBooks / Sage / Quicken bank reconciliation feed',
  camt052:    'ISO 20022 camt.052 Intraday Account Report — includes PDNG (pending) entries',
  camt054:    'ISO 20022 camt.054 Debit/Credit Notification — real-time individual transaction alert',
  pain001:    'ISO 20022 pain.001 Payment Initiation — outbound credit transfer instructions',
  pain002:    'ISO 20022 pain.002 Payment Status Report — bank acceptance/rejection response to pain.001',
  pacs008:    'ISO 20022 pacs.008 FI-to-FI Customer Credit Transfer — SWIFT MX replacement for MT103 (CBPR+)',
  mt910:      'SWIFT MT910/MT900 Confirmation of Credit/Debit — bank confirmation of received/sent payment',
};

const SCENARIO_DESCRIPTIONS = {
  perfect:            '1:1 exact match — same amount, date, and reference number',
  oneToMany:          '1:N — one ledger entry → 2–3 statement entries (split payment)',
  manyToOne:          'N:1 — multiple ledger entries → one statement entry (consolidation)',
  unmatchedLedger:    'Ledger entry with no corresponding statement counterpart',
  unmatchedStatement: 'Statement entry with no corresponding ledger counterpart',
  amountDiff:         'Same reference but amounts differ by ±0.1–5%',
  dateDiff:           'Same reference but value date differs by 1–5 business days'
};

const BUILTIN_SCHEMA_DESCRIPTIONS = {
  GL:        'General Ledger — ERP GL journal entries (SAP/Oracle compatible)',
  AP:        'Accounts Payable — vendor invoices and outgoing payments',
  AR:        'Accounts Receivable — customer invoices and incoming receipts',
  BANK:      'Bank Statement — standard cash transactions with IBAN/BIC',
  BROKERAGE: 'Brokerage Statement — securities trading (equities, bonds, ETFs)',
  CUSTODIAN: 'Custodian Statement — asset custody and safekeeping'
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function runGenerator(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['src/index.js', ...args], {
      cwd:   PROJECT_ROOT,
      shell: false           // never run through a shell — prevents shell injection
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Generator failed (exit ${code}):\n${stderr}\n${stdout}`));
    });
    proc.on('error', reject);
  });
}

function getOutputFiles(outputDir, limit = 20) {
  const files = [];
  for (const sub of ['ledger', 'statement']) {
    const dir = join(outputDir, sub);
    if (existsSync(dir)) {
      readdirSync(dir).forEach(f => files.push(`${sub}/${f}`));
    }
  }
  return files.sort().reverse().slice(0, limit);
}

function discoverFormats() {
  const formattersDir = join(PROJECT_ROOT, 'src', 'formatters');
  const formats = { ...FORMAT_DESCRIPTIONS };
  try {
    readdirSync(formattersDir).forEach(file => {
      if (file.endsWith('Formatter.js') && file !== 'importFormatMapper.js') {
        const raw = file.replace('Formatter.js', '');
        const key = raw.charAt(0).toLowerCase() + raw.slice(1);
        if (!formats[key]) formats[key] = `Custom formatter: ${raw}`;
      }
    });
  } catch (_) {}
  return formats;
}

function readImportSchemas() {
  const mapperPath = join(PROJECT_ROOT, 'src', 'formatters', 'importFormatMapper.js');
  const content    = readFileSync(mapperPath, 'utf8');
  const ledgerM    = content.match(/ledger:\s+\[([^\]]+)\]/);
  const stmtM      = content.match(/statement:\s+\[([^\]]+)\]/);
  const ledger = ledgerM ? ledgerM[1].replace(/['"]/g, '').split(',').map(s => s.trim()) : [];
  const stmt   = stmtM   ? stmtM[1].replace(/['"]/g, '').split(',').map(s => s.trim())  : [];
  return { ledger, statement: stmt };
}

// ── Code generators ───────────────────────────────────────────────────────────

function buildDelimitedFormatter(formatName, delimiter, description, ext) {
  const cap     = formatName.charAt(0).toUpperCase() + formatName.slice(1);
  const delStr  = delimiter === '\t' ? "'\\t'" : `'${delimiter}'`;
  const safeDesc = sanitizeText(description);
  return `'use strict';

// ${cap} Formatter — ${safeDesc}
// Auto-generated by IntelliMatch MCP Server

const DELIMITER = ${delStr};

function formatRows(records) {
  if (!records.length) return '';
  const headers = Object.keys(records[0]);
  const lines   = [headers.join(DELIMITER)];
  for (const rec of records) {
    lines.push(headers.map(h => String(rec[h] == null ? '' : rec[h])).join(DELIMITER));
  }
  return lines.join('\\n');
}

function formatLedger(records)    { return formatRows(records); }
function formatStatement(records) { return formatRows(records); }

module.exports = { formatLedger, formatStatement, ext: '${ext}' };
`;
}

function buildImportMapperFn(schemaName, recordType, description, fieldMappings) {
  const prefix = recordType === 'ledger' ? 'toLedger' : 'toStatement';
  const fnName = `${prefix}${schemaName}`;
  const safeDesc = sanitizeText(description);

  const fieldLines = fieldMappings.map(f => {
    assertIdentifier(f.outputField, 'outputField');

    if (f.static !== undefined) {
      // Escape value for a single-quoted string literal
      return `    ${f.outputField}: '${escapeForSingleQuotedString(f.static)}'`;
    } else if (f.expression) {
      // expression is already scanned for dangerous patterns by the caller
      return `    ${f.outputField}: ${f.expression}`;
    } else {
      assertIdentifier(f.sourceField || f.outputField, 'sourceField');
      return `    ${f.outputField}: rec.${f.sourceField || f.outputField}`;
    }
  }).join(',\n');

  return `
/**
 * ${schemaName} — ${safeDesc}
 * Auto-generated by IntelliMatch MCP Server
 */
function ${fnName}(rec) {
  return {
${fieldLines},
    MatchType: rec.MatchType
  };
}
`;
}

// ── Source-file patchers ──────────────────────────────────────────────────────

function patchIndexForNewFormat(formatName) {
  const indexPath = join(PROJECT_ROOT, 'src', 'index.js');
  let content = readFileSync(indexPath, 'utf8');

  if (new RegExp(`['"]${formatName}['"]`).test(content)) return false;

  content = content.replace(
    /(  \w[\w]*:\s+require\('[^']+'\))\n\};\n\n\/\/ ──/,
    `$1,\n  ${formatName.padEnd(10)}: require('./formatters/${formatName}Formatter')\n};\n\n// ──`
  );

  // Insert before 'all' in VALID_FORMATS
  content = content.replace(/,'all'\]/, `,'${formatName}','all']`);

  writeFileSync(indexPath, content, 'utf8');
  return true;
}

function patchImportMapperForNewSchema(schemaName, recordType, description, mapperCode) {
  const mapperPath = join(PROJECT_ROOT, 'src', 'formatters', 'importFormatMapper.js');
  let content = readFileSync(mapperPath, 'utf8');

  if (new RegExp(`['"]${schemaName}['"]`).test(content)) return false;

  // 1. Insert mapper function before the Public API section
  content = content.replace(
    /\/\/ ── Public API ─+/,
    `${mapperCode}\n// ── Public API ─────────────────────────────────────────────────────────────────`
  );

  // 2. Register in VALID_IMPORT_FORMATS
  if (recordType === 'ledger') {
    content = content.replace(
      /ledger:\s+\[([^\]]+)\]/,
      (_, inner) => `ledger:    [${inner.trim()}, '${schemaName}']`
    );
    content = content.replace(
      /    default:   return records;  \/\/ passthrough/,
      `    case '${schemaName}': return records.map(toLedger${schemaName});\n    default:   return records;  // passthrough`
    );
  } else {
    content = content.replace(
      /statement:\s+\[([^\]]+)\]/,
      (_, inner) => `statement: [${inner.trim()}, '${schemaName}']`
    );
    content = content.replace(
      /    default:          return records;\n  \}/,
      `    case '${schemaName}': return records.map(toStatement${schemaName});\n    default:          return records;\n  }`
    );
  }

  // 3. Add description — insert just before };\n  return map[fmt
  const insertBefore = "\n  };\n  return map[fmt.toUpperCase()] || fmt;";
  const idx = content.lastIndexOf(insertBefore);
  if (idx !== -1) {
    const safeDesc = sanitizeText(description);
    content = content.slice(0, idx)
      + `,\n    ${schemaName}: '${safeDesc}'`
      + content.slice(idx);
  }

  writeFileSync(mapperPath, content, 'utf8');
  return true;
}

// ── MCP server setup ──────────────────────────────────────────────────────────

const server = new Server(
  { name: 'intellimatch-data-generator', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// ── Tool definitions ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ── 1. generate_test_data ────────────────────────────────────────────────
    {
      name: 'generate_test_data',
      description:
        'Generate IntelliMatch financial test data files. ' +
        'Returns the generator log and a list of created file paths.',
      inputSchema: {
        type: 'object',
        properties: {
          records: {
            type: 'number',
            description: `Number of ledger records (default: 100, max: ${MAX_RECORDS})`,
            default: 100
          },
          format: {
            type: 'string',
            description:
              'Output format: csv | pipe | json | fixedwidth | excel | tsv | ' +
              'mt940 | mt942 | mt950 | mt103 | mt202 | mt300 | mt535 | mt910 | ' +
              'bai2 | camt053 | camt052 | camt054 | nacha | ofx | ' +
              'pain001 | pain002 | pacs008 | all  (default: csv)'
          },
          file: {
            type: 'string',
            description: 'Files to generate: ledger | statement | both  (default: both)'
          },
          scenario: {
            type: 'string',
            description:
              'Reconciliation scenario: perfect | oneToMany | manyToOne | ' +
              'unmatchedLedger | unmatchedStatement | amountDiff | dateDiff. ' +
              'Comma-separate for multiple. Omit for mixed percentage-based distribution.'
          },
          importFormat: {
            type: 'string',
            description:
              'Import schema: GL | AP | AR | BANK | BROKERAGE | CUSTODIAN. ' +
              'Use "GL:BANK" colon syntax for combined ledger:statement schemas. ' +
              'Omit for the default raw field layout.'
          },
          currency: {
            type: 'string',
            description: 'Override currency as 3-letter ISO code, e.g. USD, EUR, GBP'
          },
          dateFormat: {
            type: 'string',
            description:
              'Date format for tabular outputs: YYYY-MM-DD | DDMMYYYY | YYYYMMDD | DD/MM/YYYY | MM/DD/YYYY'
          },
          outputDir: {
            type: 'string',
            description: 'Output directory relative to project root (default: ./output)'
          },
          split: {
            type: 'number',
            description: 'oneToMany scenario: fixed number of statement splits per group (>=2)'
          },
          consolidate: {
            type: 'number',
            description: 'manyToOne scenario: fixed number of ledger entries per group (>=2)'
          },
          ledgerAccounts: {
            type: 'string',
            description:
              'Comma-separated ledger account numbers to use in the generated data, ' +
              'e.g. "10001,20001,30001,40001". ' +
              'Overrides the defaults in generator.config.json for this run. ' +
              'Each account: letters, digits, hyphens, underscores (max 50 chars). ' +
              'If omitted, the config defaults are used.'
          },
          bankAccounts: {
            type: 'string',
            description:
              'Comma-separated bank account numbers / IBANs to use in the generated data, ' +
              'e.g. "GB29NWBK60161331926819,DE89370400440532013000,US123456789012345678". ' +
              'Overrides the defaults in generator.config.json for this run. ' +
              'Each entry: uppercase letters and digits only, 4–34 characters (IBAN format). ' +
              'If omitted, the config defaults are used.'
          }
        }
      }
    },

    // ── 2. list_formats ──────────────────────────────────────────────────────
    {
      name: 'list_formats',
      description: 'List all available output formats (built-in + any custom formats you have added).',
      inputSchema: { type: 'object', properties: {} }
    },

    // ── 3. list_scenarios ────────────────────────────────────────────────────
    {
      name: 'list_scenarios',
      description: 'List all reconciliation scenario types with descriptions.',
      inputSchema: { type: 'object', properties: {} }
    },

    // ── 4. list_import_schemas ───────────────────────────────────────────────
    {
      name: 'list_import_schemas',
      description: 'List all available import schema formats (ledger and statement sides).',
      inputSchema: { type: 'object', properties: {} }
    },

    // ── 5. preview_data ──────────────────────────────────────────────────────
    {
      name: 'preview_data',
      description:
        'Generate 10 records and return the file content inline as text. ' +
        'Use this to review what the output looks like before running a full generation.',
      inputSchema: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            description: 'Output format (default: csv)'
          },
          scenario: {
            type: 'string',
            description: 'Scenario (default: perfect)'
          },
          importFormat: {
            type: 'string',
            description: 'Import schema (optional)'
          },
          file: {
            type: 'string',
            description: 'ledger | statement | both  (default: ledger)'
          }
        }
      }
    },

    // ── 6. create_output_format ──────────────────────────────────────────────
    {
      name: 'create_output_format',
      description:
        'Create a brand-new output file formatter so the generator can produce a ' +
        'previously unsupported file format. ' +
        'After this call the format key becomes available as --format=<formatName>. ' +
        'Use this when a new file format requirement arrives (e.g. TSV, semicolon-delimited, ' +
        'a proprietary XML layout, ISO 20022 pain.001, etc.).',
      inputSchema: {
        type: 'object',
        required: ['formatName'],
        properties: {
          formatName: {
            type: 'string',
            description:
              'Short LOWERCASE identifier for the format, e.g. "tsv", "semicolon", "sapcsv". ' +
              'Must be unique and match [a-z][a-z0-9_]*.'
          },
          formatDescription: {
            type: 'string',
            description: 'Human-readable description, e.g. "Tab-separated for SAP import"'
          },
          formatType: {
            type: 'string',
            description: '"delimited" (auto-generate from delimiter) | "custom" (provide full code)',
            default: 'delimited'
          },
          delimiter: {
            type: 'string',
            description:
              'Field delimiter for delimited formatType. Use "\\t" for tab, ";" for semicolon, ' +
              '"," for comma, "|" for pipe.'
          },
          fileExtension: {
            type: 'string',
            description: 'File extension without dot, e.g. "tsv", "txt", "dat" (lowercase letters/digits only, max 10 chars). Defaults to formatName.'
          },
          customCode: {
            type: 'string',
            description:
              'Full JavaScript CommonJS module code for custom formatters. ' +
              'Must export: formatLedger(records), formatStatement(records), ext (string). ' +
              'Required when formatType is "custom". Overrides auto-generation for "delimited" too. ' +
              'System calls (exec, eval, process.exit, fs writes, network) are blocked.'
          }
        }
      }
    },

    // ── 7. add_import_schema ─────────────────────────────────────────────────
    {
      name: 'add_import_schema',
      description:
        'Add a new import schema that maps raw generated records into a different field layout. ' +
        'Use this when a new ERP system, data format, or row structure is required ' +
        '(e.g. SAP_HANA, ORACLE_AP, NETSUITE_GL, DYNAMICS365). ' +
        'After this call the schema becomes available as --importFormat=<schemaName>.',
      inputSchema: {
        type: 'object',
        required: ['schemaName', 'recordType', 'fieldMappings'],
        properties: {
          schemaName: {
            type: 'string',
            description:
              'UPPERCASE identifier, e.g. "SAP_HANA", "ORACLE_AP". Must match [A-Z][A-Z0-9_]*.'
          },
          recordType: {
            type: 'string',
            description: '"ledger" (maps from raw ledger fields) or "statement" (maps from raw statement fields)'
          },
          description: {
            type: 'string',
            description: 'Human-readable description shown in --help and list_import_schemas'
          },
          fieldMappings: {
            type: 'array',
            description:
              'Array of field mapping objects. Each object must have outputField plus one of: ' +
              'sourceField (direct copy), static (constant value), or expression (JS code using rec.*).',
            items: {
              type: 'object',
              required: ['outputField'],
              properties: {
                outputField:  { type: 'string', description: 'Output field name (valid JS identifier)' },
                sourceField:  { type: 'string', description: 'Source field from the raw record (valid JS identifier)' },
                static:       { type: 'string', description: 'Constant string value' },
                expression:   { type: 'string', description: 'JavaScript expression using rec.* fields, e.g. rec.Currency or rec.TxnID.replace("LDG","INV")' }
              }
            }
          },
          customCode: {
            type: 'string',
            description:
              'Full JavaScript mapper function (optional). Must define a function named ' +
              'toLedger<SCHEMANAME> or toStatement<SCHEMANAME>. ' +
              'Overrides auto-generation from fieldMappings when provided. ' +
              'System calls (exec, eval, process.exit, fs writes, network) are blocked.'
          }
        }
      }
    },

    // ── 8. get_generated_files ───────────────────────────────────────────────
    {
      name: 'get_generated_files',
      description: 'List the most recently generated output files.',
      inputSchema: {
        type: 'object',
        properties: {
          outputDir: {
            type: 'string',
            description: 'Output directory relative to project root (default: ./output)'
          },
          limit: {
            type: 'number',
            description: `Max files to return (default: 20, max: ${MAX_LIST_LIMIT})`,
            default: 20
          }
        }
      }
    }
  ]
}));

// ── Tool handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    // ── generate_test_data ───────────────────────────────────────────────────
    if (name === 'generate_test_data') {

      // ── Input validation ──
      if (args.records !== undefined) {
        const n = Number(args.records);
        if (!Number.isInteger(n) || n < 1) throw new Error('records must be a positive integer.');
        if (n > MAX_RECORDS) throw new Error(`records cannot exceed ${MAX_RECORDS} to prevent resource exhaustion.`);
      }

      if (args.format && args.format !== 'all') {
        // Also allow custom formats registered after server start
        const allFormats = new Set([...VALID_FORMATS, ...Object.keys(discoverFormats())]);
        if (!allFormats.has(args.format)) {
          throw new Error(`Unknown format "${args.format}". Valid: ${[...allFormats].join(', ')}`);
        }
      }

      if (args.file && !VALID_FILE_TYPES.has(args.file)) {
        throw new Error(`Unknown file type "${args.file}". Valid: ${[...VALID_FILE_TYPES].join(', ')}`);
      }

      if (args.scenario) {
        const requested = String(args.scenario).split(',').map(s => s.trim());
        for (const s of requested) {
          if (!VALID_SCENARIOS.has(s)) {
            throw new Error(`Unknown scenario "${s}". Valid: ${[...VALID_SCENARIOS].join(', ')}`);
          }
        }
      }

      if (args.dateFormat && !VALID_DATE_FORMATS.has(args.dateFormat)) {
        throw new Error(`Unknown dateFormat "${args.dateFormat}". Valid: ${[...VALID_DATE_FORMATS].join(', ')}`);
      }

      if (args.currency && !CURRENCY_RE.test(args.currency)) {
        throw new Error('currency must be a 3-letter ISO 4217 code, e.g. USD, EUR, GBP.');
      }

      if (args.outputDir) {
        assertWithinProject(args.outputDir);
      }

      // Validate ledgerAccounts — each token: letters/digits/hyphens/underscores, max 50 chars
      const LEDGER_ACC_RE = /^[A-Za-z0-9_-]{1,50}$/;
      if (args.ledgerAccounts !== undefined) {
        const accs = String(args.ledgerAccounts).split(',').map(a => a.trim()).filter(Boolean);
        if (accs.length === 0) throw new Error('ledgerAccounts must contain at least one account number.');
        for (const a of accs) {
          if (!LEDGER_ACC_RE.test(a)) {
            throw new Error(
              `Invalid ledger account "${a}". ` +
              'Each account may only contain letters, digits, hyphens, or underscores (max 50 chars).'
            );
          }
        }
      }

      // Validate bankAccounts — each token: IBAN-style uppercase letters+digits, 4–34 chars
      const BANK_ACC_RE = /^[A-Z0-9]{4,34}$/;
      if (args.bankAccounts !== undefined) {
        const accs = String(args.bankAccounts).split(',').map(a => a.trim()).filter(Boolean);
        if (accs.length === 0) throw new Error('bankAccounts must contain at least one account number.');
        for (const a of accs) {
          if (!BANK_ACC_RE.test(a)) {
            throw new Error(
              `Invalid bank account "${a}". ` +
              'Each entry must be 4–34 uppercase letters and digits (IBAN format), e.g. GB29NWBK60161331926819.'
            );
          }
        }
      }

      // ── Build command args ──
      const cmdArgs = [];
      if (args.records)        cmdArgs.push(`--records=${args.records}`);
      if (args.format)         cmdArgs.push(`--format=${args.format}`);
      if (args.file)           cmdArgs.push(`--file=${args.file}`);
      if (args.scenario)       cmdArgs.push(`--scenario=${args.scenario}`);
      if (args.importFormat)   cmdArgs.push(`--importFormat=${args.importFormat}`);
      if (args.currency)       cmdArgs.push(`--currency=${args.currency}`);
      if (args.dateFormat)     cmdArgs.push(`--dateFormat=${args.dateFormat}`);
      if (args.outputDir)      cmdArgs.push(`--output=${args.outputDir}`);
      if (args.split)          cmdArgs.push(`--split=${args.split}`);
      if (args.consolidate)    cmdArgs.push(`--consolidate=${args.consolidate}`);
      if (args.ledgerAccounts) cmdArgs.push(`--ledgerAccounts=${args.ledgerAccounts}`);
      if (args.bankAccounts)   cmdArgs.push(`--bankAccounts=${args.bankAccounts}`);

      const output = await runGenerator(cmdArgs);
      const outDir = args.outputDir
        ? assertWithinProject(args.outputDir)
        : join(PROJECT_ROOT, 'output');
      const files  = getOutputFiles(outDir);

      return {
        content: [{
          type: 'text',
          text: [
            'Generation complete!',
            '',
            output.trim(),
            '',
            'Generated files:',
            ...files.map(f => `  ${f}`)
          ].join('\n')
        }]
      };
    }

    // ── list_formats ─────────────────────────────────────────────────────────
    if (name === 'list_formats') {
      const formats = discoverFormats();
      const lines   = Object.entries(formats).map(([k, v]) => `  ${k.padEnd(12)}: ${v}`);
      return {
        content: [{
          type: 'text',
          text: `Available output formats (${Object.keys(formats).length} total):\n\n${lines.join('\n')}\n\nTip: use "all" to generate every format in one run.`
        }]
      };
    }

    // ── list_scenarios ───────────────────────────────────────────────────────
    if (name === 'list_scenarios') {
      const lines = Object.entries(SCENARIO_DESCRIPTIONS)
        .map(([k, v]) => `  ${k.padEnd(22)}: ${v}`);
      return {
        content: [{
          type: 'text',
          text: `Reconciliation scenarios:\n\n${lines.join('\n')}\n\nTip: comma-separate for multiple — e.g. "perfect,amountDiff".`
        }]
      };
    }

    // ── list_import_schemas ──────────────────────────────────────────────────
    if (name === 'list_import_schemas') {
      const schemas = readImportSchemas();
      const desc    = { ...BUILTIN_SCHEMA_DESCRIPTIONS };

      const ledgerLines = schemas.ledger.map(
        s => `  ${s.padEnd(14)}: ${desc[s] || 'Custom schema'}`
      );
      const stmtLines = schemas.statement.map(
        s => `  ${s.padEnd(14)}: ${desc[s] || 'Custom schema'}`
      );

      return {
        content: [{
          type: 'text',
          text: [
            `LEDGER schemas (${schemas.ledger.length}):`,
            ...ledgerLines,
            '',
            `STATEMENT schemas (${schemas.statement.length}):`,
            ...stmtLines,
            '',
            'Usage: --importFormat=GL  or  --importFormat=GL:BANK  (combined)'
          ].join('\n')
        }]
      };
    }

    // ── preview_data ─────────────────────────────────────────────────────────
    if (name === 'preview_data') {
      const format   = args.format   || 'csv';
      const scenario = args.scenario || 'perfect';
      const fileType = args.file     || 'ledger';

      // Validate
      const allFormats = new Set([...VALID_FORMATS, ...Object.keys(discoverFormats())]);
      if (!allFormats.has(format)) {
        throw new Error(`Unknown format "${format}". Valid: ${[...allFormats].join(', ')}`);
      }
      if (!VALID_SCENARIOS.has(scenario)) {
        throw new Error(`Unknown scenario "${scenario}". Valid: ${[...VALID_SCENARIOS].join(', ')}`);
      }
      if (!VALID_FILE_TYPES.has(fileType)) {
        throw new Error(`Unknown file type "${fileType}". Valid: ${[...VALID_FILE_TYPES].join(', ')}`);
      }

      const tempDir = join(PROJECT_ROOT, '.mcp_preview_tmp');

      try {
        const cmdArgs = [
          '--records=10',
          `--format=${format}`,
          `--scenario=${scenario}`,
          `--file=${fileType}`,
          `--output=${tempDir}`
        ];
        if (args.importFormat) cmdArgs.push(`--importFormat=${args.importFormat}`);

        await runGenerator(cmdArgs);

        const subName = fileType === 'statement' ? 'statement' : 'ledger';
        const subDir  = join(tempDir, subName);

        if (!existsSync(subDir)) {
          return { content: [{ type: 'text', text: 'No preview files were generated.' }] };
        }

        const files = readdirSync(subDir);
        if (!files.length) {
          return { content: [{ type: 'text', text: 'No preview files found.' }] };
        }

        const firstFile = join(subDir, files[0]);
        const content   = readFileSync(firstFile, 'utf8');

        return {
          content: [{
            type: 'text',
            text: [
              `Preview — format: ${format} | scenario: ${scenario} | file: ${fileType} | 10 records`,
              '',
              '```',
              content.slice(0, 5000),
              content.length > 5000 ? '... (truncated)' : '',
              '```'
            ].join('\n')
          }]
        };
      } finally {
        try { rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
      }
    }

    // ── create_output_format ─────────────────────────────────────────────────
    if (name === 'create_output_format') {
      const {
        formatName,
        formatDescription = '',
        formatType        = 'delimited',
        delimiter         = ',',
        fileExtension,
        customCode
      } = args;

      // Validate formatName
      if (!formatName || !/^[a-z][a-z0-9_]*$/.test(formatName)) {
        throw new Error(
          'formatName must be lowercase alphanumeric (e.g. "tsv", "semicolon", "sapcsv"). ' +
          'Pattern: [a-z][a-z0-9_]*'
        );
      }

      // Validate fileExtension
      const ext = fileExtension || formatName;
      if (!EXT_RE.test(ext)) {
        throw new Error(
          `fileExtension "${ext}" must be lowercase letters/digits only, max 10 characters.`
        );
      }

      // Validate delimiter for delimited type
      if (!customCode && formatType === 'delimited') {
        if (typeof delimiter !== 'string' || delimiter.length === 0 || delimiter.length > 4) {
          throw new Error('delimiter must be a non-empty string of 1–4 characters.');
        }
      }

      const formatterPath = join(PROJECT_ROOT, 'src', 'formatters', `${formatName}Formatter.js`);

      if (existsSync(formatterPath)) {
        throw new Error(
          `Formatter already exists at src/formatters/${formatName}Formatter.js. ` +
          'Choose a different name or edit the file directly.'
        );
      }

      let code;
      if (customCode) {
        if (!customCode.includes('formatLedger') || !customCode.includes('formatStatement')) {
          throw new Error(
            'customCode must export both formatLedger(records) and formatStatement(records). ' +
            'It must also export ext (file extension string).'
          );
        }
        // Security: scan for dangerous patterns before writing to disk
        checkDangerousCode(customCode, 'customCode');
        code = customCode;
      } else if (formatType === 'delimited') {
        code = buildDelimitedFormatter(formatName, delimiter, formatDescription, ext);
      } else {
        throw new Error(
          'For non-delimited formatType, provide customCode containing the full formatter module. ' +
          'Example: export formatLedger(records), formatStatement(records), and ext.'
        );
      }

      writeFileSync(formatterPath, code, 'utf8');
      const registered = patchIndexForNewFormat(formatName);

      return {
        content: [{
          type: 'text',
          text: [
            `New output format "${formatName}" created!`,
            '',
            `  Formatter file : src/formatters/${formatName}Formatter.js`,
            `  Format key     : ${formatName}`,
            `  File extension : .${ext}`,
            `  Registered     : ${registered ? 'yes — added to VALID_FORMATS and formatters registry' : 'already registered'}`,
            '',
            'You can now generate data with:',
            `  node src/index.js --format=${formatName}`,
            `  npm run generate -- --format=${formatName}`,
            '',
            'Generated formatter code:',
            '```javascript',
            code,
            '```'
          ].join('\n')
        }]
      };
    }

    // ── add_import_schema ────────────────────────────────────────────────────
    if (name === 'add_import_schema') {
      const {
        schemaName,
        recordType,
        description   = '',
        fieldMappings = [],
        customCode
      } = args;

      // Validate schemaName
      if (!schemaName || !/^[A-Z][A-Z0-9_]*$/.test(schemaName)) {
        throw new Error(
          'schemaName must be UPPERCASE alphanumeric (e.g. "SAP_GL", "ORACLE_AP"). ' +
          'Pattern: [A-Z][A-Z0-9_]*'
        );
      }
      if (!['ledger', 'statement'].includes(recordType)) {
        throw new Error('recordType must be "ledger" or "statement".');
      }
      if (!fieldMappings.length && !customCode) {
        throw new Error('Provide either fieldMappings (array) or customCode (function string).');
      }
      if (fieldMappings.length > MAX_FIELD_MAPPINGS) {
        throw new Error(`fieldMappings cannot exceed ${MAX_FIELD_MAPPINGS} entries.`);
      }

      // Validate each field mapping
      for (const f of fieldMappings) {
        assertIdentifier(f.outputField, 'outputField');
        if (f.expression) {
          checkDangerousCode(f.expression, `expression for field "${f.outputField}"`);
        }
        if (f.sourceField) {
          assertIdentifier(f.sourceField, 'sourceField');
        }
      }

      let mapperCode;
      if (customCode) {
        const expectedFn = recordType === 'ledger'
          ? `toLedger${schemaName}`
          : `toStatement${schemaName}`;
        if (!customCode.includes(expectedFn)) {
          throw new Error(
            `customCode must define a function named "${expectedFn}". ` +
            `For ${recordType} schemas the naming convention is ${expectedFn}(rec) { return {...}; }.`
          );
        }
        // Security: scan for dangerous patterns before patching source file
        checkDangerousCode(customCode, 'customCode');
        mapperCode = customCode;
      } else {
        mapperCode = buildImportMapperFn(schemaName, recordType, description, fieldMappings);
      }

      const patched = patchImportMapperForNewSchema(schemaName, recordType, description, mapperCode);
      if (!patched) {
        throw new Error(
          `Schema "${schemaName}" already exists in importFormatMapper.js. ` +
          'Choose a different schemaName or edit the file directly.'
        );
      }

      return {
        content: [{
          type: 'text',
          text: [
            `New import schema "${schemaName}" added!`,
            '',
            `  Schema name : ${schemaName}`,
            `  Record type : ${recordType}`,
            `  Description : ${description || '(none)'}`,
            `  Fields      : ${fieldMappings.length} mapped`,
            '',
            'You can now use it:',
            `  node src/index.js --importFormat=${schemaName}`,
            `  npm run generate -- --importFormat=${schemaName}:BANK  (combined with statement schema)`,
            '',
            'Generated mapper code:',
            '```javascript',
            mapperCode.trim(),
            '```'
          ].join('\n')
        }]
      };
    }

    // ── get_generated_files ──────────────────────────────────────────────────
    if (name === 'get_generated_files') {
      const outDir = args.outputDir
        ? assertWithinProject(args.outputDir)
        : join(PROJECT_ROOT, 'output');

      const limit = Math.min(Number(args.limit) || 20, MAX_LIST_LIMIT);
      const files = getOutputFiles(outDir, limit);

      if (!files.length) {
        return {
          content: [{
            type: 'text',
            text: `No generated files found in: ${outDir}\n\nRun generate_test_data first.`
          }]
        };
      }

      return {
        content: [{
          type: 'text',
          text: `Generated files in ${outDir} (newest first):\n\n${files.map(f => `  ${f}`).join('\n')}`
        }]
      };
    }

    throw new Error(`Unknown tool: "${name}"`);

  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error in ${name}: ${err.message}` }],
      isError: true
    };
  }
});

// ── Connect and start ─────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

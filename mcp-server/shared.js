/**
 * shared.js — IntelliMatch MCP core logic
 *
 * Shared between stdio (index.js) and HTTP (http-server.js) transports.
 * Exports: PROJECT_ROOT, getToolDefinitions, callTool, setupServer
 */

import { spawn }                                       from 'child_process';
import { readFileSync, writeFileSync,
         readdirSync, existsSync, rmSync }             from 'fs';
import { join, dirname, resolve }                      from 'path';
import { fileURLToPath }                               from 'url';
import { Server }                                      from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema,
         ListToolsRequestSchema }                      from '@modelcontextprotocol/sdk/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
export const PROJECT_ROOT = resolve(__dirname, '..');

// ── Allow-lists & limits ──────────────────────────────────────────────────────

const VALID_FORMATS = new Set([
  'csv','pipe','json','fixedwidth','excel',
  'mt940','mt942','mt950','mt103','mt202','mt300','mt535',
  'bai2','camt053','all'
]);

const VALID_SCENARIOS    = new Set(['perfect','oneToMany','manyToOne','unmatchedLedger','unmatchedStatement','amountDiff','dateDiff']);
const VALID_FILE_TYPES   = new Set(['ledger','statement','both']);
const VALID_DATE_FORMATS = new Set(['YYYY-MM-DD','DDMMYYYY','YYYYMMDD','DD/MM/YYYY','MM/DD/YYYY']);
const CURRENCY_RE        = /^[A-Z]{3}$/;
const IDENTIFIER_RE      = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXT_RE             = /^[a-z0-9]{1,10}$/;
const MAX_RECORDS        = 50_000;
const MAX_LIST_LIMIT     = 100;
const MAX_FIELD_MAPPINGS = 100;

// ── Security guards ───────────────────────────────────────────────────────────

function assertWithinProject(userPath) {
  // Block UNC paths (\\server\share) and Windows device paths (\\.\, \\?\) before resolve()
  if (/^\\\\/.test(userPath) || /^\/\//.test(userPath)) {
    throw new Error('UNC and network paths are not allowed.');
  }
  const abs = resolve(PROJECT_ROOT, userPath);
  // Block Windows device paths that survive resolve()
  if (/^\\\\[?.][\\/]/.test(abs)) {
    throw new Error('Windows device paths are not allowed.');
  }
  const rel = abs.startsWith(PROJECT_ROOT + '\\') || abs.startsWith(PROJECT_ROOT + '/');
  if (!rel && abs !== PROJECT_ROOT) {
    throw new Error(
      `Path "${userPath}" resolves outside the project directory. ` +
      'Only paths inside the project folder are allowed.'
    );
  }
  return abs;
}

// ── Code security patterns (used for customCode + expression fields) ──────────
// Defence-in-depth for internal use. Covers both obvious and obfuscation-based
// bypasses. NOT a full sandbox — use vm isolation for full sandboxing.

const DANGEROUS_CODE_PATTERNS = [
  // ── Child process / exec ────────────────────────────────────────────────────
  { re: /\bchild_process\b/,            label: 'child_process module' },
  { re: /\bexecSync\s*\(/,              label: 'execSync()' },
  { re: /\bexecFileSync\s*\(/,          label: 'execFileSync()' },
  { re: /\bspawnSync\s*\(/,             label: 'spawnSync()' },
  { re: /\bexecFile\s*\(/,              label: 'execFile()' },
  { re: /\bspawn\s*\(/,                 label: 'spawn()' },
  { re: /\bfork\s*\(/,                  label: 'fork()' },
  { re: /\bexec\s*\(\s*[`'"]/,          label: 'exec() with string argument' },
  // ── eval / Function constructor ──────────────────────────────────────────────
  { re: /\beval\s*\(/,                  label: 'eval()' },
  { re: /\(0,\s*eval\)/,               label: 'indirect eval via comma operator' },
  { re: /new\s+Function\s*\(/,          label: 'new Function()' },
  { re: /Function\s*\.\s*prototype\s*\.\s*constructor/, label: 'Function.prototype.constructor' },
  // ── process access ───────────────────────────────────────────────────────────
  { re: /\bprocess\s*\.\s*exit/,        label: 'process.exit()' },
  { re: /\bprocess\s*\.\s*env\b/,       label: 'process.env access' },
  { re: /\bprocess\s*\.\s*kill/,        label: 'process.kill()' },
  { re: /\bprocess\s*\.\s*mainModule\b/, label: 'process.mainModule access' },
  { re: /\.mainModule\b/,               label: '.mainModule access' },
  // ── module / require / import ────────────────────────────────────────────────
  { re: /\brequire\s*\(/,               label: 'require() call (custom code must not import modules)' },
  { re: /\bimport\s*\(/,                label: 'dynamic import()' },
  { re: /\bmodule\s*\.\s*require\s*\(/, label: 'module.require()' },
  // ── prototype / global object access (obfuscation paths) ────────────────────
  { re: /\bglobalThis\b/,               label: 'globalThis access' },
  { re: /\.constructor\s*[([]/,         label: '.constructor() access (prototype chain escalation)' },
  { re: /\.__proto__\b/,                label: '__proto__ access' },
  { re: /\.prototype\s*[.[]/,           label: '.prototype access' },
  // ── String-based obfuscation ─────────────────────────────────────────────────
  { re: /\[['"`][^'"`]{1,32}['"`]\]/,  label: 'bracket string property access (potential obfuscation)' },
  { re: /\\x[0-9a-fA-F]{2}/,           label: 'hex character escape (potential obfuscation)' },
  { re: /\\u[0-9a-fA-F]{4}/,           label: 'unicode character escape (potential obfuscation)' },
  // ── File system (destructive) ────────────────────────────────────────────────
  { re: /\bfs\s*\.\s*(unlinkSync|rmSync|rmdirSync|writeFile|appendFile|unlink|rm)\s*\(/, label: 'fs destructive write/delete' },
  // ── Network ──────────────────────────────────────────────────────────────────
  { re: /\bnet\b|\bhttp\b|\bhttps\b/,   label: 'network module (net/http/https)' },
];

function checkDangerousCode(code, context = 'code') {
  for (const { re, label } of DANGEROUS_CODE_PATTERNS) {
    if (re.test(code)) {
      throw new Error(
        `Rejected: ${context} contains "${label}" which is not permitted in generator extensions. ` +
        'Code must only transform the records array into a string — no system calls, ' +
        'no network, no file I/O, no module imports.'
      );
    }
  }
}

// Stricter check for field expression strings (must start with rec.* or a literal value)
function checkDangerousExpression(expr, fieldName) {
  const trimmed = expr.trim();
  // Expression must reference rec.* or be a string/number literal or a ternary based on rec.*
  if (!/^(rec\.[A-Za-z_]|'[^']*'|"[^"]*"|`[^`]*`|-?\d)/.test(trimmed)) {
    throw new Error(
      `expression for field "${fieldName}" must start with rec.<fieldName> or a string/number literal. ` +
      `Got: "${trimmed.slice(0, 60)}"`
    );
  }
  checkDangerousCode(expr, `expression for field "${fieldName}"`);
}

function assertIdentifier(value, fieldLabel) {
  if (!value || !IDENTIFIER_RE.test(value)) {
    throw new Error(
      `"${fieldLabel}" value "${value}" is not a valid JavaScript identifier. ` +
      'Use only letters, digits, and underscores, starting with a letter or underscore.'
    );
  }
}

function sanitizeText(text) {
  return String(text || '')
    .replace(/\*\//g, '*-/')
    .replace(/'/g, "\\'")
    .replace(/[\r\n]/g, ' ')
    .slice(0, 256);
}

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
  mt940:      'SWIFT MT940 Customer Statement',
  mt942:      'SWIFT MT942 Interim Transaction Report (intraday)',
  mt950:      'SWIFT MT950 Bank-to-Bank Statement',
  mt103:      'SWIFT MT103 Single Customer Credit Transfer',
  mt202:      'SWIFT MT202 Bank Transfer',
  mt300:      'SWIFT MT300 Foreign Exchange Confirmation',
  mt535:      'SWIFT MT535 Statement of Holdings (securities)',
  bai2:       'BAI2 Cash Management (US banking standard)',
  camt053:    'ISO 20022 camt.053 Bank-to-Customer Statement (XML)'
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
      shell: false
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

export function discoverFormats() {
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
      return `    ${f.outputField}: '${escapeForSingleQuotedString(f.static)}'`;
    } else if (f.expression) {
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
    /(  \w[\w]*:\s+require\('[^']+'\))\r?\n\};\r?\n\r?\n\/\/ ──/,
    `$1,\n  ${formatName.padEnd(10)}: require('./formatters/${formatName}Formatter')\n};\n\n// ──`
  );
  content = content.replace(/,'all'\]/, `,'${formatName}','all']`);
  writeFileSync(indexPath, content, 'utf8');
  return true;
}

function patchImportMapperForNewSchema(schemaName, recordType, description, mapperCode) {
  const mapperPath = join(PROJECT_ROOT, 'src', 'formatters', 'importFormatMapper.js');
  let content = readFileSync(mapperPath, 'utf8');
  if (new RegExp(`['"]${schemaName}['"]`).test(content)) return false;

  content = content.replace(
    /\/\/ ── Public API ─+/,
    `${mapperCode}\n// ── Public API ─────────────────────────────────────────────────────────────────`
  );

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
      /    default:          return records;\r?\n  \}/,
      `    case '${schemaName}': return records.map(toStatement${schemaName});\n    default:          return records;\n  }`
    );
  }

  let insertBefore = "\r\n  };\r\n  return map[fmt.toUpperCase()] || fmt;";
  let idx = content.lastIndexOf(insertBefore);
  if (idx === -1) {
    insertBefore = "\n  };\n  return map[fmt.toUpperCase()] || fmt;";
    idx = content.lastIndexOf(insertBefore);
  }
  if (idx !== -1) {
    const safeDesc = sanitizeText(description);
    content = content.slice(0, idx) + `,\n    ${schemaName}: '${safeDesc}'` + content.slice(idx);
  }

  writeFileSync(mapperPath, content, 'utf8');
  return true;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export function getToolDefinitions() {
  return [
    {
      name: 'generate_test_data',
      description:
        'Generate IntelliMatch financial test data files. ' +
        'Returns the generator log and a list of created file paths.',
      inputSchema: {
        type: 'object',
        properties: {
          records:      { type: 'number',  description: `Number of ledger records (default: 100, max: ${MAX_RECORDS})`, default: 100 },
          format:       { type: 'string',  description: 'Output format: csv | pipe | json | fixedwidth | excel | mt940 | mt942 | mt950 | mt103 | mt202 | mt300 | mt535 | bai2 | camt053 | all  (default: csv)' },
          file:         { type: 'string',  description: 'Files to generate: ledger | statement | both  (default: both)' },
          scenario:     { type: 'string',  description: 'Reconciliation scenario: perfect | oneToMany | manyToOne | unmatchedLedger | unmatchedStatement | amountDiff | dateDiff. Comma-separate for multiple.' },
          importFormat: { type: 'string',  description: 'Import schema: GL | AP | AR | BANK | BROKERAGE | CUSTODIAN. Use "GL:BANK" for combined ledger:statement.' },
          currency:     { type: 'string',  description: '3-letter ISO currency code, e.g. USD, EUR, GBP' },
          dateFormat:   { type: 'string',  description: 'Date format: YYYY-MM-DD | DDMMYYYY | YYYYMMDD | DD/MM/YYYY | MM/DD/YYYY' },
          outputDir:    { type: 'string',  description: 'Output directory relative to project root (default: ./output)' },
          split:        { type: 'number',  description: 'oneToMany scenario: fixed statement splits per group (>=2)' },
          consolidate:  { type: 'number',  description: 'manyToOne scenario: fixed ledger entries per group (>=2)' }
        }
      }
    },
    {
      name: 'list_formats',
      description: 'List all available output formats (built-in + any custom formats added).',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'list_scenarios',
      description: 'List all reconciliation scenario types with descriptions.',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'list_import_schemas',
      description: 'List all available import schema formats (ledger and statement sides).',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'preview_data',
      description: 'Generate 10 records and return the file content inline as text. Use before full generation to review the output.',
      inputSchema: {
        type: 'object',
        properties: {
          format:       { type: 'string', description: 'Output format (default: csv)' },
          scenario:     { type: 'string', description: 'Scenario (default: perfect)' },
          importFormat: { type: 'string', description: 'Import schema (optional)' },
          file:         { type: 'string', description: 'ledger | statement | both  (default: ledger)' }
        }
      }
    },
    {
      name: 'create_output_format',
      description:
        'Create a brand-new output file formatter. ' +
        'After this call the format key becomes available as --format=<formatName>. ' +
        'Use when a new file format requirement arrives (e.g. TSV, semicolon-delimited, proprietary XML).',
      inputSchema: {
        type: 'object',
        required: ['formatName'],
        properties: {
          formatName:        { type: 'string', description: 'Short lowercase identifier e.g. "tsv", "sapcsv". Pattern: [a-z][a-z0-9_]*' },
          formatDescription: { type: 'string', description: 'Human-readable description' },
          formatType:        { type: 'string', description: '"delimited" (auto-generate from delimiter) | "custom" (provide full code)', default: 'delimited' },
          delimiter:         { type: 'string', description: 'Field delimiter for delimited type: "\\t", ";", ",", "|"' },
          fileExtension:     { type: 'string', description: 'File extension without dot, e.g. "tsv", "dat" (lowercase, max 10 chars)' },
          customCode:        { type: 'string', description: 'Full CommonJS module code. Must export formatLedger(records), formatStatement(records), ext. System calls are blocked.' }
        }
      }
    },
    {
      name: 'add_import_schema',
      description:
        'Add a new import schema that maps raw generated records into a different field layout. ' +
        'Use when a new ERP system or row structure is required (e.g. SAP_HANA, ORACLE_AP, NETSUITE_GL).',
      inputSchema: {
        type: 'object',
        required: ['schemaName', 'recordType', 'fieldMappings'],
        properties: {
          schemaName:   { type: 'string', description: 'UPPERCASE identifier e.g. "SAP_HANA". Pattern: [A-Z][A-Z0-9_]*' },
          recordType:   { type: 'string', description: '"ledger" or "statement"' },
          description:  { type: 'string', description: 'Human-readable description shown in --help' },
          fieldMappings: {
            type: 'array',
            description: 'Array of { outputField, sourceField? | static? | expression? }',
            items: {
              type: 'object',
              required: ['outputField'],
              properties: {
                outputField: { type: 'string', description: 'Output field name (valid JS identifier)' },
                sourceField: { type: 'string', description: 'Source field from the raw record' },
                static:      { type: 'string', description: 'Constant string value' },
                expression:  { type: 'string', description: 'JS expression using rec.* fields' }
              }
            }
          },
          customCode: { type: 'string', description: 'Full mapper function (optional). Overrides fieldMappings.' }
        }
      }
    },
    {
      name: 'get_generated_files',
      description: 'List the most recently generated output files.',
      inputSchema: {
        type: 'object',
        properties: {
          outputDir: { type: 'string', description: 'Output directory relative to project root (default: ./output)' },
          limit:     { type: 'number', description: `Max files to return (default: 20, max: ${MAX_LIST_LIMIT})`, default: 20 }
        }
      }
    }
  ];
}

// ── Tool call handler ─────────────────────────────────────────────────────────

export async function callTool(name, args = {}) {

  // ── generate_test_data ──────────────────────────────────────────────────────
  if (name === 'generate_test_data') {
    if (args.records !== undefined) {
      const n = Number(args.records);
      if (!Number.isInteger(n) || n < 1) throw new Error('records must be a positive integer.');
      if (n > MAX_RECORDS) throw new Error(`records cannot exceed ${MAX_RECORDS} to prevent resource exhaustion.`);
    }
    if (args.format && args.format !== 'all') {
      const allFormats = new Set([...VALID_FORMATS, ...Object.keys(discoverFormats())]);
      if (!allFormats.has(args.format)) throw new Error(`Unknown format "${args.format}". Valid: ${[...allFormats].join(', ')}`);
    }
    if (args.file && !VALID_FILE_TYPES.has(args.file)) {
      throw new Error(`Unknown file type "${args.file}". Valid: ${[...VALID_FILE_TYPES].join(', ')}`);
    }
    if (args.scenario) {
      for (const s of String(args.scenario).split(',').map(s => s.trim())) {
        if (!VALID_SCENARIOS.has(s)) throw new Error(`Unknown scenario "${s}". Valid: ${[...VALID_SCENARIOS].join(', ')}`);
      }
    }
    if (args.dateFormat && !VALID_DATE_FORMATS.has(args.dateFormat)) {
      throw new Error(`Unknown dateFormat "${args.dateFormat}". Valid: ${[...VALID_DATE_FORMATS].join(', ')}`);
    }
    if (args.currency && !CURRENCY_RE.test(args.currency)) {
      throw new Error('currency must be a 3-letter ISO 4217 code, e.g. USD, EUR, GBP.');
    }
    if (args.outputDir) assertWithinProject(args.outputDir);
    // importFormat: allow SCHEMA or SCHEMA:SCHEMA — only uppercase identifiers
    if (args.importFormat && !/^[A-Z][A-Z0-9_]*(:[A-Z][A-Z0-9_]*)?$/.test(args.importFormat)) {
      throw new Error('importFormat must be an uppercase schema name or SCHEMA:SCHEMA pair, e.g. "GL" or "GL:BANK".');
    }

    const cmdArgs = [];
    if (args.records)      cmdArgs.push(`--records=${args.records}`);
    if (args.format)       cmdArgs.push(`--format=${args.format}`);
    if (args.file)         cmdArgs.push(`--file=${args.file}`);
    if (args.scenario)     cmdArgs.push(`--scenario=${args.scenario}`);
    if (args.importFormat) cmdArgs.push(`--importFormat=${args.importFormat}`);
    if (args.currency)     cmdArgs.push(`--currency=${args.currency}`);
    if (args.dateFormat)   cmdArgs.push(`--dateFormat=${args.dateFormat}`);
    if (args.outputDir)    cmdArgs.push(`--output=${args.outputDir}`);
    if (args.split)        cmdArgs.push(`--split=${args.split}`);
    if (args.consolidate)  cmdArgs.push(`--consolidate=${args.consolidate}`);

    const output = await runGenerator(cmdArgs);
    const outDir = args.outputDir ? assertWithinProject(args.outputDir) : join(PROJECT_ROOT, 'output');
    const files  = getOutputFiles(outDir);

    return {
      content: [{
        type: 'text',
        text: ['Generation complete!', '', output.trim(), '', 'Generated files:', ...files.map(f => `  ${f}`)].join('\n')
      }]
    };
  }

  // ── list_formats ────────────────────────────────────────────────────────────
  if (name === 'list_formats') {
    const formats = discoverFormats();
    const lines   = Object.entries(formats).map(([k, v]) => `  ${k.padEnd(12)}: ${v}`);
    return {
      content: [{ type: 'text', text: `Available output formats (${Object.keys(formats).length} total):\n\n${lines.join('\n')}\n\nTip: use "all" to generate every format in one run.` }]
    };
  }

  // ── list_scenarios ──────────────────────────────────────────────────────────
  if (name === 'list_scenarios') {
    const lines = Object.entries(SCENARIO_DESCRIPTIONS).map(([k, v]) => `  ${k.padEnd(22)}: ${v}`);
    return {
      content: [{ type: 'text', text: `Reconciliation scenarios:\n\n${lines.join('\n')}\n\nTip: comma-separate for multiple — e.g. "perfect,amountDiff".` }]
    };
  }

  // ── list_import_schemas ─────────────────────────────────────────────────────
  if (name === 'list_import_schemas') {
    const schemas = readImportSchemas();
    const desc    = { ...BUILTIN_SCHEMA_DESCRIPTIONS };
    const ledgerLines = schemas.ledger.map(s => `  ${s.padEnd(14)}: ${desc[s] || 'Custom schema'}`);
    const stmtLines   = schemas.statement.map(s => `  ${s.padEnd(14)}: ${desc[s] || 'Custom schema'}`);
    return {
      content: [{
        type: 'text',
        text: [`LEDGER schemas (${schemas.ledger.length}):`, ...ledgerLines, '', `STATEMENT schemas (${schemas.statement.length}):`, ...stmtLines, '', 'Usage: --importFormat=GL  or  --importFormat=GL:BANK  (combined)'].join('\n')
      }]
    };
  }

  // ── preview_data ────────────────────────────────────────────────────────────
  if (name === 'preview_data') {
    const format   = args.format   || 'csv';
    const scenario = args.scenario || 'perfect';
    const fileType = args.file     || 'ledger';

    const allFormats = new Set([...VALID_FORMATS, ...Object.keys(discoverFormats())]);
    if (!allFormats.has(format))        throw new Error(`Unknown format "${format}". Valid: ${[...allFormats].join(', ')}`);
    if (!VALID_SCENARIOS.has(scenario)) throw new Error(`Unknown scenario "${scenario}". Valid: ${[...VALID_SCENARIOS].join(', ')}`);
    if (!VALID_FILE_TYPES.has(fileType)) throw new Error(`Unknown file type "${fileType}". Valid: ${[...VALID_FILE_TYPES].join(', ')}`);
    if (args.importFormat && !/^[A-Z][A-Z0-9_]*(:[A-Z][A-Z0-9_]*)?$/.test(args.importFormat)) {
      throw new Error('importFormat must be an uppercase schema name or SCHEMA:SCHEMA pair, e.g. "GL" or "GL:BANK".');
    }

    const tempDir = join(PROJECT_ROOT, '.mcp_preview_tmp');
    try {
      const cmdArgs = ['--records=10', `--format=${format}`, `--scenario=${scenario}`, `--file=${fileType}`, `--output=${tempDir}`];
      if (args.importFormat) cmdArgs.push(`--importFormat=${args.importFormat}`);
      await runGenerator(cmdArgs);

      const subName = fileType === 'statement' ? 'statement' : 'ledger';
      const subDir  = join(tempDir, subName);
      if (!existsSync(subDir)) return { content: [{ type: 'text', text: 'No preview files were generated.' }] };

      const files = readdirSync(subDir);
      if (!files.length)  return { content: [{ type: 'text', text: 'No preview files found.' }] };

      const content = readFileSync(join(subDir, files[0]), 'utf8');
      return {
        content: [{
          type: 'text',
          text: [`Preview — format: ${format} | scenario: ${scenario} | file: ${fileType} | 10 records`, '', '```', content.slice(0, 5000), content.length > 5000 ? '... (truncated)' : '', '```'].join('\n')
        }]
      };
    } finally {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    }
  }

  // ── create_output_format ────────────────────────────────────────────────────
  if (name === 'create_output_format') {
    const { formatName, formatDescription = '', formatType = 'delimited', delimiter = ',', fileExtension, customCode } = args;

    if (!formatName || !/^[a-z][a-z0-9_]*$/.test(formatName)) {
      throw new Error('formatName must be lowercase alphanumeric (e.g. "tsv", "semicolon", "sapcsv"). Pattern: [a-z][a-z0-9_]*');
    }
    const ext = fileExtension || formatName;
    if (!EXT_RE.test(ext)) throw new Error(`fileExtension "${ext}" must be lowercase letters/digits only, max 10 characters.`);
    if (!customCode && formatType === 'delimited') {
      if (typeof delimiter !== 'string' || delimiter.length === 0 || delimiter.length > 4) {
        throw new Error('delimiter must be a non-empty string of 1–4 characters.');
      }
    }

    const formatterPath = join(PROJECT_ROOT, 'src', 'formatters', `${formatName}Formatter.js`);
    if (existsSync(formatterPath)) {
      throw new Error(`Formatter already exists at src/formatters/${formatName}Formatter.js. Choose a different name or edit the file directly.`);
    }

    let code;
    if (customCode) {
      if (!customCode.includes('formatLedger') || !customCode.includes('formatStatement')) {
        throw new Error('customCode must export both formatLedger(records) and formatStatement(records), and also export ext.');
      }
      checkDangerousCode(customCode, 'customCode');
      code = customCode;
    } else if (formatType === 'delimited') {
      code = buildDelimitedFormatter(formatName, delimiter, formatDescription, ext);
    } else {
      throw new Error('For non-delimited formatType, provide customCode containing the full formatter module.');
    }

    writeFileSync(formatterPath, code, 'utf8');
    const registered = patchIndexForNewFormat(formatName);

    return {
      content: [{
        type: 'text',
        text: [
          `New output format "${formatName}" created!`, '',
          `  Formatter file : src/formatters/${formatName}Formatter.js`,
          `  Format key     : ${formatName}`,
          `  File extension : .${ext}`,
          `  Registered     : ${registered ? 'yes — added to VALID_FORMATS and formatters registry' : 'already registered'}`,
          '', 'You can now generate data with:',
          `  node src/index.js --format=${formatName}`,
          '', 'Generated formatter code:', '```javascript', code, '```'
        ].join('\n')
      }]
    };
  }

  // ── add_import_schema ───────────────────────────────────────────────────────
  if (name === 'add_import_schema') {
    const { schemaName, recordType, description = '', fieldMappings = [], customCode } = args;

    if (!schemaName || !/^[A-Z][A-Z0-9_]*$/.test(schemaName)) {
      throw new Error('schemaName must be UPPERCASE alphanumeric (e.g. "SAP_GL", "ORACLE_AP"). Pattern: [A-Z][A-Z0-9_]*');
    }
    if (!['ledger', 'statement'].includes(recordType)) throw new Error('recordType must be "ledger" or "statement".');
    if (!fieldMappings.length && !customCode) throw new Error('Provide either fieldMappings (array) or customCode (function string).');
    if (fieldMappings.length > MAX_FIELD_MAPPINGS) throw new Error(`fieldMappings cannot exceed ${MAX_FIELD_MAPPINGS} entries.`);

    for (const f of fieldMappings) {
      assertIdentifier(f.outputField, 'outputField');
      // Use stricter expression check — must start with rec.* or a literal, no eval/process/require
      if (f.expression) checkDangerousExpression(f.expression, f.outputField);
      if (f.sourceField) assertIdentifier(f.sourceField, 'sourceField');
    }

    let mapperCode;
    if (customCode) {
      const expectedFn = recordType === 'ledger' ? `toLedger${schemaName}` : `toStatement${schemaName}`;
      if (!customCode.includes(expectedFn)) {
        throw new Error(`customCode must define a function named "${expectedFn}".`);
      }
      checkDangerousCode(customCode, 'customCode');
      mapperCode = customCode;
    } else {
      mapperCode = buildImportMapperFn(schemaName, recordType, description, fieldMappings);
    }

    const patched = patchImportMapperForNewSchema(schemaName, recordType, description, mapperCode);
    if (!patched) {
      throw new Error(`Schema "${schemaName}" already exists in importFormatMapper.js. Choose a different schemaName or edit the file directly.`);
    }

    return {
      content: [{
        type: 'text',
        text: [
          `New import schema "${schemaName}" added!`, '',
          `  Schema name : ${schemaName}`,
          `  Record type : ${recordType}`,
          `  Description : ${description || '(none)'}`,
          `  Fields      : ${fieldMappings.length} mapped`,
          '', 'You can now use it:',
          `  node src/index.js --importFormat=${schemaName}`,
          `  npm run generate -- --importFormat=${schemaName}:BANK`,
          '', 'Generated mapper code:', '```javascript', mapperCode.trim(), '```'
        ].join('\n')
      }]
    };
  }

  // ── get_generated_files ─────────────────────────────────────────────────────
  if (name === 'get_generated_files') {
    const outDir = args.outputDir ? assertWithinProject(args.outputDir) : join(PROJECT_ROOT, 'output');
    const limit  = Math.min(Number(args.limit) || 20, MAX_LIST_LIMIT);
    const files  = getOutputFiles(outDir, limit);

    if (!files.length) {
      return { content: [{ type: 'text', text: `No generated files found in: ${outDir}\n\nRun generate_test_data first.` }] };
    }
    return { content: [{ type: 'text', text: `Generated files in ${outDir} (newest first):\n\n${files.map(f => `  ${f}`).join('\n')}` }] };
  }

  throw new Error(`Unknown tool: "${name}"`);
}

// ── MCP server factory ────────────────────────────────────────────────────────

export function setupServer(server) {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: getToolDefinitions() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      return await callTool(name, args);
    } catch (err) {
      return { content: [{ type: 'text', text: `Error in ${name}: ${err.message}` }], isError: true };
    }
  });
}

export function createMcpServer() {
  const srv = new Server(
    { name: 'intellimatch-data-generator', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  setupServer(srv);
  return srv;
}

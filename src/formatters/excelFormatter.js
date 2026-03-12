'use strict';

/**
 * Excel (.xlsx) Formatter — produces multi-sheet XLSX workbooks.
 *
 * Uses the `xlsx` npm package (SheetJS).
 * Ledger workbook:   "Ledger" sheet + "Summary" sheet
 * Statement workbook: "Statement" sheet + "Summary" sheet
 */

let XLSX;
try {
  XLSX = require('xlsx');
} catch (e) {
  XLSX = null;
}

/**
 * Builds a summary worksheet showing match type distribution.
 */
function buildSummarySheet(records, idField) {
  const typeCounts = {};
  for (const rec of records) {
    const t = rec.MatchType || 'unknown';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  const summaryData = [
    ['Match Type', 'Record Count', 'Percentage'],
    ...Object.entries(typeCounts).map(([type, count]) => [
      type,
      count,
      `${((count / records.length) * 100).toFixed(1)}%`
    ]),
    [],
    ['Total Records', records.length, '100%']
  ];

  return XLSX.utils.aoa_to_sheet(summaryData);
}

/**
 * Applies column widths and header styling to a worksheet.
 */
function styleSheet(ws, headers) {
  ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 2, 14) }));
}

/**
 * Produces an XLSX buffer for ledger records.
 * Returns Buffer or null if xlsx not available.
 */
function formatLedger(records) {
  if (!XLSX) {
    throw new Error('xlsx package not installed. Run: npm install xlsx');
  }
  if (records.length === 0) return Buffer.alloc(0);

  const wb = XLSX.utils.book_new();

  // Main ledger sheet
  const headers = Object.keys(records[0]);
  const wsData  = [headers, ...records.map(r => headers.map(h => r[h]))];
  const ws      = XLSX.utils.aoa_to_sheet(wsData);
  styleSheet(ws, headers);
  XLSX.utils.book_append_sheet(wb, ws, 'Ledger');

  // Summary sheet
  const summaryWs = buildSummarySheet(records, 'TxnID');
  styleSheet(summaryWs, ['Match Type', 'Record Count', 'Percentage']);
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Produces an XLSX buffer for statement records.
 */
function formatStatement(records) {
  if (!XLSX) {
    throw new Error('xlsx package not installed. Run: npm install xlsx');
  }
  if (records.length === 0) return Buffer.alloc(0);

  const wb = XLSX.utils.book_new();

  // Main statement sheet
  const headers = Object.keys(records[0]);
  const wsData  = [headers, ...records.map(r => headers.map(h => r[h]))];
  const ws      = XLSX.utils.aoa_to_sheet(wsData);
  styleSheet(ws, headers);
  XLSX.utils.book_append_sheet(wb, ws, 'Statement');

  // Summary sheet
  const summaryWs = buildSummarySheet(records, 'StatementID');
  styleSheet(summaryWs, ['Match Type', 'Record Count', 'Percentage']);
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { formatLedger, formatStatement, ext: 'xlsx', isBinary: true };

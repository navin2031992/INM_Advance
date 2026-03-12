'use strict';

/**
 * CSV Formatter — produces comma-separated output.
 */

function escape(val) {
  const s = String(val == null ? '' : val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatLedger(records) {
  if (records.length === 0) return '';
  const headers = Object.keys(records[0]);
  const lines = [headers.join(',')];
  for (const rec of records) {
    lines.push(headers.map(h => escape(rec[h])).join(','));
  }
  return lines.join('\n');
}

function formatStatement(records) {
  return formatLedger(records); // same structure logic
}

module.exports = { formatLedger, formatStatement, ext: 'csv' };

'use strict';

/**
 * Pipe-Separated Formatter — produces |-delimited output.
 */

function formatLedger(records) {
  if (records.length === 0) return '';
  const headers = Object.keys(records[0]);
  const lines = [headers.join('|')];
  for (const rec of records) {
    lines.push(headers.map(h => String(rec[h] == null ? '' : rec[h]).replace(/\|/g, '_')).join('|'));
  }
  return lines.join('\n');
}

function formatStatement(records) {
  return formatLedger(records);
}

module.exports = { formatLedger, formatStatement, ext: 'txt' };

'use strict';

/**
 * TSV Formatter — Tab-Separated Values.
 *
 * Widely used by SAP, Oracle, and analytics tools (pandas, Excel Power Query).
 * Avoids the quoting ambiguity of CSV when field values contain commas.
 */

function formatRows(records) {
  if (records.length === 0) return '';
  const headers = Object.keys(records[0]);
  const lines   = [headers.join('\t')];
  for (const rec of records) {
    lines.push(
      headers
        .map(h => String(rec[h] == null ? '' : rec[h]).replace(/[\t\r\n]/g, ' '))
        .join('\t')
    );
  }
  return lines.join('\n');
}

function formatLedger(records)    { return formatRows(records); }
function formatStatement(records) { return formatRows(records); }

module.exports = { formatLedger, formatStatement, ext: 'tsv' };

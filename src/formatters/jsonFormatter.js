'use strict';

/**
 * JSON Formatter — produces a JSON array of records.
 */

function formatLedger(records) {
  return JSON.stringify(records, null, 2);
}

function formatStatement(records) {
  return JSON.stringify(records, null, 2);
}

module.exports = { formatLedger, formatStatement, ext: 'json' };

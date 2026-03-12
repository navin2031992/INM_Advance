'use strict';

/**
 * File Writer utility for IntelliMatch data generator.
 * Handles writing both text and binary output files to the output directory.
 */

const fs   = require('fs');
const path = require('path');

/**
 * Ensures a directory exists, creating it recursively if needed.
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Writes a file (text or binary) to disk.
 *
 * @param {string} filePath  - absolute or relative file path
 * @param {string|Buffer} content - file content
 * @param {boolean} binary   - whether to write as binary buffer
 */
function writeFile(filePath, content, binary = false) {
  ensureDir(path.dirname(filePath));
  if (binary) {
    fs.writeFileSync(filePath, content);
  } else {
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

/**
 * Builds the output file path for a ledger or statement file.
 *
 * @param {string}  outputDir - base output directory
 * @param {string}  fileType  - 'ledger' or 'statement'
 * @param {string}  format    - format name (e.g. 'csv', 'xlsx')
 * @param {string}  ext       - file extension
 * @param {number}  records   - record count (used in filename)
 * @param {string}  [scenario] - optional scenario tag (e.g. 'perfect', 'oneToMany+manyToOne')
 * @returns {string}
 */
function buildFilePath(outputDir, fileType, format, ext, records, scenario) {
  const timestamp   = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const scenarioTag = scenario ? `_${scenario}` : '';
  const dir         = path.join(outputDir, fileType);
  const name        = `${fileType}_${format}${scenarioTag}_${records}rec_${timestamp}.${ext}`;
  return path.join(dir, name);
}

module.exports = { writeFile, buildFilePath, ensureDir };

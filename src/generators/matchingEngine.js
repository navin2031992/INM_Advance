'use strict';

/**
 * Matching Engine for IntelliMatch reconciliation scenarios.
 *
 * Produces a list of "match groups" that describe how ledger entries
 * relate to bank statement entries. The generators consume these groups
 * to build the actual records with consistent amounts, dates, and references.
 *
 * Scenario types:
 *   - perfect            : 1 ledger ↔ 1 statement, same amount, date, ref
 *   - oneToMany          : 1 ledger ↔ 2-N statement entries (split payment)
 *   - manyToOne          : 2-N ledger ↔ 1 statement entry (consolidated)
 *   - unmatchedLedger    : ledger entry with no corresponding statement
 *   - unmatchedStatement : statement entry with no corresponding ledger
 *   - amountDiff         : 1 ledger ↔ 1 statement, amounts differ slightly
 *   - dateDiff           : 1 ledger ↔ 1 statement, value date differs
 *
 * Exports:
 *   buildMatchGroups(records, config)          — percentage-based mixed distribution
 *   buildScenarioGroups(scenarios, records, config, opts) — pure scenario-focused generation
 */

const { randInt, randomDate, formatDate, addBusinessDays, randomAmount, slightAmountDiff, randomRef, randomBankRef, randFrom } = require('../utils/randomizer');

// ── Valid scenario names ──────────────────────────────────────────────────────
const VALID_SCENARIOS = ['perfect', 'oneToMany', 'manyToOne', 'unmatchedLedger', 'unmatchedStatement', 'amountDiff', 'dateDiff'];

/**
 * Builds match groups for one or more explicitly chosen scenarios.
 * All `totalRecords` are distributed evenly across the requested scenarios.
 *
 * @param {string[]} scenarios   - array of scenario names from VALID_SCENARIOS
 * @param {number}   totalRecords - total ledger-record budget
 * @param {object}   config       - generator config
 * @param {object}   opts
 * @param {number}   [opts.split]       - fixed split count for oneToMany (overrides random 2-3)
 * @param {number}   [opts.consolidate] - fixed consolidate count for manyToOne (overrides random 2-3)
 * @returns {object[]} matchGroups
 */
function buildScenarioGroups(scenarios, totalRecords, config, opts = {}) {
  if (!scenarios || scenarios.length === 0) {
    throw new Error('At least one scenario must be specified.');
  }
  for (const s of scenarios) {
    if (!VALID_SCENARIOS.includes(s)) {
      throw new Error(`Unknown scenario "${s}". Valid: ${VALID_SCENARIOS.join(', ')}`);
    }
  }

  const dateStart  = config.dateRange.start;
  const dateEnd    = config.dateRange.end;
  const amtMin     = config.amountRange.min;
  const amtMax     = config.amountRange.max;
  const currencies = config.currencies || [config.currency || 'USD'];
  const accounts   = config.accounts;

  const groups     = [];
  let ledgerSeq    = 1;
  let stmtSeq      = 1;

  function nextLedgerIds(n) {
    const ids = [];
    for (let i = 0; i < n; i++) ids.push(ledgerSeq++);
    return ids;
  }
  function nextStmtIds(n) {
    const ids = [];
    for (let i = 0; i < n; i++) ids.push(stmtSeq++);
    return ids;
  }
  function baseGroup(type) {
    const txnDate   = randomDate(dateStart, dateEnd);
    const postDate  = addBusinessDays(txnDate, randInt(0, 2));
    const valueDate = addBusinessDays(txnDate, randInt(0, 3));
    return {
      type,
      txnDate:   formatDate(txnDate),
      postDate:  formatDate(postDate),
      valueDate: formatDate(valueDate),
      currency:  randFrom(currencies),
      amount:    randomAmount(amtMin, amtMax),
      ledgerAcc: randFrom(accounts.ledger),
      bankAcc:   randFrom(accounts.bank),
      ref:       randomRef('REF'),
      bankRef:   randomBankRef(),
      indicator: Math.random() > 0.5 ? 'C' : 'D'
    };
  }

  // Distribute records evenly across requested scenarios (round-robin per group)
  const perScenario = Math.floor(totalRecords / scenarios.length);
  const remainder   = totalRecords - perScenario * scenarios.length;

  scenarios.forEach((scenario, idx) => {
    const count = perScenario + (idx < remainder ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const g = baseGroup(scenario);
      _buildGroupForScenario(g, scenario, opts, nextLedgerIds, nextStmtIds);
      groups.push(g);
    }
  });

  return groups;
}

/**
 * Populates ledgerIds / stmtIds / amounts onto an already-created base group
 * for the given scenario.  Extracted so both builders can share the logic.
 */
function _buildGroupForScenario(g, scenario, opts, nextLedgerIds, nextStmtIds) {
  switch (scenario) {
    case 'perfect': {
      g.ledgerIds    = nextLedgerIds(1);
      g.stmtIds      = nextStmtIds(1);
      g.stmtAmounts  = [g.amount];
      g.stmtRefs     = [g.ref];
      g.stmtBankRefs = [g.bankRef];
      break;
    }
    case 'oneToMany': {
      const splitCount = opts.split ? parseInt(opts.split, 10) : randInt(2, 3);
      g.ledgerIds    = nextLedgerIds(1);
      g.stmtIds      = nextStmtIds(splitCount);
      g.stmtAmounts  = splitAmount(g.amount, splitCount);
      g.stmtRefs     = g.stmtIds.map(() => g.ref);
      g.stmtBankRefs = g.stmtIds.map(() => randomBankRef());
      g.splitCount   = splitCount;          // metadata
      break;
    }
    case 'manyToOne': {
      const consolidateCount = opts.consolidate ? parseInt(opts.consolidate, 10) : randInt(2, 3);
      g.ledgerIds     = nextLedgerIds(consolidateCount);
      g.stmtIds       = nextStmtIds(1);
      g.ledgerAmounts = splitAmount(g.amount, consolidateCount);
      g.stmtAmounts   = [g.amount];
      g.stmtRefs      = [g.ref];
      g.stmtBankRefs  = [g.bankRef];
      g.consolidateCount = consolidateCount; // metadata
      break;
    }
    case 'unmatchedLedger': {
      g.ledgerIds   = nextLedgerIds(1);
      g.stmtIds     = [];
      g.stmtAmounts = [];
      break;
    }
    case 'unmatchedStatement': {
      g.ledgerIds    = [];
      g.stmtIds      = nextStmtIds(1);
      g.stmtAmounts  = [g.amount];
      g.stmtRefs     = [randomRef('STREF')];
      g.stmtBankRefs = [randomBankRef()];
      break;
    }
    case 'amountDiff': {
      g.ledgerIds    = nextLedgerIds(1);
      g.stmtIds      = nextStmtIds(1);
      g.stmtAmounts  = [slightAmountDiff(g.amount)];
      g.stmtRefs     = [g.ref];
      g.stmtBankRefs = [g.bankRef];
      break;
    }
    case 'dateDiff': {
      g.ledgerIds    = nextLedgerIds(1);
      g.stmtIds      = nextStmtIds(1);
      g.stmtAmounts  = [g.amount];
      g.stmtRefs     = [g.ref];
      g.stmtBankRefs = [g.bankRef];
      const baseDateObj = new Date(g.txnDate);
      const shiftDays   = randInt(1, 5) * (Math.random() > 0.5 ? 1 : -1);
      baseDateObj.setDate(baseDateObj.getDate() + shiftDays);
      const dateStart = g.txnDate; // guard lower bound
      g.stmtValueDate = formatDate(new Date(Math.max(baseDateObj.getTime(), new Date(dateStart).getTime())));
      break;
    }
  }
}

/**
 * Builds match groups using percentage-based distribution from config.
 * This is the original mixed-scenario generator used when no --scenario flag is given.
 *
 * @param {number} totalLedgerRecords
 * @param {object} config
 * @returns {object[]} matchGroups
 */
function buildMatchGroups(totalLedgerRecords, config) {
  const pct        = config.matchingPercentages;
  const dateStart  = config.dateRange.start;
  const dateEnd    = config.dateRange.end;
  const amtMin     = config.amountRange.min;
  const amtMax     = config.amountRange.max;
  const currencies = config.currencies || [config.currency || 'USD'];
  const accounts   = config.accounts;

  const counts = {
    perfect:         Math.round(totalLedgerRecords * pct.perfectMatch     / 100),
    oneToMany:       Math.round(totalLedgerRecords * pct.oneToMany        / 100),
    manyToOne:       Math.round(totalLedgerRecords * pct.manyToOne        / 100),
    unmatchedLedger: Math.round(totalLedgerRecords * pct.unmatched        / 100 / 2),
    amountDiff:      Math.round(totalLedgerRecords * pct.amountDifference / 100),
    dateDiff:        Math.round(totalLedgerRecords * pct.dateDifference   / 100)
  };
  const allocated = Object.values(counts).reduce((a, b) => a + b, 0);
  counts.perfect += totalLedgerRecords - allocated;
  counts.unmatchedStatement = counts.unmatchedLedger;

  const groups    = [];
  let ledgerSeq   = 1;
  let stmtSeq     = 1;

  function nextLedgerIds(n) { const ids = []; for (let i = 0; i < n; i++) ids.push(ledgerSeq++); return ids; }
  function nextStmtIds(n)   { const ids = []; for (let i = 0; i < n; i++) ids.push(stmtSeq++);   return ids; }
  function baseGroup(type) {
    const txnDate = randomDate(dateStart, dateEnd);
    return {
      type,
      txnDate:   formatDate(txnDate),
      postDate:  formatDate(addBusinessDays(txnDate, randInt(0, 2))),
      valueDate: formatDate(addBusinessDays(txnDate, randInt(0, 3))),
      currency:  randFrom(currencies),
      amount:    randomAmount(amtMin, amtMax),
      ledgerAcc: randFrom(accounts.ledger),
      bankAcc:   randFrom(accounts.bank),
      ref:       randomRef('REF'),
      bankRef:   randomBankRef(),
      indicator: Math.random() > 0.5 ? 'C' : 'D'
    };
  }

  for (const [scenario, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      const g = baseGroup(scenario);
      _buildGroupForScenario(g, scenario, {}, nextLedgerIds, nextStmtIds);
      groups.push(g);
    }
  }

  return groups;
}

/**
 * Splits an amount into n roughly equal parts that sum to total.
 */
function splitAmount(total, n) {
  const parts = [];
  let remaining = total;
  for (let i = 0; i < n - 1; i++) {
    const part = Math.round((remaining / (n - i)) * 100 * (0.8 + Math.random() * 0.4)) / 100;
    parts.push(part);
    remaining = Math.round((remaining - part) * 100) / 100;
  }
  parts.push(Math.round(remaining * 100) / 100);
  return parts;
}

module.exports = { buildMatchGroups, buildScenarioGroups, VALID_SCENARIOS };

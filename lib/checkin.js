'use strict';
const { cellToDateStr } = require('./utils');

/**
 * Pure function: check if a check-in already exists in rows
 * @param {Array[]} rows  - sheet rows [timestamp, jobId, jobName, lineUserId, ...]
 * @param {string} lineUserId
 * @param {string} jobId
 * @param {string} todayISO - "yyyy-MM-dd" Bangkok date
 * @returns {boolean}
 */
function checkDuplicate(rows, lineUserId, jobId, todayISO) {
  for (const r of rows) {
    if (!r[0]) continue;
    const rDate = cellToDateStr(r[0]);
    if (rDate === todayISO &&
        String(r[1]) === String(jobId) &&
        r[3] === lineUserId) {
      return true;
    }
  }
  return false;
}

module.exports = { checkDuplicate };

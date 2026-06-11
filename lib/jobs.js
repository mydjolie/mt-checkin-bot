'use strict';
const { cellToDateStr, serialToDisplayDate } = require('./utils');

/**
 * Pure function: filter active jobs by status and date range
 * @param {Array[]} rows   - sheet rows [jobId, name, lat, lng, radius, startDate, endDate, location, status]
 * @param {string} todayISO - "yyyy-MM-dd" Bangkok date (today)
 * @returns {Object[]} active jobs within date range
 */
function filterActiveJobs(rows, todayISO) {
  const jobs = [];
  for (const row of rows) {
    if (row[8] !== 'Active') continue;

    const startISO = row[5] ? cellToDateStr(row[5]) : null;
    const endISO   = row[6] ? cellToDateStr(row[6])   : null;

    if (startISO && todayISO < startISO) continue;
    if (endISO   && todayISO > endISO)   continue;

    jobs.push({
      jobId:     String(row[0]),
      name:      row[1],
      lat:       parseFloat(row[2]),
      lng:       parseFloat(row[3]),
      radius:    parseFloat(row[4]),
      startDate: row[5] ? (typeof row[5] === 'number' ? serialToDisplayDate(row[5]) : String(row[5])) : '',
      endDate:   row[6] ? (typeof row[6] === 'number' ? serialToDisplayDate(row[6]) : String(row[6])) : '',
      location:  row[7] || '',
    });
  }
  return jobs;
}

module.exports = { filterActiveJobs };

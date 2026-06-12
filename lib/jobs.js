'use strict';
const { cellToDateStr, serialToDisplayDate } = require('./utils');

function parseNum(val) {
  return parseFloat(String(val).replace(/,/g, ''));
}

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
      lat:       parseNum(row[2]),
      lng:       parseNum(row[3]),
      radius:    parseNum(row[4]),
      startDate: row[5] ? (typeof row[5] === 'number' ? serialToDisplayDate(row[5]) : String(row[5])) : '',
      endDate:   row[6] ? (typeof row[6] === 'number' ? serialToDisplayDate(row[6]) : String(row[6])) : '',
      location:  row[7] || '',
    });
  }
  return jobs;
}

module.exports = { filterActiveJobs };

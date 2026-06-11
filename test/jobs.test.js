'use strict';
const { filterActiveJobs } = require('../lib/jobs');

const TODAY    = '2026-06-12';
const PAST_SER = 46179;  // Jun 06 2026
const TODAY_SER= 46185;  // Jun 12 2026
const FUT_SER  = 46199;  // Jun 26 2026

function makeRow(overrides = {}) {
  return [
    overrides.jobId    ?? 'JOB001',
    overrides.name     ?? 'งานทดสอบ',
    overrides.lat      ?? 13.82,
    overrides.lng      ?? 100.41,
    overrides.radius   ?? 500,
    overrides.start    ?? PAST_SER,
    overrides.end      ?? FUT_SER,
    overrides.location ?? 'สยาม',
    overrides.status   ?? 'Active',
  ];
}

describe('filterActiveJobs', () => {
  test('includes job when today is within date range', () => {
    const jobs = filterActiveJobs([makeRow()], TODAY);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].jobId).toBe('JOB001');
  });

  test('excludes job when today is before startDate', () => {
    const jobs = filterActiveJobs([makeRow({ start: FUT_SER, end: FUT_SER + 10 })], TODAY);
    expect(jobs).toHaveLength(0);
  });

  test('excludes job when today is after endDate', () => {
    const jobs = filterActiveJobs([makeRow({ start: PAST_SER, end: PAST_SER + 2 })], TODAY);
    expect(jobs).toHaveLength(0);
  });

  test('includes job that starts today', () => {
    const jobs = filterActiveJobs([makeRow({ start: TODAY_SER, end: FUT_SER })], TODAY);
    expect(jobs).toHaveLength(1);
  });

  test('includes job that ends today', () => {
    const jobs = filterActiveJobs([makeRow({ start: PAST_SER, end: TODAY_SER })], TODAY);
    expect(jobs).toHaveLength(1);
  });

  test('excludes archived jobs', () => {
    const jobs = filterActiveJobs([makeRow({ status: 'Archive' })], TODAY);
    expect(jobs).toHaveLength(0);
  });

  test('includes job with no start date', () => {
    const jobs = filterActiveJobs([makeRow({ start: '' })], TODAY);
    expect(jobs).toHaveLength(1);
  });

  test('includes job with no end date', () => {
    const jobs = filterActiveJobs([makeRow({ end: '' })], TODAY);
    expect(jobs).toHaveLength(1);
  });

  test('handles Buddhist Era string dates in Jobs sheet', () => {
    const jobs = filterActiveJobs([makeRow({ start: '10/06/2569', end: '17/06/2569' })], TODAY);
    expect(jobs).toHaveLength(1);
  });

  test('excludes BE date string job where today is after endDate', () => {
    const jobs = filterActiveJobs([makeRow({ start: '10/06/2569', end: '11/06/2569' })], TODAY);
    expect(jobs).toHaveLength(0);
  });

  test('returns correct job fields', () => {
    const jobs = filterActiveJobs([makeRow()], TODAY);
    expect(jobs[0]).toMatchObject({
      jobId: 'JOB001',
      name: 'งานทดสอบ',
      lat: 13.82,
      lng: 100.41,
      radius: 500,
      location: 'สยาม',
    });
    expect(jobs[0].startDate).toBeTruthy();
    expect(jobs[0].endDate).toBeTruthy();
  });

  test('filters multiple jobs correctly', () => {
    const rows = [
      makeRow({ jobId: 'JOB001', start: PAST_SER, end: FUT_SER }),           // ✅ active
      makeRow({ jobId: 'JOB002', start: FUT_SER, end: FUT_SER + 10 }),        // ❌ not started
      makeRow({ jobId: 'JOB003', start: PAST_SER, end: PAST_SER + 1 }),       // ❌ ended
      makeRow({ jobId: 'JOB004', status: 'Archive', start: PAST_SER, end: FUT_SER }), // ❌ archived
      makeRow({ jobId: 'JOB005', start: TODAY_SER, end: TODAY_SER }),          // ✅ starts & ends today
    ];
    const jobs = filterActiveJobs(rows, TODAY);
    expect(jobs).toHaveLength(2);
    expect(jobs.map(j => j.jobId)).toEqual(['JOB001', 'JOB005']);
  });

  test('returns empty array when no rows', () => {
    expect(filterActiveJobs([], TODAY)).toEqual([]);
  });
});

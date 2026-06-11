'use strict';
const { checkDuplicate } = require('../lib/checkin');

const TODAY      = '2026-06-12';
const YESTERDAY  = '2026-06-11';
const JUN12_SER  = 46185; // serial for June 12, 2026
const JUN11_SER  = 46184; // serial for June 11, 2026

describe('checkDuplicate', () => {
  test('detects duplicate: same user + same job + same day (serial timestamp)', () => {
    const rows = [[JUN12_SER, 'JOB001', 'งานA', 'Uabc123']];
    expect(checkDuplicate(rows, 'Uabc123', 'JOB001', TODAY)).toBe(true);
  });

  test('detects duplicate: same user + same job + same day (string timestamp)', () => {
    const rows = [['12/06/2026 01:09:30', 'JOB001', 'งานA', 'Uabc123']];
    expect(checkDuplicate(rows, 'Uabc123', 'JOB001', TODAY)).toBe(true);
  });

  test('detects duplicate: Buddhist Era string timestamp', () => {
    const rows = [['12/06/2569 08:30:00', 'JOB001', 'งานA', 'Uabc123']];
    expect(checkDuplicate(rows, 'Uabc123', 'JOB001', TODAY)).toBe(true);
  });

  test('no duplicate: different user', () => {
    const rows = [[JUN12_SER, 'JOB001', 'งานA', 'Uabc123']];
    expect(checkDuplicate(rows, 'Udifferent', 'JOB001', TODAY)).toBe(false);
  });

  test('no duplicate: different job', () => {
    const rows = [[JUN12_SER, 'JOB001', 'งานA', 'Uabc123']];
    expect(checkDuplicate(rows, 'Uabc123', 'JOB002', TODAY)).toBe(false);
  });

  test('no duplicate: yesterday', () => {
    const rows = [[JUN11_SER, 'JOB001', 'งานA', 'Uabc123']];
    expect(checkDuplicate(rows, 'Uabc123', 'JOB001', TODAY)).toBe(false);
  });

  test('no duplicate: yesterday string timestamp', () => {
    const rows = [['11/06/2026 23:59:59', 'JOB001', 'งานA', 'Uabc123']];
    expect(checkDuplicate(rows, 'Uabc123', 'JOB001', TODAY)).toBe(false);
  });

  test('handles empty rows', () => {
    expect(checkDuplicate([], 'Uabc123', 'JOB001', TODAY)).toBe(false);
  });

  test('skips rows with empty timestamp', () => {
    const rows = [['', 'JOB001', 'งานA', 'Uabc123'], [JUN12_SER, 'JOB001', 'งานA', 'Uabc123']];
    expect(checkDuplicate(rows, 'Uabc123', 'JOB001', TODAY)).toBe(true);
  });

  test('jobId type coercion: string vs string', () => {
    const rows = [[JUN12_SER, 'JOB001', 'งานA', 'Uabc123']];
    expect(checkDuplicate(rows, 'Uabc123', 'JOB001', TODAY)).toBe(true);
  });

  test('user can check in same job on different days', () => {
    const rows = [[JUN11_SER, 'JOB001', 'งานA', 'Uabc123']];
    expect(checkDuplicate(rows, 'Uabc123', 'JOB001', TODAY)).toBe(false);
  });

  test('user can check in different jobs on same day', () => {
    const rows = [[JUN12_SER, 'JOB001', 'งานA', 'Uabc123']];
    expect(checkDuplicate(rows, 'Uabc123', 'JOB002', TODAY)).toBe(false);
  });

  test('multiple rows: only one matches', () => {
    const rows = [
      [JUN11_SER, 'JOB001', 'งานA', 'Uabc123'],
      [JUN12_SER, 'JOB002', 'งานB', 'Uabc123'],
      [JUN12_SER, 'JOB001', 'งานA', 'Uother'],
    ];
    expect(checkDuplicate(rows, 'Uabc123', 'JOB001', TODAY)).toBe(false);
    expect(checkDuplicate(rows, 'Uabc123', 'JOB002', TODAY)).toBe(true);
  });
});

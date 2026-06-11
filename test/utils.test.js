'use strict';
const { cellToDateStr, serialToDate, serialToDisplayDate, toBangkokDateStr, formatBangkok, parseDate } = require('../lib/utils');

// June 12, 2026 = serial 46185
// Verify: (46185 - 25569) * 86400 = 20616 * 86400 = 1781222400 sec since epoch
// + 7h Bangkok = Jun 12 07:00 UTC → "2026-06-12"
const JUN12_SERIAL = 46185;
const JUN11_SERIAL = 46184;
const JUN17_SERIAL = 46190;

describe('cellToDateStr', () => {
  test('returns null for empty/null/undefined', () => {
    expect(cellToDateStr(null)).toBeNull();
    expect(cellToDateStr('')).toBeNull();
    expect(cellToDateStr(undefined)).toBeNull();
  });

  test('converts serial number (Google Sheets date) → yyyy-MM-dd', () => {
    expect(cellToDateStr(JUN12_SERIAL)).toBe('2026-06-12');
    expect(cellToDateStr(JUN11_SERIAL)).toBe('2026-06-11');
  });

  test('converts string "dd/MM/yyyy HH:mm:ss" → yyyy-MM-dd', () => {
    expect(cellToDateStr('12/06/2026 01:09:30')).toBe('2026-06-12');
    expect(cellToDateStr('01/01/2026')).toBe('2026-01-01');
  });

  test('converts Buddhist Era string (พ.ศ.) → yyyy-MM-dd (CE)', () => {
    expect(cellToDateStr('12/06/2569 01:09:30')).toBe('2026-06-12');
    expect(cellToDateStr('10/06/2569')).toBe('2026-06-10');
    expect(cellToDateStr('17/06/2569')).toBe('2026-06-17');
  });

  test('returns null for unrecognised string', () => {
    expect(cellToDateStr('not-a-date')).toBeNull();
    expect(cellToDateStr('2026-06-12')).toBeNull(); // ISO format not supported
  });
});

describe('serialToDisplayDate', () => {
  test('converts serial → dd/MM/yyyy', () => {
    expect(serialToDisplayDate(JUN12_SERIAL)).toBe('12/06/2026');
    expect(serialToDisplayDate(JUN11_SERIAL)).toBe('11/06/2026');
    expect(serialToDisplayDate(JUN17_SERIAL)).toBe('17/06/2026');
  });
});

describe('toBangkokDateStr', () => {
  test('returns Bangkok date even when UTC is previous day', () => {
    // UTC 17:00 Jun 11 = Bangkok 00:00 Jun 12
    const utc = new Date('2026-06-11T17:00:00Z');
    expect(toBangkokDateStr(utc)).toBe('2026-06-12');
  });

  test('returns same day when UTC midnight', () => {
    const utc = new Date('2026-06-12T00:00:00Z');
    expect(toBangkokDateStr(utc)).toBe('2026-06-12');
  });

  test('midnight UTC+7 = UTC 17:00 previous day', () => {
    const bangkokMidnight = new Date('2026-06-11T17:00:00Z');
    expect(toBangkokDateStr(bangkokMidnight)).toBe('2026-06-12');
  });
});

describe('formatBangkok', () => {
  test('formats timestamp in Bangkok timezone', () => {
    // UTC midnight = Bangkok 07:00
    const utcMidnight = new Date('2026-06-12T00:00:00Z');
    expect(formatBangkok(utcMidnight, 'dd/MM/yyyy HH:mm:ss')).toBe('12/06/2026 07:00:00');
  });

  test('handles date near midnight', () => {
    // Bangkok 01:09 = UTC 18:09 previous day
    const utc = new Date('2026-06-11T18:09:30Z');
    expect(formatBangkok(utc, 'dd/MM/yyyy HH:mm:ss')).toBe('12/06/2026 01:09:30');
  });
});

describe('parseDate', () => {
  test('accepts valid dd/MM/yyyy', () => {
    expect(parseDate('11/06/2026')).toBeTruthy();
    expect(parseDate('01/01/2026')).toBeTruthy();
    expect(parseDate('30/06/2026')).toBeTruthy();
  });

  test('rejects invalid formats', () => {
    expect(parseDate('2026-06-11')).toBeNull();
    expect(parseDate('not a date')).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate(null)).toBeNull();
  });

  test('rejects impossible month/day', () => {
    expect(parseDate('99/13/2026')).toBeNull();
    expect(parseDate('01/00/2026')).toBeNull();
  });
});

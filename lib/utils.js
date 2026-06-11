'use strict';

// Google Sheets serial number → JS Date adjusted to Bangkok (UTC+7)
function serialToDate(serial) {
  const ms = (serial - 25569) * 86400000 + 7 * 3600000;
  return new Date(ms);
}

// Google Sheets serial → "dd/MM/yyyy" display string
function serialToDisplayDate(serial) {
  const d = serialToDate(serial);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

// Any cell value (number serial OR string) → "yyyy-MM-dd" (Bangkok date)
function cellToDateStr(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') {
    return serialToDate(val).toISOString().slice(0, 10);
  }
  // String: "dd/MM/yyyy ..." or "dd/MM/พ.ศ. ..."
  const m = String(val).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    let y = parseInt(m[3]);
    if (y > 2400) y -= 543; // พ.ศ. → ค.ศ.
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

// JS Date → "yyyy-MM-dd" in Bangkok timezone
function toBangkokDateStr(date) {
  return new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);
}

// JS Date → formatted string using Bangkok timezone
// Supported tokens: dd, MM, yyyy, HH, mm, ss
function formatBangkok(date, fmt) {
  const d = new Date(date.getTime() + 7 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  return fmt
    .replace('dd', pad(d.getUTCDate()))
    .replace('MM', pad(d.getUTCMonth() + 1))
    .replace('yyyy', d.getUTCFullYear())
    .replace('HH', pad(d.getUTCHours()))
    .replace('mm', pad(d.getUTCMinutes()))
    .replace('ss', pad(d.getUTCSeconds()));
}

// Validate "dd/MM/yyyy" format, returns true or null
function parseDate(str) {
  if (typeof str !== 'string') return null;
  const m = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = parseInt(m[1]), mo = parseInt(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return true;
}

module.exports = { serialToDate, serialToDisplayDate, cellToDateStr, toBangkokDateStr, formatBangkok, parseDate };

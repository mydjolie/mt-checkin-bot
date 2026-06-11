// =============================================
// Apps Script — ทำหน้าที่แค่ 2 อย่าง:
// 1. doGet  → ส่งรายการ jobs กลับให้ LIFF
// 2. doPost → รับ check-in จาก LIFF บันทึกลง sheet
// =============================================
const SHEET_ID = '1EuaUVdmlwcjYXuhWvmDAMg1hM0fuAi-bNYOv910mi-Y';

function doGet(e) {
  try {
    return jsonResponse({ status: 'success', jobs: getActiveJobs() });
  } catch(err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.type === 'checkin') return handleCheckIn(data);
    return jsonResponse({ status: 'error', message: 'Unknown type' });
  } catch(err) {
    Logger.log('doPost error: ' + err);
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

// =============================================
// Check-in
// =============================================
function handleCheckIn(data) {
  if (!String(data.team || '').trim()) {
    return jsonResponse({ status: 'error', message: 'กรุณาระบุทีม/ฝ่ายค่ะ' });
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('CheckIn');
    const now = new Date();
    const todayISO = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');

    // ตรวจ duplicate — อ่านเฉพาะ 4 คอลัมน์แรก
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!r[0]) continue;
        var rISO = r[0] instanceof Date
          ? Utilities.formatDate(r[0], 'Asia/Bangkok', 'yyyy-MM-dd')
          : r[0].toString().replace(/^(\d{2})\/(\d{2})\/(\d{4}).*/, '$3-$2-$1');
        if (String(r[1]) === String(data.jobId) && r[3] === data.lineUserId && rISO === todayISO) {
          return jsonResponse({ status: 'duplicate', message: 'ลงเวลางานนี้ไปแล้ววันนี้ค่ะ' });
        }
      }
    }

    // บันทึก timestamp เป็น string เพื่อควบคุม format
    const timestamp = Utilities.formatDate(now, 'Asia/Bangkok', 'dd/MM/yyyy HH:mm:ss');
    sheet.appendRow([timestamp, data.jobId, data.jobName, data.lineUserId,
      data.lineDisplayName, data.nickname, data.team,
      data.latitude, data.longitude, data.distance]);

    // แจ้ง Admin (error ไม่กระทบการบันทึก)
    try {
      const config = getConfig();
      const adminIds = parseAdminIds(config);
      if (adminIds.length > 0) {
        const msg = '🟢 Check-in!\n\n' +
          '👤 ' + data.lineDisplayName + ' (' + data.nickname + ')\n' +
          '🏷 ทีม: ' + data.team + '\n' +
          '📋 งาน: ' + data.jobName + '\n' +
          '🕐 ' + Utilities.formatDate(now, 'Asia/Bangkok', 'HH:mm') + '\n' +
          '📍 ' + data.distance + ' เมตร';
        adminIds.forEach(function(id) { pushMessage(id, msg); });
      }
    } catch(e) { Logger.log('notify error: ' + e); }

    return jsonResponse({ status: 'success' });
  } catch(err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

// =============================================
// Jobs
// =============================================
function getActiveJobs() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Jobs');
  const data = sheet.getDataRange().getValues();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const jobs = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[8] !== 'Active') continue;
    var start = toDate(row[5]);
    var end = toDate(row[6]);
    if (start) { start.setHours(0,0,0,0); if (today < start) continue; }
    if (end)   { end.setHours(23,59,59,999); if (today > end) continue; }
    jobs.push({
      jobId: String(row[0]), name: row[1],
      lat: parseFloat(row[2]), lng: parseFloat(row[3]),
      radius: parseFloat(row[4]),
      startDate: fmtDate(row[5]), endDate: fmtDate(row[6]),
      location: row[7]
    });
  }
  return jobs;
}

function toDate(val) {
  if (!val) return null;
  if (val instanceof Date) return new Date(val);
  var m = val.toString().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    var y = parseInt(m[3]);
    if (y > 2400) y -= 543; // แปลง พ.ศ. → ค.ศ.
    return new Date(y, parseInt(m[2]) - 1, parseInt(m[1]));
  }
  return null;
}

function fmtDate(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Bangkok', 'dd/MM/yyyy');
  return val.toString();
}

// =============================================
// Config & LINE helpers
// =============================================
function getConfig() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Config');
  const data = sheet.getDataRange().getValues();
  const cfg = {};
  for (var i = 1; i < data.length; i++) cfg[data[i][0]] = data[i][1];
  return cfg;
}

function parseAdminIds(config) {
  var ids = (config.admin_line_ids || config.admin_line_id || '').toString();
  return ids.split(',').map(function(s){ return s.trim(); })
    .filter(function(s){ return /^U[0-9a-f]{32}$/i.test(s); });
}

function pushMessage(to, text) {
  var token = PropertiesService.getScriptProperties().getProperty('LINE_TOKEN') || '';
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: text }] })
  });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

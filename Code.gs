// =============================================
// CONFIG
// =============================================
const SHEET_ID = '1EuaUVdmlwcjYXuhWvmDAMg1hM0fuAi-bNYOv910mi-Y';

// =============================================
// HTTP Handlers
// =============================================
function doGet(e) {
  try {
    const jobs = getActiveJobs();
    const config = getConfig();
    return jsonResponse({ status: 'success', jobs, config });
  } catch(err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.events) {
      for (const event of data.events) {
        handleBotEvent(event);
      }
      return jsonResponse({ status: 'ok' });
    }

    if (data.type === 'checkin') {
      return handleCheckIn(data);
    }

  } catch(err) {
    Logger.log('doPost error: ' + err);
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

// =============================================
// LIFF Check-in
// =============================================
function handleCheckIn(data) {
  // บังคับ team
  if (!data.team || data.team.trim() === '') {
    return jsonResponse({ status: 'error', message: 'กรุณาระบุทีม/ฝ่ายค่ะ' });
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('CheckIn');
    const now = new Date();
    const todayStr = Utilities.formatDate(now, 'Asia/Bangkok', 'dd/MM/yyyy');

    // ตรวจ duplicate — lineUserId + jobId + วันเดียวกัน
    const existing = sheet.getDataRange().getValues();
    for (let i = 1; i < existing.length; i++) {
      const row = existing[i];
      if (!row[0]) continue;
      const rowDate = row[0].toString().slice(0, 10); // dd/MM/yyyy
      if (row[3] === data.lineUserId && row[1] === data.jobId && rowDate === todayStr) {
        return jsonResponse({ status: 'duplicate', message: 'ลงเวลางานนี้ไปแล้ววันนี้ค่ะ' });
      }
    }

    const timestamp = Utilities.formatDate(now, 'Asia/Bangkok', 'dd/MM/yyyy HH:mm:ss');
    sheet.appendRow([
      timestamp,
      data.jobId,
      data.jobName,
      data.lineUserId,
      data.lineDisplayName,
      data.nickname,
      data.team,
      data.latitude,
      data.longitude,
      data.distance
    ]);

    // แจ้ง Admin ทุกคน (ถ้า push fail ไม่กระทบการบันทึก)
    try {
      const config = getConfig();
      const adminIds = getAdminIds(config);
      if (adminIds.length > 0) {
        const msg = `🟢 Check-in แจ้งเตือน!\n\n` +
          `👤 ${data.lineDisplayName} (${data.nickname})\n` +
          `🏷 ทีม: ${data.team}\n` +
          `📋 งาน: ${data.jobName}\n` +
          `🕐 เวลา: ${Utilities.formatDate(now, 'Asia/Bangkok', 'HH:mm')}\n` +
          `📍 ระยะห่าง: ${data.distance} เมตร`;
        adminIds.forEach(id => pushMessage(id, msg));
      }
    } catch(notifyErr) {
      Logger.log('push notify error: ' + notifyErr);
    }

    return jsonResponse({ status: 'success' });
  } catch(err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function getAdminIds(config) {
  const ids = config.admin_line_ids || config.admin_line_id || '';
  return ids.split(',').map(s => s.trim()).filter(s => s && s !== 'Uxxxxxxxxxxxxxxxxx');
}

// =============================================
// LINE Bot Event Handler
// =============================================
function handleBotEvent(event) {
  const userId = event.source?.userId;
  const replyToken = event.replyToken;
  const config = getConfig();
  const isAdmin = getAdminIds(config).includes(userId);

  if (event.type === 'follow') {
    replyMessage(replyToken, '👋 ยินดีต้อนรับสู่ระบบตอกบัตร MT!\n\nพิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งทั้งหมดค่ะ');
    return;
  }

  if (event.type !== 'message') return;

  const msgType = event.message.type;

  // รับ location message สำหรับ Admin กำลังสร้างงาน
  if (msgType === 'location' && isAdmin) {
    const state = getUserState(userId);
    if (state === 'CREATE_JOB_PIN') {
      const lat = event.message.latitude;
      const lng = event.message.longitude;
      const temp = getTempData(userId);
      setTempData(userId, { ...temp, lat: lat.toString(), lng: lng.toString() });
      setUserState(userId, 'CREATE_JOB_RADIUS');
      replyMessage(replyToken,
        `✅ พิกัด: ${lat.toFixed(6)}, ${lng.toFixed(6)}\n\n` +
        `กรุณาพิมพ์ รัศมีที่อนุญาต (เมตร)\nเช่น 200, 500, 1000 ค่ะ`
      );
    }
    return;
  }

  if (msgType !== 'text') return;

  const text = event.message.text.trim();

  // Admin commands
  if (isAdmin) {
    if (text === 'สร้างงาน') {
      setUserState(userId, 'CREATE_JOB_NAME');
      replyMessage(replyToken, '📋 สร้างงานใหม่\n\nกรุณาพิมพ์ ชื่องาน ค่ะ');
      return;
    }
    if (text === 'รายการงาน') {
      replyMessage(replyToken, getJobsList());
      return;
    }
    if (text === 'สรุปวันนี้') {
      replyMessage(replyToken, getDailySummary());
      return;
    }
    if (text === 'สรุปเดือนนี้') {
      replyMessage(replyToken, getMonthlySummary());
      return;
    }
    if (text.startsWith('archive ')) {
      const jobId = text.replace('archive ', '').trim().toUpperCase();
      replyMessage(replyToken, archiveJob(jobId));
      return;
    }
    if (text.startsWith('export ')) {
      const jobId = text.replace('export ', '').trim().toUpperCase();
      replyMessage(replyToken, exportJobSummary(jobId));
      return;
    }
  }

  const state = getUserState(userId);

  if (isAdmin && state.startsWith('CREATE_JOB_')) {
    handleCreateJobFlow(userId, replyToken, text, state);
    return;
  }

  if (text === 'ช่วยเหลือ' || text === 'help') {
    replyMessage(replyToken, getHelpMessage(isAdmin));
    return;
  }

  replyMessage(replyToken, '💬 พิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งทั้งหมดค่ะ');
}

// =============================================
// สร้างงานใหม่ — State Machine
// =============================================
function handleCreateJobFlow(userId, replyToken, text, state) {
  const temp = getTempData(userId);

  if (state === 'CREATE_JOB_NAME') {
    setTempData(userId, { ...temp, name: text });
    setUserState(userId, 'CREATE_JOB_LOCATION');
    replyMessage(replyToken, `✅ ชื่องาน: ${text}\n\nกรุณาพิมพ์ สถานที่จัดงาน ค่ะ`);
    return;
  }

  if (state === 'CREATE_JOB_LOCATION') {
    setTempData(userId, { ...temp, location: text });
    setUserState(userId, 'CREATE_JOB_PIN');
    replyMessage(replyToken,
      `✅ สถานที่: ${text}\n\n` +
      `📍 กรุณา แชร์ตำแหน่ง (Location) ของจุดที่ให้เช็คอินค่ะ\n\n` +
      `วิธี: กดไอคอน + ในแชท → Location → เลือกพิกัดที่ต้องการ`
    );
    return;
  }

  // state CREATE_JOB_PIN รอรับ location message (จัดการใน handleBotEvent แล้ว)
  if (state === 'CREATE_JOB_PIN') {
    replyMessage(replyToken, '📍 กรุณาส่ง Location ค่ะ (กด + → Location)');
    return;
  }

  if (state === 'CREATE_JOB_RADIUS') {
    if (isNaN(parseInt(text))) {
      replyMessage(replyToken, '❌ กรุณาพิมพ์ตัวเลข เช่น 1000 ค่ะ');
      return;
    }
    setTempData(userId, { ...temp, radius: text });
    setUserState(userId, 'CREATE_JOB_START');
    replyMessage(replyToken, `✅ รัศมี: ${text} เมตร\n\nกรุณาพิมพ์ วันที่เริ่มงาน\nรูปแบบ dd/MM/yyyy เช่น 11/06/2569 ค่ะ`);
    return;
  }

  if (state === 'CREATE_JOB_START') {
    setTempData(userId, { ...temp, startDate: text });
    setUserState(userId, 'CREATE_JOB_END');
    replyMessage(replyToken, `✅ วันเริ่ม: ${text}\n\nกรุณาพิมพ์ วันที่สิ้นสุดงาน\nรูปแบบ dd/MM/yyyy ค่ะ`);
    return;
  }

  if (state === 'CREATE_JOB_END') {
    setTempData(userId, { ...temp, endDate: text });
    setUserState(userId, 'CREATE_JOB_CONFIRM');

    const d = { ...temp, endDate: text };
    replyMessage(replyToken,
      `📋 ยืนยันสร้างงานใหม่\n\n` +
      `📌 ชื่องาน: ${d.name}\n` +
      `🏢 สถานที่: ${d.location}\n` +
      `📍 พิกัด: ${d.lat}, ${d.lng}\n` +
      `🎯 รัศมี: ${d.radius} เมตร\n` +
      `📅 เริ่ม: ${d.startDate}\n` +
      `📅 สิ้นสุด: ${text}\n\n` +
      `พิมพ์ "ยืนยัน" เพื่อสร้าง หรือ "ยกเลิก" ค่ะ`
    );
    return;
  }

  if (state === 'CREATE_JOB_CONFIRM') {
    if (text === 'ยืนยัน') {
      const d = getTempData(userId);
      const jobId = createJob(d);
      clearUserState(userId);
      replyMessage(replyToken, `✅ สร้างงานสำเร็จ!\n\nJobID: ${jobId}\nชื่อ: ${d.name}\n\nพนักงานสามารถ Check-in ได้แล้วค่ะ`);
    } else {
      clearUserState(userId);
      replyMessage(replyToken, '❌ ยกเลิกการสร้างงานแล้วค่ะ');
    }
    return;
  }
}

// =============================================
// Google Sheets Functions
// =============================================
function getActiveJobs() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Jobs');
  const data = sheet.getDataRange().getValues();
  const today = new Date();
  const jobs = [];

  for (let i = 1; i < data.length; i++) {
    const [jobId, name, lat, lng, radius, startDate, endDate, location, status] = data[i];
    if (status === 'Active') {
      jobs.push({ jobId, name, lat: parseFloat(lat), lng: parseFloat(lng), radius: parseFloat(radius), startDate, endDate, location });
    }
  }
  return jobs;
}

function createJob(d) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Jobs');
  const rows = sheet.getLastRow();
  const jobId = 'JOB' + String(rows).padStart(3, '0');
  sheet.appendRow([jobId, d.name, d.lat, d.lng, d.radius, d.startDate, d.endDate, d.location, 'Active']);
  return jobId;
}

function archiveJob(jobId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Jobs');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === jobId) {
      sheet.getRange(i + 1, 9).setValue('Archive');
      return `✅ Archive งาน ${jobId} (${data[i][1]}) เรียบร้อยแล้วค่ะ`;
    }
  }
  return `❌ ไม่พบ JobID: ${jobId} ค่ะ`;
}

function getJobsList() {
  const jobs = getActiveJobs();
  if (jobs.length === 0) return '📋 ไม่มีงาน Active อยู่ขณะนี้ค่ะ\n\nพิมพ์ "สร้างงาน" เพื่อเพิ่มงานใหม่';
  const lines = jobs.map(j =>
    `📌 ${j.jobId}: ${j.name}\n   📅 ${j.startDate} - ${j.endDate}\n   🏢 ${j.location}`
  );
  return `📋 งาน Active ทั้งหมด (${jobs.length} งาน)\n\n${lines.join('\n\n')}`;
}

function getConfig() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Config');
  const data = sheet.getDataRange().getValues();
  const config = {};
  for (let i = 1; i < data.length; i++) {
    config[data[i][0]] = data[i][1];
  }
  return config;
}

function getDailySummary() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('CheckIn');
  const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy');
  const data = sheet.getDataRange().getValues();

  const byJob = {};
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const ts = data[i][0].toString();
    if (!ts.startsWith(today)) continue;
    const jobName = data[i][2];
    const name = `${data[i][4]} (${data[i][5]})`;
    if (!byJob[jobName]) byJob[jobName] = [];
    byJob[jobName].push(name);
  }

  if (Object.keys(byJob).length === 0) return `📋 วันที่ ${today}\n\nยังไม่มีการ Check-in วันนี้ค่ะ`;

  let msg = `📋 สรุปการ Check-in วันที่ ${today}\n\n`;
  for (const [job, people] of Object.entries(byJob)) {
    msg += `📌 ${job} (${people.length} คน)\n`;
    msg += people.map(p => `   • ${p}`).join('\n') + '\n\n';
  }
  return msg.trim();
}

function getMonthlySummary() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('CheckIn');
  const thisMonth = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'MM/yyyy');
  const data = sheet.getDataRange().getValues();

  const byJob = {};
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const ts = data[i][0].toString();
    const monthYear = ts.slice(3, 10);
    if (monthYear !== thisMonth) continue;
    const jobName = data[i][2];
    const key = `${data[i][3]}_${data[i][0].toString().slice(0, 10)}`;
    if (!byJob[jobName]) byJob[jobName] = new Set();
    byJob[jobName].add(key);
  }

  if (Object.keys(byJob).length === 0) return `📊 เดือน ${thisMonth}\n\nยังไม่มีข้อมูลค่ะ`;

  let msg = `📊 สรุปเดือน ${thisMonth}\n\n`;
  for (const [job, days] of Object.entries(byJob)) {
    msg += `📌 ${job}: ${days.size} วัน-คน\n`;
  }
  return msg.trim();
}

function exportJobSummary(jobId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('CheckIn');
  const data = sheet.getDataRange().getValues();

  const rows = data.filter((r, i) => i > 0 && r[1] === jobId);
  if (rows.length === 0) return `❌ ไม่พบข้อมูล Check-in สำหรับ ${jobId} ค่ะ`;

  const byPerson = {};
  for (const row of rows) {
    const key = row[3];
    if (!byPerson[key]) {
      byPerson[key] = { name: row[4], nickname: row[5], team: row[6], days: new Set(), count: 0 };
    }
    byPerson[key].days.add(row[0].toString().slice(0, 10));
    byPerson[key].count++;
  }

  let msg = `📊 Export สรุปงาน ${jobId}\n\n`;
  msg += `รวม ${Object.keys(byPerson).length} คน / ${rows.length} ครั้ง\n\n`;
  for (const p of Object.values(byPerson)) {
    msg += `👤 ${p.name} (${p.nickname})\n`;
    msg += `   ทีม: ${p.team} | ${p.days.size} วัน | ${p.count} ครั้ง\n`;
  }
  msg += `\n📎 ดูข้อมูลครบใน Google Sheets → Sheet CheckIn ค่ะ`;
  return msg;
}

// =============================================
// Daily Notify Trigger
// =============================================
function sendDailyNotify() {
  const config = getConfig();
  const adminIds = getAdminIds(config);
  if (adminIds.length === 0) return;
  const msg = getDailySummary();
  adminIds.forEach(id => pushMessage(id, msg));
}

// =============================================
// LINE Messaging
// =============================================
function replyMessage(replyToken, text) {
  const token = getLineToken();
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] })
  });
}

function pushMessage(to, text) {
  const token = getLineToken();
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({ to, messages: [{ type: 'text', text }] })
  });
}

function getLineToken() {
  return PropertiesService.getScriptProperties().getProperty('LINE_TOKEN') || '';
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================
// State Management
// =============================================
function getUserState(userId) {
  return PropertiesService.getScriptProperties().getProperty('state_' + userId) || '';
}
function setUserState(userId, state) {
  PropertiesService.getScriptProperties().setProperty('state_' + userId, state);
}
function clearUserState(userId) {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('state_' + userId);
  props.deleteProperty('temp_' + userId);
}
function getTempData(userId) {
  const raw = PropertiesService.getScriptProperties().getProperty('temp_' + userId);
  return raw ? JSON.parse(raw) : {};
}
function setTempData(userId, data) {
  PropertiesService.getScriptProperties().setProperty('temp_' + userId, JSON.stringify(data));
}

// =============================================
// Help Message
// =============================================
function getHelpMessage(isAdmin) {
  if (isAdmin) {
    return `🛠 คำสั่ง Admin\n\n` +
      `📋 รายการงาน — ดูงาน Active\n` +
      `➕ สร้างงาน — สร้างงานใหม่\n` +
      `📊 สรุปวันนี้ — ยอด Check-in วันนี้\n` +
      `📈 สรุปเดือนนี้ — ยอดรายเดือน\n` +
      `📤 export JOB001 — สรุปงานนั้น\n` +
      `🗄 archive JOB001 — ปิดงานนั้น`;
  }
  return `👋 ระบบตอกบัตร MT\n\nกดลิงก์ที่ Admin ส่งให้เพื่อ Check-in ค่ะ`;
}

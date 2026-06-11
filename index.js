const express = require('express');
const line = require('@line/bot-sdk');
const { google } = require('googleapis');
const { cellToDateStr, serialToDate, serialToDisplayDate, toBangkokDateStr, formatBangkok, parseDate } = require('./lib/utils');
const { checkDuplicate } = require('./lib/checkin');
const { filterActiveJobs } = require('./lib/jobs');

const app = express();
app.use(express.json());

// CORS — allow GitHub Pages to call Render API
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const lineConfig = {
  channelAccessToken: process.env.LINE_TOKEN,
  channelSecret: process.env.LINE_SECRET,
};
const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_TOKEN,
});

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const SHEET_ID = process.env.SHEET_ID;
const LIFF_URL = `https://liff.line.me/${process.env.LIFF_ID || '2010366667-MfXxtvVD'}`;
const RENDER_URL = process.env.RENDER_URL || 'https://mt-checkin-bot.onrender.com';

// state machine for สร้างงาน
const userState = new Map();

// =============================================
// LIFF Endpoints
// =============================================

// GET /jobs — ส่งรายการงาน Active ให้ LIFF
app.get('/jobs', async (req, res) => {
  try {
    const sheets = await getSheets();
    const jobs = await getActiveJobs(sheets);
    res.json({ status: 'success', jobs });
  } catch (err) {
    console.error('/jobs error', err);
    res.json({ status: 'error', message: err.message });
  }
});

// POST /checkin — รับ check-in จาก LIFF
app.post('/checkin', async (req, res) => {
  try {
    const result = await handleCheckIn(req.body);
    res.json(result);
  } catch (err) {
    res.json({ status: 'error', message: err.message });
  }
});

// =============================================
// LINE Webhook
// =============================================
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  res.status(200).send('OK');
  try {
    await Promise.all(req.body.events.map(handleEvent));
  } catch (err) { console.error(err); }
});

app.get('/', (req, res) => res.send('MT Check-in Bot is running!'));

// =============================================
// Check-in Logic
// =============================================
async function handleCheckIn(data) {
  if (!String(data.team || '').trim()) {
    return { status: 'error', message: 'กรุณาระบุทีม/ฝ่ายค่ะ' };
  }

  const sheets = await getSheets();
  const sheet = await getSheet(sheets, 'CheckIn');

  // Bangkok time
  const now = new Date();
  const todayISO = toBangkokDateStr(now);

  // Duplicate check — read only 4 cols, use pure checkDuplicate()
  const lastRow = await getLastRow(sheets, 'CheckIn');
  if (lastRow > 1) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `CheckIn!A2:D${lastRow}`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    });
    if (checkDuplicate(res.data.values || [], data.lineUserId, data.jobId, todayISO)) {
      return { status: 'duplicate', message: 'ลงเวลางานนี้ไปแล้ววันนี้ค่ะ' };
    }
  }

  // Save
  const timestamp = formatBangkok(now, 'dd/MM/yyyy HH:mm:ss');
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'CheckIn!A1',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[
      timestamp, data.jobId, data.jobName, data.lineUserId,
      data.lineDisplayName, data.nickname, data.team,
      data.latitude, data.longitude, data.distance
    ]] }
  });

  // Notify admins
  try {
    const config = await getConfig(sheets);
    const adminIds = parseAdminIds(config);
    if (adminIds.length > 0) {
      const msg = `🟢 Check-in!\n\n👤 ${data.lineDisplayName} (${data.nickname})\n🏷 ทีม: ${data.team}\n📋 งาน: ${data.jobName}\n🕐 ${formatBangkok(now, 'HH:mm')}\n📍 ${data.distance} เมตร`;
      await Promise.all(adminIds.map(id => client.pushMessage({ to: id, messages: [{ type: 'text', text: msg }] }).catch(() => {})));
    }
  } catch (e) { console.error('notify error', e); }

  return { status: 'success' };
}

// =============================================
// LINE Event Handler
// =============================================
async function handleEvent(event) {
  if (event.type === 'follow') {
    return reply(event.replyToken, `👋 ยินดีต้อนรับ!\n\nพิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งค่ะ`);
  }
  if (event.type !== 'message') return;

  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const sheets = await getSheets();
  const config = await getConfig(sheets);
  const adminIds = parseAdminIds(config);
  const isAdmin = adminIds.includes(userId);
  const st = userState.get(userId) || {};

  // Location for สร้างงาน flow
  if (event.message.type === 'location' && isAdmin && st.state === 'CREATE_JOB_PIN') {
    const { latitude: lat, longitude: lng } = event.message;
    userState.set(userId, { state: 'CREATE_JOB_RADIUS', temp: { ...st.temp, lat, lng } });
    return reply(replyToken, `✅ พิกัด: ${lat.toFixed(6)}, ${lng.toFixed(6)}\n\nกรุณาพิมพ์ รัศมี (เมตร) เช่น 200`);
  }

  if (event.message.type !== 'text') return;
  const text = event.message.text.trim();

  // สร้างงาน state machine
  if (isAdmin && st.state && st.state.startsWith('CREATE_JOB_')) {
    return handleCreateJobFlow(userId, replyToken, text, st, sheets);
  }

  if (text === 'เข้างาน') return reply(replyToken, `📍 กดลิงก์เพื่อ Check-in ค่ะ 👇\n${LIFF_URL}`);
  if (text === 'ช่วยเหลือ' || text === 'help') {
    return reply(replyToken, isAdmin ? ADMIN_HELP : `👋 ระบบตอกบัตร MT\n\nกด Check-in ค่ะ 👇\n${LIFF_URL}`);
  }

  if (!isAdmin) return reply(replyToken, `📍 กด Check-in ได้เลยค่ะ 👇\n${LIFF_URL}`);

  if (text === 'สร้างงาน') {
    userState.set(userId, { state: 'CREATE_JOB_NAME', temp: {} });
    return reply(replyToken, '📋 สร้างงานใหม่\n\nกรุณาพิมพ์ ชื่องาน ค่ะ');
  }
  if (text === 'รายการงาน') return reply(replyToken, await getJobsList(sheets));
  if (text === 'สรุปวันนี้') return reply(replyToken, await getDailySummary(sheets));
  if (text === 'สรุปเดือนนี้') return reply(replyToken, await getMonthlySummary(sheets));
  if (text.startsWith('archive ')) return reply(replyToken, await archiveJob(sheets, text.replace('archive ', '').trim().toUpperCase()));
  if (text.startsWith('export ')) return reply(replyToken, await exportJobSummary(sheets, text.replace('export ', '').trim().toUpperCase()));

  return reply(replyToken, ADMIN_HELP);
}

// =============================================
// สร้างงาน Flow
// =============================================
async function handleCreateJobFlow(userId, replyToken, text, st, sheets) {
  const temp = st.temp || {};
  if (st.state === 'CREATE_JOB_NAME') {
    userState.set(userId, { state: 'CREATE_JOB_LOCATION', temp: { ...temp, name: text } });
    return reply(replyToken, `✅ ชื่องาน: ${text}\n\nกรุณาพิมพ์ สถานที่จัดงาน ค่ะ`);
  }
  if (st.state === 'CREATE_JOB_LOCATION') {
    userState.set(userId, { state: 'CREATE_JOB_PIN', temp: { ...temp, location: text } });
    return reply(replyToken, `✅ สถานที่: ${text}\n\n📍 กรุณาส่ง Location (กด + → Location) ค่ะ`);
  }
  if (st.state === 'CREATE_JOB_PIN') {
    return reply(replyToken, '📍 กรุณาส่ง Location ค่ะ (กด + → Location)');
  }
  if (st.state === 'CREATE_JOB_RADIUS') {
    if (isNaN(parseInt(text))) return reply(replyToken, '❌ กรุณาพิมพ์ตัวเลข เช่น 200');
    userState.set(userId, { state: 'CREATE_JOB_START', temp: { ...temp, radius: text } });
    return reply(replyToken, `✅ รัศมี: ${text} เมตร\n\nวันที่เริ่มงาน (dd/MM/yyyy) เช่น 11/06/2026`);
  }
  if (st.state === 'CREATE_JOB_START') {
    if (!parseDate(text)) return reply(replyToken, '❌ รูปแบบไม่ถูกต้อง เช่น 11/06/2026');
    userState.set(userId, { state: 'CREATE_JOB_END', temp: { ...temp, startDate: text } });
    return reply(replyToken, `✅ วันเริ่ม: ${text}\n\nวันที่สิ้นสุดงาน (dd/MM/yyyy)`);
  }
  if (st.state === 'CREATE_JOB_END') {
    if (!parseDate(text)) return reply(replyToken, '❌ รูปแบบไม่ถูกต้อง เช่น 30/06/2026');
    const d = { ...temp, endDate: text };
    userState.set(userId, { state: 'CREATE_JOB_CONFIRM', temp: d });
    return reply(replyToken,
      `📋 ยืนยันสร้างงาน\n\n📌 ${d.name}\n🏢 ${d.location}\n📍 ${Number(d.lat).toFixed(4)}, ${Number(d.lng).toFixed(4)}\n🎯 ${d.radius} เมตร\n📅 ${d.startDate} - ${text}\n\nพิมพ์ "ยืนยัน" หรือ "ยกเลิก"`);
  }
  if (st.state === 'CREATE_JOB_CONFIRM') {
    userState.delete(userId);
    if (text === 'ยืนยัน') {
      const jobId = await createJob(sheets, temp);
      return reply(replyToken, `✅ สร้างงานสำเร็จ!\nJobID: ${jobId}\nชื่อ: ${temp.name}`);
    }
    return reply(replyToken, '❌ ยกเลิกแล้วค่ะ');
  }
  userState.delete(userId);
}

// =============================================
// Google Sheets Helpers
// =============================================
async function getSheets() {
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

async function getConfig(sheets) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Config!A2:B20' });
  const cfg = {};
  (res.data.values || []).forEach(([k, v]) => { if (k) cfg[k] = v; });
  return cfg;
}

function parseAdminIds(config) {
  return ((config.admin_line_ids || config.admin_line_id || '') + '')
    .split(',').map(s => s.trim()).filter(s => /^U[0-9a-f]{32}$/i.test(s));
}

async function getLastRow(sheets, sheetName) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A:A` });
  return (res.data.values || []).length;
}

async function getActiveJobs(sheets) {
  const s = sheets || await getSheets();
  const res = await s.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: 'Jobs!A2:I100',
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  const todayISO = toBangkokDateStr(new Date());
  return filterActiveJobs(res.data.values || [], todayISO);
}

async function getCheckInRows(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: 'CheckIn!A2:J2000',
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  return res.data.values || [];
}

async function getDailySummary(sheets) {
  const rows = await getCheckInRows(sheets);
  const today = toBangkokDateStr(new Date());
  const byJob = {};
  for (const r of rows) {
    if (!r[0]) continue;
    if (cellToDateStr(r[0]) !== today) continue;
    const job = r[2] || '-';
    if (!byJob[job]) byJob[job] = [];
    byJob[job].push(`${r[5] || r[4]} (${r[6]})`);
  }
  const display = today.split('-').reverse().join('/');
  if (!Object.keys(byJob).length) return `📋 วันที่ ${display}\n\nยังไม่มีการ Check-in ค่ะ`;
  let msg = `📋 สรุป Check-in วันที่ ${display}\n\n`;
  for (const [job, people] of Object.entries(byJob)) {
    msg += `📌 ${job} (${people.length} คน)\n${people.map(p => `   • ${p}`).join('\n')}\n\n`;
  }
  return msg.trim();
}

async function getMonthlySummary(sheets) {
  const rows = await getCheckInRows(sheets);
  const thisMonth = toBangkokDateStr(new Date()).slice(0, 7);
  const byJob = {};
  for (const r of rows) {
    if (!r[0]) continue;
    const ds = cellToDateStr(r[0]);
    if (!ds || ds.slice(0, 7) !== thisMonth) continue;
    const job = r[2] || '-';
    if (!byJob[job]) byJob[job] = new Set();
    byJob[job].add(`${r[3]}_${ds}`);
  }
  const [y, m] = thisMonth.split('-');
  if (!Object.keys(byJob).length) return `📊 เดือน ${m}/${y}\n\nยังไม่มีข้อมูลค่ะ`;
  let msg = `📊 สรุปเดือน ${m}/${y}\n\n`;
  for (const [job, days] of Object.entries(byJob)) {
    msg += `📌 ${job}: ${days.size} วัน-คน\n`;
  }
  return msg.trim();
}

async function getJobsList(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: 'Jobs!A2:I100',
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const rows = (res.data.values || []).filter(r => r[8] === 'Active');
  if (!rows.length) return '📋 ไม่มีงาน Active ค่ะ\n\nพิมพ์ "สร้างงาน" เพื่อเพิ่ม';
  return `📋 งาน Active (${rows.length} งาน)\n\n` +
    rows.map(r => `📌 ${r[0]}: ${r[1]}\n   📅 ${r[5]} - ${r[6]}\n   🏢 ${r[7]}`).join('\n\n');
}

async function createJob(sheets, d) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Jobs!A2:A100' });
  let maxNum = 0;
  (res.data.values || []).forEach(([id]) => {
    const m = String(id || '').match(/^JOB(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
  });
  const jobId = 'JOB' + String(maxNum + 1).padStart(3, '0');
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: 'Jobs!A1',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[jobId, d.name, d.lat, d.lng, d.radius, d.startDate, d.endDate, d.location, 'Active']] }
  });
  return jobId;
}

async function archiveJob(sheets, jobId) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Jobs!A2:I100' });
  const rows = res.data.values || [];
  const idx = rows.findIndex(r => String(r[0]) === jobId);
  if (idx === -1) return `❌ ไม่พบ ${jobId}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `Jobs!I${idx + 2}`,
    valueInputOption: 'RAW', resource: { values: [['Archive']] }
  });
  return `✅ Archive ${jobId} (${rows[idx][1]}) แล้วค่ะ`;
}

async function exportJobSummary(sheets, jobId) {
  const rows = await getCheckInRows(sheets);
  const filtered = rows.filter(r => String(r[1]) === jobId);
  if (!filtered.length) return `❌ ไม่พบ Check-in สำหรับ ${jobId}`;
  const byPerson = {};
  for (const r of filtered) {
    const key = r[3];
    if (!byPerson[key]) byPerson[key] = { name: r[4], nick: r[5], team: r[6], days: new Set(), count: 0 };
    const ds = cellToDateStr(r[0]);
    if (ds) byPerson[key].days.add(ds);
    byPerson[key].count++;
  }
  let msg = `📊 Export ${jobId}\n\nรวม ${Object.keys(byPerson).length} คน\n\n`;
  for (const p of Object.values(byPerson)) {
    msg += `👤 ${p.name} (${p.nick}) ทีม: ${p.team}\n   ${p.days.size} วัน / ${p.count} ครั้ง\n`;
  }
  return msg.trim();
}

// Date utilities are in lib/utils.js

function reply(replyToken, text) {
  return client.replyMessage({ replyToken, messages: [{ type: 'text', text }] });
}

const ADMIN_HELP = `🛠 คำสั่ง Admin\n\n📋 รายการงาน\n➕ สร้างงาน\n📊 สรุปวันนี้\n📈 สรุปเดือนนี้\n📤 export JOB001\n🗄 archive JOB001`;

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));

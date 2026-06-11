const express = require('express');
const line = require('@line/bot-sdk');
const { google } = require('googleapis');

const app = express();

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

// =============================================
// Webhook Endpoint
// =============================================
app.use(express.static(__dirname));

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  res.status(200).send('OK');
  try {
    await Promise.all(req.body.events.map(handleEvent));
  } catch (err) {
    console.error(err);
  }
});

app.get('/', (req, res) => res.send('MT Check-in Bot is running!'));
app.get('/config', (req, res) => res.json({ webAppUrl: process.env.WEB_APP_URL }));

// =============================================
// Handle Event
// =============================================
async function handleEvent(event) {
  if (event.type === 'follow') {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: `👋 ยินดีต้อนรับสู่ระบบตอกบัตร!\n\nกดลิงก์นี้เพื่อ Check-in ค่ะ 👇\n${LIFF_URL}` }]
    });
  }

  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const text = event.message.text.trim();

  const config = await getConfig();
  const adminIds = getAdminIds(config);
  const isAdmin = adminIds.includes(userId);

  if (text === 'เข้างาน') {
    return client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: `📍 กดลิงก์นี้เพื่อ Check-in ค่ะ 👇\n${LIFF_URL}` }]
    });
  }

  if (text === 'ช่วยเหลือ' || text === 'help') {
    const helpText = isAdmin
      ? `🛠 คำสั่ง Admin\n\n📋 รายการงาน — ดูงาน Active\n📊 สรุปวันนี้ — ยอด Check-in วันนี้\n📈 สรุปเดือนนี้ — ยอดรายเดือน\n📤 export JOB001 — สรุปงานนั้น\n🗄 archive JOB001 — ปิดงานนั้น\n\n➕ สร้างงานใหม่ผ่าน LINE Bot ได้โดยพิมพ์ "สร้างงาน"`
      : `👋 ระบบตอกบัตร MT\n\nกดลิงก์ด้านล่างเพื่อ Check-in ค่ะ 👇\n${LIFF_URL}`;
    return client.replyMessage({ replyToken, messages: [{ type: 'text', text: helpText }] });
  }

  if (isAdmin) {
    if (text === 'สรุปวันนี้') {
      return client.replyMessage({ replyToken, messages: [{ type: 'text', text: await getDailySummary() }] });
    }
    if (text === 'สรุปเดือนนี้') {
      return client.replyMessage({ replyToken, messages: [{ type: 'text', text: await getMonthlySummary() }] });
    }
  }

  return client.replyMessage({
    replyToken,
    messages: [{ type: 'text', text: `📍 กด Check-in ได้เลยค่ะ 👇\n${LIFF_URL}` }]
  });
}

// =============================================
// Google Sheets Functions
// =============================================
async function getSheets() {
  const authClient = await auth.getClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

async function getConfig() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Config!A2:B10'
  });
  const config = {};
  (res.data.values || []).forEach(([k, v]) => { config[k] = v; });
  return config;
}

function getAdminIds(config) {
  const ids = (config.admin_line_ids || config.admin_line_id || '');
  return ids.split(',').map(s => s.trim()).filter(s => /^U[0-9a-f]{32}$/i.test(s));
}

async function getCheckInRows() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'CheckIn!A2:J1000',
    dateTimeRenderOption: 'FORMATTED_STRING',
    valueRenderOption: 'FORMATTED_VALUE',
  });
  return res.data.values || [];
}

// แปลง timestamp string จาก Sheets API → Date (รองรับหลาย format)
function parseSheetDate(str) {
  if (!str) return null;
  // format: "DD/MM/YYYY HH:MM:SS" หรือ "M/D/YYYY H:MM:SS AM/PM"
  const m1 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m1) {
    // ลอง dd/MM/yyyy ก่อน (Thai locale)
    const d = new Date(parseInt(m1[3]), parseInt(m1[2]) - 1, parseInt(m1[1]));
    if (!isNaN(d)) return d;
  }
  return null;
}

async function getDailySummary() {
  const rows = await getCheckInRows();
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const todayDisplay = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()}`;

  const byJob = {};
  for (const r of rows) {
    if (!r[0]) continue;
    const d = parseSheetDate(r[0]);
    if (!d) continue;
    const dStr = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
    if (dStr !== todayDisplay) continue;
    const jobName = r[2] || '-';
    const name = `${r[5] || r[4]} (${r[6]})`;
    if (!byJob[jobName]) byJob[jobName] = [];
    byJob[jobName].push(name);
  }

  if (Object.keys(byJob).length === 0) return `📋 วันที่ ${todayDisplay}\n\nยังไม่มีการ Check-in วันนี้ค่ะ`;
  let msg = `📋 สรุปการ Check-in วันที่ ${todayDisplay}\n\n`;
  for (const [job, people] of Object.entries(byJob)) {
    msg += `📌 ${job} (${people.length} คน)\n${people.map(p => `   • ${p}`).join('\n')}\n\n`;
  }
  return msg.trim();
}

async function getMonthlySummary() {
  const rows = await getCheckInRows();
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const thisMonth = `${pad(now.getMonth()+1)}/${now.getFullYear()}`;

  const byJob = {};
  for (const r of rows) {
    if (!r[0]) continue;
    const d = parseSheetDate(r[0]);
    if (!d) continue;
    const monthYear = `${pad(d.getMonth()+1)}/${d.getFullYear()}`;
    if (monthYear !== thisMonth) continue;
    const jobName = r[2] || '-';
    const key = `${r[3]}_${pad(d.getDate())}/${monthYear}`;
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));

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

// Google Sheets Auth
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const SHEET_ID = process.env.SHEET_ID;

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

app.get('/config', (req, res) => {
  res.json({ webAppUrl: process.env.WEB_APP_URL });
});

// =============================================
// Handle Event
// =============================================
async function handleEvent(event) {
  if (event.type === 'follow') {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: '👋 ยินดีต้อนรับสู่ระบบตอกบัตร!\n\nพิมพ์ "เข้างาน" เพื่อเริ่มได้เลยค่ะ' }]
    });
  }

  if (event.type !== 'message') return;

  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const msgType = event.message.type;
  const state = await getState(userId);

  if (msgType === 'text') {
    const text = event.message.text.trim();

    if (text === 'เข้างาน') {
      await setState(userId, 'WAIT_PHOTO');
      return client.replyMessage({
        replyToken,
        messages: [{ type: 'text', text: '📸 กรุณาถ่ายรูป Selfie แล้วส่งมาเลยค่ะ' }]
      });
    }

    const config = await getConfig();
    if (text === 'สรุปวันนี้' && userId === config.admin_line_id) {
      return client.replyMessage({ replyToken, messages: [{ type: 'text', text: await getDailySummary() }] });
    }
    if (text === 'สรุปเดือนนี้' && userId === config.admin_line_id) {
      return client.replyMessage({ replyToken, messages: [{ type: 'text', text: await getMonthlySummary() }] });
    }

    return client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: '💬 พิมพ์ "เข้างาน" เพื่อตอกบัตรค่ะ' }]
    });
  }

  if (msgType === 'image' && state === 'WAIT_PHOTO') {
    await setState(userId, 'WAIT_LOCATION');
    await setTemp(userId, 'imageId', event.message.id);
    return client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: '📍 ขอบคุณค่ะ\n\nกรุณากด แชร์ตำแหน่ง เพื่อส่ง Location ด้วยนะคะ' }]
    });
  }

  if (msgType === 'location' && state === 'WAIT_LOCATION') {
    const lat = event.message.latitude;
    const lng = event.message.longitude;
    const config = await getConfig();
    const distance = getDistance(
      lat, lng,
      parseFloat(config.office_lat),
      parseFloat(config.office_lng)
    );

    if (distance <= parseFloat(config.radius_meter)) {
      const name = await getEmployeeName(userId);
      await saveCheckIn(userId, name, lat, lng);
      await clearState(userId);
      const todayCount = await getTodayCount();
      await client.replyMessage({
        replyToken,
        messages: [{ type: 'text', text: `✅ เข้างานสำเร็จ!\n\n👤 ${name}\n🕐 ${getThaiTime()}\n📍 ระยะห่าง: ${Math.round(distance)} เมตร` }]
      });
      if (config.admin_line_id && config.admin_line_id !== 'Uxxxxxxxxxxxxxxxxx') {
        await client.pushMessage({
          to: config.admin_line_id,
          messages: [{ type: 'text', text: `🟢 ${name} เข้างานแล้ว (${getThaiTime()})\nวันนี้เข้างานแล้ว: ${todayCount} คน` }]
        });
      }
    } else {
      return client.replyMessage({
        replyToken,
        messages: [{ type: 'text', text: `❌ อยู่นอกพื้นที่ค่ะ\n📍 ระยะห่าง: ${Math.round(distance)} เมตร\n(อนุญาตไม่เกิน ${config.radius_meter} เมตร)` }]
      });
    }
  }
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

async function getEmployeeName(userId) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Employees!A2:B100'
  });
  const row = (res.data.values || []).find(r => r[0] === userId);
  return row ? row[1] : `ไม่พบชื่อ (${userId.slice(-6)})`;
}

async function saveCheckIn(userId, name, lat, lng) {
  const sheets = await getSheets();
  const config = await getConfig();
  const now = new Date();
  const date = now.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' });
  const time = now.toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit'
  });
  const status = time <= config.late_threshold ? '✅ ปกติ' : '⚠️ สาย';
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'CheckIn!A:H',
    valueInputOption: 'RAW',
    resource: { values: [[userId, name, date, time, lat, lng, status, '']] }
  });
}

async function getDailySummary() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'CheckIn!A2:H1000'
  });
  const today = new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' });
  const rows = (res.data.values || []).filter(r => r[2] === today);
  if (rows.length === 0) return `📋 วันที่ ${today}\n\nยังไม่มีใครเข้างานค่ะ`;
  const lines = rows.map(r => `• ${r[1]} — ${r[3]} น. ${r[6]}`);
  return `📋 สรุปการเข้างาน — ${today}\n\n✅ เข้างานแล้ว (${rows.length} คน)\n${lines.join('\n')}`;
}

async function getMonthlySummary() {
  const sheets = await getSheets();
  const checkRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'CheckIn!A2:H1000'
  });
  const empRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Employees!A2:D100'
  });
  const now = new Date();
  const thisMonth = now.toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    month: '2-digit',
    year: 'numeric'
  });
  const workDays = {};
  (checkRes.data.values || []).forEach(r => {
    if (r[2] && r[2].slice(3) === thisMonth) {
      workDays[r[0]] = (workDays[r[0]] || 0) + 1;
    }
  });
  let totalWage = 0;
  const lines = (empRes.data.values || []).map(r => {
    const days = workDays[r[0]] || 0;
    const wage = parseFloat(r[3]) || 0;
    const earned = days * wage;
    totalWage += earned;
    return `• ${r[1]}: ${days} วัน × ${wage} = ${earned.toLocaleString()} บาท`;
  });
  return `💰 สรุปค่าจ้างเดือน ${thisMonth}\n\n${lines.join('\n')}\n\n💵 รวม: ${totalWage.toLocaleString()} บาท`;
}

async function getTodayCount() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'CheckIn!C2:C1000'
  });
  const today = new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' });
  return (res.data.values || []).filter(r => r[0] === today).length;
}

// =============================================
// State Management (In-memory)
// =============================================
const stateMap = {};
const tempMap = {};
async function getState(userId) { return stateMap[userId] || ''; }
async function setState(userId, state) { stateMap[userId] = state; }
async function clearState(userId) { delete stateMap[userId]; delete tempMap[userId]; }
async function setTemp(userId, key, val) {
  if (!tempMap[userId]) tempMap[userId] = {};
  tempMap[userId][key] = val;
}

// =============================================
// Helpers
// =============================================
function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getThaiTime() {
  return new Date().toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit'
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));

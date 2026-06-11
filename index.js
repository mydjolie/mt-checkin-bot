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
const LIFF_URL = `https://liff.line.me/${process.env.LIFF_ID || '2010366667-MfXxtvVD'}`;

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

  if (text === 'เข้างาน') {
    return client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: `📍 กดลิงก์นี้เพื่อ Check-in ค่ะ 👇\n${LIFF_URL}` }]
    });
  }

  const config = await getConfig();
  if (userId === config.admin_line_id) {
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


async function getDailySummary() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'CheckIn!A2:J1000'
  });
  // timestamp format from Apps Script: "dd/MM/yyyy HH:mm:ss"
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()}`;

  const rows = (res.data.values || []).filter(r => r[0] && r[0].startsWith(todayStr));
  const displayDate = todayStr;
  if (rows.length === 0) return `📋 วันที่ ${displayDate}\n\nยังไม่มีการ Check-in วันนี้ค่ะ`;
  const lines = rows.map(r => {
    const time = r[0].slice(11, 16); // HH:mm
    return `• ${r[5] || r[4]} (${r[6]}) — ${r[2]} — ${time} น.`;
  });
  return `📋 สรุปการ Check-in วันที่ ${displayDate}\n\n✅ เข้างานแล้ว (${rows.length} คน)\n${lines.join('\n')}`;
}

async function getMonthlySummary() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'CheckIn!A2:J1000'
  });
  // timestamp format: "dd/MM/yyyy HH:mm:ss" → slice(3,10) = "MM/yyyy"
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const thisMonthStr = `${pad(now.getMonth()+1)}/${now.getFullYear()}`;

  const countByName = {};
  (res.data.values || []).forEach(r => {
    if (!r[0]) return;
    if (r[0].slice(3, 10) !== thisMonthStr) return;
    const key = `${r[5] || r[4]} (${r[6]})`;
    countByName[key] = (countByName[key] || 0) + 1;
  });

  const entries = Object.entries(countByName);
  if (entries.length === 0) return `📊 เดือน ${thisMonthStr}\n\nยังไม่มีข้อมูลค่ะ`;
  const lines = entries.map(([name, days]) => `• ${name}: ${days} วัน`);
  return `📊 สรุปการเข้างาน — ${thisMonthStr}\n\n${lines.join('\n')}\n\nรวม ${entries.length} คน`;
}


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));

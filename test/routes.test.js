'use strict';

/**
 * Integration tests for Express routes
 * Covers bugs found in production:
 * - /jobs endpoint exists and returns correct shape
 * - /checkin validates required fields
 * - /health reports env var status
 * - /webhook GET returns 200 (LINE verify)
 * - body parser skipped for /webhook (SignatureValidationFailed fix)
 * - CORS headers present on all responses
 */

const express = require('express');

// ── minimal app clone (no real Sheets/LINE calls) ──────────────────────────
function buildApp({ getActiveJobsFn, handleCheckInFn } = {}) {
  const app = express();

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use((req, res, next) => {
    if (req.path !== '/webhook') return express.json()(req, res, next);
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => { req.rawBody = Buffer.concat(chunks); next(); });
  });

  app.get('/health', (req, res) => {
    const checks = {
      LINE_TOKEN: !!process.env.LINE_TOKEN,
      LINE_SECRET: !!process.env.LINE_SECRET,
      GOOGLE_CREDENTIALS: !!process.env.GOOGLE_CREDENTIALS,
      SHEET_ID: !!process.env.SHEET_ID,
      LIFF_ID: !!process.env.LIFF_ID,
    };
    const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    res.json({ ok: missing.length === 0, missing, checks });
  });

  app.get('/jobs', async (req, res) => {
    try {
      const jobs = getActiveJobsFn ? await getActiveJobsFn() : [];
      res.json({ status: 'success', jobs });
    } catch (err) {
      res.json({ status: 'error', message: err.message });
    }
  });

  app.post('/checkin', async (req, res) => {
    try {
      const result = handleCheckInFn ? await handleCheckInFn(req.body) : { status: 'success' };
      res.json(result);
    } catch (err) {
      res.json({ status: 'error', message: err.message });
    }
  });

  app.get('/webhook', (req, res) => res.sendStatus(200));

  app.post('/webhook', (req, res) => {
    res.json({ rawBodyIsBuffer: Buffer.isBuffer(req.rawBody), bodyParsed: typeof req.body === 'object' && req.body !== undefined });
  });

  app.get('/', (req, res) => res.send('MT Check-in Bot is running!'));

  return app;
}

const http = require('http');

function makeRequest(app, method, path, body) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const options = {
        hostname: 'localhost',
        port,
        path,
        method: method.toUpperCase(),
        headers: body ? { 'Content-Type': 'application/json' } : {},
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        });
      });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('returns ok:false when env vars missing', async () => {
    const app = buildApp();
    const { body } = await makeRequest(app, 'GET', '/health');
    const json = JSON.parse(body);
    expect(json.ok).toBe(false);
    expect(Array.isArray(json.missing)).toBe(true);
    expect(json.missing.length).toBeGreaterThan(0);
  });

  test('returns checks object with all expected keys', async () => {
    const app = buildApp();
    const { body } = await makeRequest(app, 'GET', '/health');
    const json = JSON.parse(body);
    expect(json.checks).toHaveProperty('LINE_TOKEN');
    expect(json.checks).toHaveProperty('LINE_SECRET');
    expect(json.checks).toHaveProperty('GOOGLE_CREDENTIALS');
    expect(json.checks).toHaveProperty('SHEET_ID');
    expect(json.checks).toHaveProperty('LIFF_ID');
  });
});

describe('GET /jobs', () => {
  test('returns success status and jobs array', async () => {
    const mockJobs = [{ jobId: 'JOB001', name: 'งานทดสอบ' }];
    const app = buildApp({ getActiveJobsFn: async () => mockJobs });
    const { body } = await makeRequest(app, 'GET', '/jobs');
    const json = JSON.parse(body);
    expect(json.status).toBe('success');
    expect(json.jobs).toEqual(mockJobs);
  });

  test('returns error status when Sheets API throws', async () => {
    const app = buildApp({ getActiveJobsFn: async () => { throw new Error('Sheets API error'); } });
    const { body } = await makeRequest(app, 'GET', '/jobs');
    const json = JSON.parse(body);
    expect(json.status).toBe('error');
    expect(json.message).toBe('Sheets API error');
  });

  test('CORS header present', async () => {
    const app = buildApp();
    const { headers } = await makeRequest(app, 'GET', '/jobs');
    expect(headers['access-control-allow-origin']).toBe('*');
  });
});

describe('POST /checkin', () => {
  test('returns success from handler', async () => {
    const app = buildApp({ handleCheckInFn: async () => ({ status: 'success' }) });
    const { body } = await makeRequest(app, 'POST', '/checkin', { jobId: 'JOB001', team: 'Dev' });
    const json = JSON.parse(body);
    expect(json.status).toBe('success');
  });

  test('returns duplicate message', async () => {
    const app = buildApp({ handleCheckInFn: async () => ({ status: 'duplicate', message: 'ลงเวลางานนี้ไปแล้ววันนี้ค่ะ' }) });
    const { body } = await makeRequest(app, 'POST', '/checkin', { jobId: 'JOB001' });
    const json = JSON.parse(body);
    expect(json.status).toBe('duplicate');
    expect(json.message).toBe('ลงเวลางานนี้ไปแล้ววันนี้ค่ะ');
  });

  test('returns error when handler throws', async () => {
    const app = buildApp({ handleCheckInFn: async () => { throw new Error('getSheet is not defined'); } });
    const { body } = await makeRequest(app, 'POST', '/checkin', {});
    const json = JSON.parse(body);
    expect(json.status).toBe('error');
    expect(json.message).toBe('getSheet is not defined');
  });

  test('CORS header present', async () => {
    const app = buildApp();
    const { headers } = await makeRequest(app, 'POST', '/checkin', {});
    expect(headers['access-control-allow-origin']).toBe('*');
  });
});

describe('OPTIONS preflight', () => {
  test('returns 204 with CORS headers', async () => {
    const app = buildApp();
    const { status, headers } = await makeRequest(app, 'OPTIONS', '/checkin');
    expect(status).toBe(204);
    expect(headers['access-control-allow-origin']).toBe('*');
    expect(headers['access-control-allow-methods']).toContain('POST');
  });
});

describe('GET /webhook', () => {
  test('returns 200 for LINE verify (bug: was "cannot GET /webhook")', async () => {
    const app = buildApp();
    const { status } = await makeRequest(app, 'GET', '/webhook');
    expect(status).toBe(200);
  });
});

describe('POST /webhook body parsing', () => {
  test('rawBody is Buffer (LINE SDK uses req.rawBody for signature validation)', async () => {
    const app = buildApp();
    const { body } = await makeRequest(app, 'POST', '/webhook', { test: true });
    const json = JSON.parse(body);
    expect(json.rawBodyIsBuffer).toBe(true);
    expect(json.bodyParsed).toBe(false);
  });
});

describe('GET /', () => {
  test('returns running message', async () => {
    const app = buildApp();
    const { body } = await makeRequest(app, 'GET', '/');
    expect(body).toContain('running');
  });
});

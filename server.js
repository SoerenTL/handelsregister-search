#!/usr/bin/env node
/**
 * server.js  –  Handelsregister AD-Downloader
 *
 * Endpoints:
 *   POST /search        → returns company list as JSON
 *   POST /download      → streams PDF to browser
 *   POST /download-pdf  → returns PDF as base64 JSON (used by PCF)
 *
 * Session strategy:
 *   The Playwright browser session is created on the first request and reused
 *   for all subsequent ones. If the session has gone stale (portal timeout,
 *   browser crash, long idle), the error is caught automatically, the session
 *   is reset, and the request is retried once with a fresh browser — transparent
 *   to the user.
 *
 * Start:  node server.js
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { HandelsregisterClient } from './src/client.js';
import { downloadADPdf } from './src/downloader.js';
 
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ?? 3000;
 
// ── session ───────────────────────────────────────────────────────────────────
 
let client = null;
let busy = false;
 
async function getClient() {
  if (!client) {
    console.log('[session] Starting browser session...');
    client = new HandelsregisterClient({ debug: false });
    await client.openStartpage();
    console.log('[session] Ready.');
  }
  return client;
}
 
async function resetClient() {
  if (client) {
    try { await client.close(); } catch { }
    client = null;
    console.log('[session] Session closed.');
  }
}
 
/**
 * Run fn(). If it throws a stale-session error, reset the browser and run
 * fn() once more with a fresh session. Any other error is rethrown immediately.
 */
async function withAutoRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    const stale =
      err.message?.includes('Target page, context or browser has been closed') ||
      err.message?.includes('Navigation failed') ||
      err.message?.includes('net::ERR') ||
      err.message?.includes('Session closed') ||
      err.message?.includes('Protocol error') ||
      err.message?.includes('page has been closed') ||
      err.message?.includes('Timeout') ||
      err.message?.includes('timeout');
 
    if (stale) {
      console.log('[session] Stale session — resetting and retrying...');
      await resetClient();
      return await fn();   // one retry with a fresh browser
    }
 
    throw err;
  }
}
 
// ── helpers ───────────────────────────────────────────────────────────────────
 
function safeName(name) {
  return (name ?? 'company')
    .replace(/[^a-zA-Z0-9ÄÖÜäöüß\-_. ]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}
 
async function searchAndCapture(keywords, mode, rowIndex) {
  const c = await getClient();
  const companies = await c.search({
    schlagwoerter: keywords.trim(),
    schlagwortOptionen: mode,
  });
  if (!companies?.length) throw new Error(`No companies found for "${keywords}"`);
  const idx = Math.max(0, Math.min(rowIndex, companies.length - 1));
  return { companies, chosen: companies[idx], idx, page: c.page };
}
 
// ── express ───────────────────────────────────────────────────────────────────
 
const app = express();
 

app.use(cors({
  origin: true,                 // akzeptiert dynamische PCF‑Origins
  credentials: true,            // wichtig für PCF‑Sandbox
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

// Preflight für alle Routen explizit erlauben
app.options('*', cors({
  origin: true,
  credentials: true,
}))

 
app.use(express.json());
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'ui.html')));
 
// ── POST /search ──────────────────────────────────────────────────────────────
 
app.post('/search', async (req, res) => {
busy = false
 
  const { keywords, mode = 'all' } = req.body ?? {};
  if (!keywords?.trim()) { busy = false; return res.status(400).json({ error: 'keywords required' }); }
 
  try {
    const companies = await withAutoRetry(async () => {
      const c = await getClient();
      return c.search({ schlagwoerter: keywords.trim(), schlagwortOptionen: mode });
    });
    res.json({ companies: companies ?? [] });
  } catch (err) {
    console.error('[search]', err.message);
    await resetClient();
    res.status(500).json({ error: err.message });
  } finally {
    busy = false;
  }
});
 
// ── POST /download  (browser file-save) ───────────────────────────────────────
 
app.post('/download', async (req, res) => {
  if (busy) return res.status(429).json({ error: 'Another search is in progress. Please wait.' });
  busy = true;
 
  const { keywords, mode = 'all', rowIndex = 0 } = req.body ?? {};
  if (!keywords?.trim()) { busy = false; return res.status(400).json({ error: 'keywords required' }); }
 
  const tmpPath = path.join(os.tmpdir(), `hr_ad_${Date.now()}.pdf`);
 
  try {
    const { chosen, idx, page } = await withAutoRetry(() =>
      searchAndCapture(keywords, mode, rowIndex)
    );
 
    await downloadADPdf(page, tmpPath, idx);
 
    const filename = `${safeName(chosen.name)}_AD.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
 
    const stream = fs.createReadStream(tmpPath);
    stream.pipe(res);
 
    // Release busy and clean up ONLY after the stream is fully done —
    // not in finally, which would fire the moment pipe() is called
    stream.on('end', () => {
      fs.unlink(tmpPath, () => {});
      busy = false;
    });
    stream.on('error', (e) => {
      console.error('[download stream]', e.message);
      fs.unlink(tmpPath, () => {});
      busy = false;
      if (!res.headersSent) res.status(500).json({ error: e.message });
    });
    res.on('close', () => {
      // Client disconnected early (e.g. browser cancelled download)
      fs.unlink(tmpPath, () => {});
      busy = false;
    });
  } catch (err) {
    console.error('[download]', err.message);
    fs.unlink(tmpPath, () => {});
    busy = false;
    await resetClient();
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});
 
// ── POST /download-pdf  (base64 — for PCF) ───────────────────────────────────
 
app.post('/download-pdf', async (req, res) => {
  if (busy) return res.status(429).json({ error: 'Another search is in progress. Please wait.' });
  busy = true;
 
  const { keywords, mode = 'all', rowIndex = 0 } = req.body ?? {};
  if (!keywords?.trim()) { busy = false; return res.status(400).json({ error: 'keywords required' }); }
 
  const tmpPath = path.join(os.tmpdir(), `hr_ad_${Date.now()}.pdf`);
 
  try {
    const { companies, chosen, idx, page } = await withAutoRetry(() =>
      searchAndCapture(keywords, mode, rowIndex)
    );
 
    await downloadADPdf(page, tmpPath, idx);
 
    // Read file into memory first, THEN delete temp file
    const base64 = fs.readFileSync(tmpPath).toString('base64');
    fs.unlink(tmpPath, () => {});
 
    res.json({
      filename: `${safeName(chosen.name)}_AD.pdf`,
      mimeType: 'application/pdf',
      base64,
      company: {
        name:          chosen.name,
        court:         chosen.court,
        register_num:  chosen.register_num,
        state:         chosen.state,
        statusCurrent: chosen.statusCurrent,
      },
      totalResults: companies.length,
    });
  } catch (err) {
    console.error('[download-pdf]', err.message);
    fs.unlink(tmpPath, () => {});
    await resetClient();
    res.status(500).json({ error: err.message });
  } finally {
    busy = false;
  }
});
 
// ── start ─────────────────────────────────────────────────────────────────────
 
app.listen(PORT, () => {
  console.log(`\n  Handelsregister server    →  http://localhost:${PORT}`);
  console.log(`  Web UI                    →  http://localhost:${PORT}/`);
  console.log(`  PCF endpoint              →  POST http://localhost:${PORT}/download-pdf\n`);
});
 
process.on('SIGINT', async () => { await resetClient(); process.exit(0); });

#!/usr/bin/env node
/**
 * server.js  –  Handelsregister AD-Downloader Web UI
 *
 * Start:  node server.js
 * Then open http://localhost:3000 in your browser.
 *
 * The server keeps ONE shared browser session alive to avoid re-launching
 * Chromium on every request (the portal is slow enough already).
 * A single mutex prevents concurrent searches from racing.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { HandelsregisterClient } from './src/client.js';
import { downloadADPdf } from './src/downloader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ?? 3000;

// ── shared browser session ────────────────────────────────────────────────────

let client = null;
let busy = false;   // simple mutex – one search at a time

async function getClient() {
  if (!client) {
    client = new HandelsregisterClient({ debug: false });
    await client.openStartpage();
  }
  return client;
}

// Reset the client (called on errors so we get a fresh browser next time)
async function resetClient() {
  if (client) {
    try { await client.close(); } catch { /* ignore */ }
    client = null;
  }
}

// ── express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Serve the single-page UI
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'ui.html'));
});

/**
 * POST /search
 * Body: { keywords: string, mode: "all"|"min"|"exact" }
 * Returns: { companies: [...] }
 */
app.post('/search', async (req, res) => {
  if (busy) {
    return res.status(429).json({ error: 'Another search is in progress. Please wait a moment.' });
  }
  busy = true;

  const { keywords, mode = 'all' } = req.body ?? {};
  if (!keywords || !keywords.trim()) {
    busy = false;
    return res.status(400).json({ error: 'keywords is required' });
  }

  try {
    const c = await getClient();
    const companies = await c.search({
      schlagwoerter: keywords.trim(),
      schlagwortOptionen: mode,
    });
    res.json({ companies: companies ?? [] });
  } catch (err) {
    console.error('[search error]', err.message);
    await resetClient();
    res.status(500).json({ error: err.message });
  } finally {
    busy = false;
  }
});

/**
 * POST /download
 * Body: { keywords: string, mode: "all"|"min"|"exact", rowIndex: number }
 * Streams the PDF back to the browser as an attachment.
 */
app.post('/download', async (req, res) => {
  if (busy) {
    return res.status(429).json({ error: 'Another search is in progress. Please wait a moment.' });
  }
  busy = true;

  const { keywords, mode = 'all', rowIndex = 0 } = req.body ?? {};
  if (!keywords || !keywords.trim()) {
    busy = false;
    return res.status(400).json({ error: 'keywords is required' });
  }

  // Temp file to receive the download
  const tmpPath = path.join(os.tmpdir(), `hr_ad_${Date.now()}.pdf`);

  try {
    const c = await getClient();

    // Re-run the search so the results page is active
    const companies = await c.search({
      schlagwoerter: keywords.trim(),
      schlagwortOptionen: mode,
    });

    if (!companies || companies.length === 0) {
      busy = false;
      return res.status(404).json({ error: `No companies found for "${keywords}".` });
    }

    const idx = Math.max(0, Math.min(rowIndex, companies.length - 1));
    const chosen = companies[idx];

    // Click AD and capture
    await downloadADPdf(c.page, tmpPath, idx);

    // Build a sensible filename
    const safeName = (chosen.name ?? 'company')
      .replace(/[^a-zA-Z0-9ÄÖÜäöüß\-_. ]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 80);
    const filename = `${safeName}_AD.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const stream = fs.createReadStream(tmpPath);
    stream.pipe(res);
    stream.on('end', () => {
      fs.unlink(tmpPath, () => {});
    });
    stream.on('error', (e) => {
      console.error('[stream error]', e.message);
      fs.unlink(tmpPath, () => {});
      if (!res.headersSent) res.status(500).json({ error: e.message });
    });
  } catch (err) {
    console.error('[download error]', err.message);
    fs.unlink(tmpPath, () => {});
    await resetClient();
    if (!res.headersSent) res.status(500).json({ error: err.message });
  } finally {
    busy = false;
  }
});

// ── start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  Handelsregister UI ready →  http://localhost:${PORT}\n`);
});


process.on('SIGINT', async () => {
  await resetClient();
  process.exit(0);
});
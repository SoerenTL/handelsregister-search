<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Handelsregister AD Downloader</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'IBM Plex Sans', sans-serif;
    background: #fff;
    color: #111;
    font-size: 14px;
    line-height: 1.5;
  }

  header {
    border-bottom: 1px solid #e0e0e0;
    padding: 20px 32px;
  }
  header h1 {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 14px;
    font-weight: 500;
  }
  header p { font-size: 12px; color: #888; margin-top: 2px; }

  main {
    max-width: 640px;
    margin: 0 auto;
    padding: 40px 32px 80px;
  }

  .search-group {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  input[type="text"] {
    flex: 1 1 240px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 13px;
    padding: 9px 12px;
    border: 1px solid #ccc;
    background: #fff;
    color: #111;
    outline: none;
    border-radius: 0;
  }
  input[type="text"]:focus { border-color: #111; }
  input[type="text"]::placeholder { color: #bbb; }

  select {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    padding: 9px 10px;
    border: 1px solid #ccc;
    background: #fff;
    color: #111;
    cursor: pointer;
    outline: none;
    border-radius: 0;
  }
  select:focus { border-color: #111; }

  button {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    font-weight: 500;
    padding: 9px 18px;
    border: 1px solid #111;
    background: #111;
    color: #fff;
    cursor: pointer;
    border-radius: 0;
    transition: background 0.1s;
  }
  button:hover { background: #333; border-color: #333; }
  button:disabled { background: #ccc; border-color: #ccc; cursor: not-allowed; }

  .status {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: #888;
    min-height: 20px;
    margin-top: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .status.loading { color: #555; }
  .status.error   { color: #c00; }
  .status.ok      { color: #060; }

  .spinner {
    width: 12px; height: 12px;
    border: 1.5px solid #ccc;
    border-top-color: #111;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  hr {
    border: none;
    border-top: 1px solid #e0e0e0;
    margin: 28px 0;
  }

  #results { display: none; }
  #results.visible { display: block; }

  .section-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 10px;
  }

  .company-row {
    border: 1px solid #e0e0e0;
    border-top: none;
    padding: 14px 16px;
    cursor: pointer;
    background: #fff;
    position: relative;
    transition: background 0.08s;
  }
  .company-row:first-of-type { border-top: 1px solid #e0e0e0; }
  .company-row:hover { background: #f5f5f5; }
  .company-row.downloading {
    background: #f5f5f5;
    border-left: 2px solid #111;
    padding-left: 14px;
    cursor: wait;
  }

  .co-name { font-weight: 500; margin-bottom: 3px; }
  .co-detail {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: #888;
    line-height: 1.7;
  }
  .co-num {
    position: absolute;
    top: 14px; right: 14px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: #ccc;
  }
  .co-hint {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: #aaa;
    margin-top: 4px;
  }
</style>
</head>
<body>

<header>
  <h1>Handelsregister AD Downloader</h1>
  <p>Download Aktueller Ausdruck (AD) as PDF</p>
</header>

<main>

  <div class="search-group">
    <input type="text" id="q"
      placeholder="Firmenname"
      autocomplete="off" spellcheck="false">
    <select id="mode">
      <option value="all">All keywords</option>
      <option value="min">Any keyword</option>
      <option value="exact">Exact name</option>
    </select>
    <button id="searchBtn" onclick="doSearch()">Suche</button>
  </div>

  <div class="status" id="status"></div>

  <div id="results">
    <hr>
    <div class="section-label" id="resultsLabel"></div>
    <div id="companyList"></div>
  </div>

</main>

<script>
  let lastKeywords = '';
  let lastMode = 'all';
  let companies = [];
  let busy = false;

  document.getElementById('q').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });

  function setStatus(msg, type) {
    const el = document.getElementById('status');
    el.className = 'status' + (type ? ' ' + type : '');
    if (type === 'loading') {
      el.innerHTML = '<span class="spinner"></span>' + msg;
    } else {
      el.textContent = msg;
    }
  }

  async function doSearch() {
    if (busy) return;
    const q = document.getElementById('q').value.trim();
    const mode = document.getElementById('mode').value;
    if (!q) { document.getElementById('q').focus(); return; }

    lastKeywords = q;
    lastMode = mode;
    companies = [];
    busy = true;

    document.getElementById('searchBtn').disabled = true;
    setStatus('Searching — this may take 10–20 seconds', 'loading');
    document.getElementById('results').classList.remove('visible');
    document.getElementById('companyList').innerHTML = '';

    try {
      const resp = await fetch('/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: q, mode }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? 'Search failed');

      companies = data.companies ?? [];

      if (companies.length === 0) {
        setStatus('No results found for "' + q + '"', 'error');
      } else if (companies.length === 1) {
        // Single result — download immediately
        setStatus('Found: ' + companies[0].name + ' — downloading PDF', 'loading');
        await triggerDownload(0);
      } else {
        // Multiple results — show list, click to download
        setStatus(companies.length + ' companies found — click one to download its AD PDF', 'ok');
        renderResults(companies);
      }
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      busy = false;
      document.getElementById('searchBtn').disabled = false;
    }
  }

  function renderResults(list) {
    document.getElementById('resultsLabel').textContent =
      'Click a company to download its AD PDF';

    const container = document.getElementById('companyList');
    container.innerHTML = '';

    list.forEach((c, i) => {
      const div = document.createElement('div');
      div.className = 'company-row';
      div.innerHTML =
        '<span class="co-num">' + (i + 1) + '</span>' +
        '<div class="co-name">' + esc(c.name) + '</div>' +
        '<div class="co-detail">' +
          esc(c.court) + '<br>' +
          esc(c.state) +
          (c.register_num ? ' &nbsp;&middot;&nbsp; ' + esc(c.register_num) : '') +
          (c.statusCurrent ? ' &nbsp;&middot;&nbsp; ' + esc(c.statusCurrent) : '') +
          (c.documents ? '<br>Documents: ' + esc(c.documents) : '') +
        '</div>';
      div.addEventListener('click', () => {
        if (busy) return;
        downloadFromList(i, div);
      });
      container.appendChild(div);
    });

    document.getElementById('results').classList.add('visible');
  }

  async function downloadFromList(idx, rowEl) {
    busy = true;
    // Mark the row visually
    document.querySelectorAll('.company-row').forEach(r => r.classList.remove('downloading'));
    rowEl.classList.add('downloading');
    setStatus('Downloading AD PDF for ' + companies[idx].name + ' — please wait', 'loading');

    try {
      await triggerDownload(idx);
      setStatus('Saved: ' + companies[idx].name + '_AD.pdf', 'ok');
    } catch (err) {
      setStatus(err.message, 'error');
      rowEl.classList.remove('downloading');
    } finally {
      busy = false;
    }
  }

  async function triggerDownload(rowIndex) {
    const resp = await fetch('/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: lastKeywords, mode: lastMode, rowIndex }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(err.error ?? 'Download failed');
    }

    const blob = await resp.blob();
    const cd = resp.headers.get('Content-Disposition') ?? '';
    const match = cd.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : 'AD.pdf';

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);

    setStatus('Saved: ' + filename, 'ok');
  }

  function esc(s) {
    return (s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
</script>
</body>
</html>

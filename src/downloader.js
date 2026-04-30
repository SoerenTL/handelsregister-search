import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://www.handelsregister.de';

/**
 * Parse the document link buttons from search-result HTML for a given row.
 * The "documents" column contains text like "AD CD HD DK UT VÖ SI" where each
 * token corresponds to a clickable button on the row.
 *
 * Returns an array of { type, formAction, params } objects.
 */
function parseDocumentLinks($, $row) {
  const links = [];

  // Each document type is rendered as a form button / commandLink inside the row
  $row.find('a[id*="dokumenteLinkBtn"], a[onclick]').each((_, el) => {
    const $el = $(el);
    const onclick = $el.attr('onclick') ?? '';
    const text = $el.text().trim().toUpperCase();
    if (text) links.push({ type: text, onclick, el });
  });

  return links;
}

/**
 * Given a Playwright page already showing search results, find the first result
 * row and click the AD (Aktuelle Daten) document button, then intercept and save
 * the resulting PDF download.
 *
 * @param {import('playwright').Page} page
 * @param {string} outputPath - Where to save the PDF
 * @param {number} rowIndex - Which result row to use (0-based, default 0)
 * @returns {Promise<{filePath: string, companyName: string}>}
 */
export async function downloadADPdf(page, outputPath, rowIndex = 0) {
  // Find the result rows (data-ri attribute)
  const rows = page.locator('table[role="grid"] tr[data-ri]');
  const count = await rows.count();

  if (count === 0) {
    throw new Error('No search results found on the page.');
  }

  if (rowIndex >= count) {
    throw new Error(`Row index ${rowIndex} out of range (found ${count} results).`);
  }

  const $row = rows.nth(rowIndex);

  // Get the company name from the row for reporting
  const cells = await $row.locator('td').all();
  const companyName = cells.length > 2 ? (await cells[2].textContent()).trim() : 'Unknown';

  // The document buttons are rendered as JSF commandLinks.
  // They look like: <a id="...dokumenteLinkAD" ...>AD</a>
  // We need to find the AD button specifically.

  // Strategy: look for any link/button inside this row whose visible text is "AD"
  const adButton = $row.locator('a, button, span[role="button"]').filter({ hasText: /^AD$/i }).first();

  const adCount = await adButton.count();
  if (adCount === 0) {
    // Fallback: the "documents" cell (index 5) may have a comma/space separated list
    // In that case the actual clickable elements may be in a form outside the row.
    // Try finding by the row's data-ri and looking at all AD links on the page.
    const allAdLinks = page.locator('a, button').filter({ hasText: /^AD$/i });
    const totalAd = await allAdLinks.count();
    if (totalAd === 0) {
      throw new Error(
        `No AD document link found for "${companyName}". ` +
        `The company may not have an AD document available, or the page structure has changed.`
      );
    }
    // Use the one at rowIndex
    return _clickAndDownload(page, allAdLinks.nth(Math.min(rowIndex, totalAd - 1)), outputPath, companyName);
  }

  return _clickAndDownload(page, adButton, outputPath, companyName);
}

/**
 * Click a locator and capture the resulting file download (PDF).
 * @private
 */
async function _clickAndDownload(page, locator, outputPath, companyName) {
  // Set up download listener BEFORE clicking
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });

  await locator.click();

  let download;
  try {
    download = await downloadPromise;
  } catch (e) {
    // Some portals open PDFs in a new tab instead of triggering a download event.
    // Try capturing a new page/tab.
    throw new Error(
      `Download did not start within 60s. The portal may have opened the PDF in a new tab. ` +
      `Error: ${e.message}`
    );
  }

  // Ensure output directory exists
  const dir = path.dirname(path.resolve(outputPath));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  await download.saveAs(outputPath);

  const failure = await download.failure();
  if (failure) throw new Error(`Download failed: ${failure}`);

  return { filePath: path.resolve(outputPath), companyName };
}

/**
 * High-level helper: search for a company and download its AD PDF in one call.
 * This is used by the CLI `download` command.
 *
 * @param {import('./client.js').HandelsregisterClient} client - Already-initialised client
 * @param {object} opts
 * @param {string} opts.schlagwoerter - Company name / search keywords
 * @param {string} [opts.schlagwortOptionen='all'] - Search mode
 * @param {string} opts.outputPath - Destination file path for the PDF
 * @param {number} [opts.rowIndex=0] - Which result to use (0 = first / best match)
 * @returns {Promise<{filePath: string, companyName: string, companies: Array}>}
 */
export async function searchAndDownloadAD(client, opts) {
  const {
    schlagwoerter,
    schlagwortOptionen = 'all',
    outputPath,
    rowIndex = 0,
  } = opts;

  // Run the search (this navigates the page to results)
  const companies = await client.search({ schlagwoerter, schlagwortOptionen });

  if (!companies || companies.length === 0) {
    throw new Error(`No companies found for "${schlagwoerter}".`);
  }

  // Now the Playwright page is on the search-results screen.
  // Download the AD PDF from the chosen result row.
  const result = await downloadADPdf(client.page, outputPath, rowIndex);

  return { ...result, companies };
}
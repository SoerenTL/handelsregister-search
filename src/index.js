#!/usr/bin/env node
 
import { program } from 'commander';
import * as path from 'path';
import { HandelsregisterClient } from './client.js';
import { parseSearchResults } from './parser.js';
import { parseAnnouncements } from './announcements-parser.js';
import { searchAndDownloadAD } from './downloader.js';
 
/**
 * Print company info in human-readable format.
 * @param {Object} c - Company result object
 */
function printCompanyInfo(c) {
  const tags = ['name', 'court', 'register_num', 'district', 'state', 'statusCurrent'];
  for (const tag of tags) {
    console.log(`${tag}: ${c[tag] ?? '-'}`);
  }
  console.log('history:');
  for (const [name, loc] of c.history ?? []) {
    console.log(name, loc);
  }
}
 
program
  .name('handelsregister')
  .description('CLI for the German Handelsregister (commercial register) portal');
 
// ─── SEARCH ──────────────────────────────────────────────────────────────────
 
program
  .command('search')
  .description('Search for companies by keywords')
  .requiredOption('-s, --schlagwoerter <keywords>', 'Search for the provided keywords')
  .option(
    '-o, --schlagwort-optionen <option>',
    'Keyword options: all=contain all keywords; min=contain at least one keyword; exact=contain the exact company name',
    'all'
  )
  .option('--json', 'Return response as JSON')
  .option('-d, --debug', 'Enable debug mode and activate logging')
  .action(async (options) => {
    const client = new HandelsregisterClient({ debug: options.debug });
    try {
      await client.openStartpage();
      const companies = await client.search({
        schlagwoerter: options.schlagwoerter,
        schlagwortOptionen: options.schlagwortOptionen,
      });
      if (companies != null && companies.length > 0) {
        if (options.json) {
          console.log(JSON.stringify(companies));
        } else {
          for (const c of companies) {
            printCompanyInfo(c);
          }
        }
      } else {
        console.log('No results found.');
      }
    } finally {
      await client.close();
    }
  });
 
// ─── DOWNLOAD ─────────────────────────────────────────────────────────────────
 
program
  .command('download')
  .description(
    'Search for a company and download its AD (Aktuelle Daten / current excerpt) PDF.\n\n' +
    'Examples:\n' +
    '  npx handelsregister download -s "islogic"\n' +
    '  npx handelsregister download -s "Deutsche Bahn" -o db_ad.pdf\n' +
    '  npx handelsregister download -s "Gasag AG" --search-mode exact\n' +
    '  npx handelsregister download -s "Siemens" --list'
  )
  .requiredOption('-s, --schlagwoerter <keywords>', 'Company name or search keywords')
  .option(
    '-o, --output <file>',
    'Output PDF file path (default: <sanitised-company-name>_AD.pdf)'
  )
  .option(
    '--search-mode <mode>',
    'How to match keywords: all | min | exact  (default: all)',
    'all'
  )
  .option(
    '--result <n>',
    'Which result to use when multiple companies are found (1-based, default: 1)',
    '1'
  )
  .option(
    '--list',
    'List matching companies instead of downloading (lets you pick the right one first)'
  )
  .option('-d, --debug', 'Enable debug mode')
  .action(async (options) => {
    const client = new HandelsregisterClient({ debug: options.debug });
 
    try {
      await client.openStartpage();
 
      // --list mode: just show what matches
      if (options.list) {
        const companies = await client.search({
          schlagwoerter: options.schlagwoerter,
          schlagwortOptionen: options.searchMode,
        });
        if (!companies || companies.length === 0) {
          console.log(`No companies found for "${options.schlagwoerter}".`);
          return;
        }
        console.log(`\nFound ${companies.length} result(s) for "${options.schlagwoerter}":\n`);
        companies.forEach((c, i) => {
          const docs = c.documents ? `  [docs: ${c.documents}]` : '';
          console.log(`  ${i + 1}. ${c.name}${docs}`);
          console.log(`     ${c.court}`);
          console.log(`     State: ${c.state}  Status: ${c.statusCurrent}`);
        });
        console.log(
          `\nTo download, run:\n  npx handelsregister download -s "${options.schlagwoerter}" --result <n>\n`
        );
        return;
      }
 
      // Download mode
      const rowIndex = Math.max(0, parseInt(options.result ?? '1', 10) - 1);
 
      console.log(`\nSearching for "${options.schlagwoerter}" …`);
 
      // We need to know the company name before we can auto-generate the output path,
      // so run the search first to peek at the name.
      const companies = await client.search({
        schlagwoerter: options.schlagwoerter,
        schlagwortOptionen: options.searchMode,
      });
 
      if (!companies || companies.length === 0) {
        console.error(`✗  No companies found for "${options.schlagwoerter}".`);
        process.exitCode = 1;
        return;
      }
 
      if (companies.length > 1) {
        console.log(`Found ${companies.length} result(s):`);
        companies.forEach((c, i) => {
          const marker = i === rowIndex ? '→' : ' ';
          console.log(`  ${marker} ${i + 1}. ${c.name}  [${c.court}]`);
        });
        if (rowIndex >= companies.length) {
          console.error(
            `✗  --result ${rowIndex + 1} is out of range. Use a value from 1–${companies.length}.`
          );
          process.exitCode = 1;
          return;
        }
      }
 
      const chosen = companies[rowIndex];
      console.log(`\nDownloading AD for: ${chosen.name}`);
 
      // Auto-generate output path from company name if not provided
      const outputPath =
        options.output ??
        sanitiseFilename(chosen.name) + '_AD.pdf';
 
      // Now click the AD button and save the PDF
      const { filePath } = await downloadADPdfFromCurrentPage(client.page, outputPath, rowIndex);
 
      console.log(`\n✓  Saved to: ${filePath}\n`);
    } catch (err) {
      console.error(`\n✗  ${err.message}`);
      if (options.debug) console.error(err);
      process.exitCode = 1;
    } finally {
      await client.close();
    }
  });
 
// ─── ANNOUNCEMENTS ────────────────────────────────────────────────────────────
 
program
  .command('announcements')
  .description('Search Registerbekanntmachungen (register announcements) - newly published register changes')
  .option('--from <date>', 'Start date (dd.MM.yyyy). Default: 7 days ago')
  .option('--to <date>', 'End date (dd.MM.yyyy). Default: today')
  .option('--bundesland <code>', 'Federal state: BW, BY, BE, BR, HB, HH, HE, MV, NI, NW, RP, SL, SN, ST, SH, TH. Default: all')
  .option('--kategorie <id>', 'Category: 1=Löschungsankündigung, 2=Umwandlungsgesetz, 3=Einreichung neuer Dokumente, 4=Sonstige, 5=Sonderregister')
  .option('--enrich', 'Fetch full company data for each announcement (slow, ~65s delay between lookups for rate limit)')
  .option('--json', 'Return response as JSON')
  .option('-d, --debug', 'Enable debug mode')
  .action(async (options) => {
    const client = new HandelsregisterClient({ debug: options.debug });
    try {
      await client.openStartpage();
      const announcements = await client.searchAnnouncements({
        dateFrom: options.from,
        dateTo: options.to,
        bundesland: options.bundesland ?? '',
        kategorie: options.kategorie ?? '',
        enrich: options.enrich,
      });
      if (announcements != null && announcements.length > 0) {
        if (options.json) {
          console.log(JSON.stringify(announcements));
        } else {
          for (const a of announcements) {
            console.log(`${a.date} | ${a.category}`);
            console.log(`  ${a.court}`);
            console.log(`  ${a.name} – ${a.location}`);
            if (a.company) {
              console.log(`  [company] register: ${a.company.register_num ?? '-'}, status: ${a.company.statusCurrent ?? '-'}, documents: ${a.company.documents ?? '-'}`);
              if (a.company.history?.length) {
                console.log(`  [history] ${a.company.history.length} entries`);
              }
            }
            console.log();
          }
        }
      } else {
        console.log('No announcements found for the given criteria.');
      }
    } finally {
      await client.close();
    }
  });
 
program.parse();
 
export { HandelsregisterClient, parseSearchResults, parseAnnouncements };
 
// ─── Helpers ──────────────────────────────────────────────────────────────────
 
/**
 * Click the AD button on search-results page and capture the PDF download.
 * Inline here to avoid a circular import from downloader.js (which imports client.js).
 */
async function downloadADPdfFromCurrentPage(page, outputPath, rowIndex = 0) {
  const { downloadADPdf } = await import('./downloader.js');
  return downloadADPdf(page, outputPath, rowIndex);
}
 
/**
 * Turn an arbitrary company name into a safe filename string.
 * e.g. "ISLogic Aktiengesellschaft" → "ISLogic_Aktiengesellschaft"
 */
function sanitiseFilename(name) {
  return name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')   // remove chars illegal on most OSes
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 100);                            // cap length
}

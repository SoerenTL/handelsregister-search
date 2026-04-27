# handelsregister-search
 
Node.js CLI and library for the [Handelsregister](https://www.handelsregister.de) (German commercial register) portal. Query company data and download AD (Aktuelle Daten) PDFs without navigating the website manually.
 
Inspired by [bundesAPI/handelsregister](https://github.com/bundesAPI/handelsregister) (Python).
 
---
 
## Web UI — Step by step / Schritt für Schritt
 
### English
 
**1. Install dependencies**
 
```bash
npm install
npx playwright install chromium
npm install express
```
 
**2. Start the server**
 
```bash
node server.js
```
 
You will see:
```
  Handelsregister UI ready →  http://localhost:3000
```
 
**3. Open the browser**
 
Go to [http://localhost:3000](http://localhost:3000)
 
**4. Search for a company**
 
Type a company name into the search field, for example `ISLogic` or `Deutsche Bahn`.  
Choose a search mode if needed:
- **All keywords** — results must contain every word you typed (default)
- **Any keyword** — results contain at least one word
- **Exact name** — results match the company name exactly
Press **Search**. The search takes 10–20 seconds because the portal is slow.
 
**5. Select a company**
 
If multiple results appear, click the one you want. It will be highlighted.
 
**6. Download the AD PDF**
 
Click **Download AD PDF**. Your browser will save the file automatically.  
The filename is based on the company name, for example `ISLogic_Aktiengesellschaft_AD.pdf`.
 
**7. Stop the server**
 
Press `Ctrl+C` in the terminal.
 
---
 
### Deutsch
 
**1. Abhängigkeiten installieren**
 
```bash
npm install
npx playwright install chromium
npm install express
```
 
**2. Server starten**
 
```bash
node server.js
```
 
Es erscheint:
```
  Handelsregister UI ready →  http://localhost:3000
```
 
**3. Browser öffnen**
 
Adresse [http://localhost:3000](http://localhost:3000) aufrufen.
 
**4. Unternehmen suchen**
 
Den Firmennamen in das Suchfeld eingeben, z. B. `ISLogic` oder `Deutsche Bahn`.  
Bei Bedarf den Suchmodus anpassen:
- **All keywords** — Ergebnisse enthalten alle eingegebenen Wörter (Standard)
- **Any keyword** — Ergebnisse enthalten mindestens ein Wort
- **Exact name** — Ergebnisse entsprechen genau dem eingegebenen Namen
Auf **Search** klicken. Die Suche dauert 10–20 Sekunden, da das Portal langsam reagiert.
 
**5. Unternehmen auswählen**
 
Wenn mehrere Ergebnisse erscheinen, das gewünschte Unternehmen anklicken. Es wird hervorgehoben.
 
**6. AD-PDF herunterladen**
 
Auf **Download AD PDF** klicken. Der Browser speichert die Datei automatisch.  
Der Dateiname orientiert sich am Firmennamen, z. B. `ISLogic_Aktiengesellschaft_AD.pdf`.
 
**7. Server beenden**
 
Im Terminal `Ctrl+C` drücken.
 
---
 
## CLI Usage
 
### Installation
 
```bash
npm install
npx playwright install chromium
```
 
### Company search
 
```bash
npx handelsregister search -s "deutsche bahn" -o all
npx handelsregister search -s "Gasag AG" -o exact --json
```
 
| Option | Description |
|--------|-------------|
| `-s, --schlagwoerter <keywords>` | Search keywords (required) |
| `-o, --schlagwort-optionen <option>` | `all` · `min` · `exact` — default: `all` |
| `--json` | Output as JSON |
| `-d, --debug` | Enable debug logging |
 
### Download AD PDF via CLI
 
```bash
# Search and download (first result)
npx handelsregister download -s "islogic"
 
# Custom output filename
npx handelsregister download -s "Deutsche Bahn" -o deutsche_bahn_AD.pdf
 
# Exact name match
npx handelsregister download -s "Gasag AG" --search-mode exact
 
# List all results before deciding which to download
npx handelsregister download -s "Siemens" --list
 
# Download the 3rd result
npx handelsregister download -s "Siemens" --result 3
```
 
| Option | Description |
|--------|-------------|
| `-s, --schlagwoerter <keywords>` | Company name or search keywords (required) |
| `-o, --output <file>` | Output PDF file path (default: `<CompanyName>_AD.pdf`) |
| `--search-mode <mode>` | `all` · `min` · `exact` — default: `all` |
| `--result <n>` | Which result to download, 1-based (default: 1) |
| `--list` | Show matching companies without downloading |
| `-d, --debug` | Enable debug logging |
 
### Registerbekanntmachungen (announcements)
 
```bash
npx handelsregister announcements                        # last 7 days, all Germany
npx handelsregister announcements --from 01.02.2026 --to 15.02.2026
npx handelsregister announcements --bundesland BE        # Berlin only
npx handelsregister announcements --kategorie 3          # Einreichung neuer Dokumente
npx handelsregister announcements --json
npx handelsregister announcements --enrich               # adds full company data (slow)
```
 
| Option | Description |
|--------|-------------|
| `--from <date>` | Start date (dd.MM.yyyy). Default: 7 days ago |
| `--to <date>` | End date (dd.MM.yyyy). Default: today |
| `--bundesland <code>` | BW BY BE BR HB HH HE MV NI NW RP SL SN ST SH TH — default: all |
| `--kategorie <id>` | 1=Löschungsankündigung 2=Umwandlungsgesetz 3=Einreichung neuer Dokumente 4=Sonstige |
| `--enrich` | Fetch full company data per announcement (~65 s delay between lookups) |
| `--json` | Output as JSON |
 
---
 
## Programmatic Use
 
```javascript
import { HandelsregisterClient } from 'germany-handelsregister';
 
const client = new HandelsregisterClient({ debug: false });
await client.openStartpage();
 
const companies = await client.search({
  schlagwoerter: 'deutsche bahn',
  schlagwortOptionen: 'all',   // 'all' | 'min' | 'exact'
});
 
await client.close();
console.log(companies);
```
 
```javascript
import { HandelsregisterClient } from 'germany-handelsregister';
import { downloadADPdf } from './src/downloader.js';
 
const client = new HandelsregisterClient();
await client.openStartpage();
 
await client.search({ schlagwoerter: 'islogic', schlagwortOptionen: 'all' });
await downloadADPdf(client.page, './ISLogic_AD.pdf', 0);  // 0 = first result
 
await client.close();
```
 
---
 
## Rate Limit
 
The Handelsregister portal enforces a limit of **60 requests per hour** per the [Nutzungsordnung](https://www.handelsregister.de). The web UI processes one request at a time and will respond with an error if a second request arrives while one is in progress.
 
## Requirements
 
- Node.js 18+
- Playwright Chromium (`npx playwright install chromium`)
- Express (`npm install express`) — only needed for the web UI
## Troubleshooting
 
- **Search takes longer than expected** — the portal can be slow. Allow up to 30 seconds.
- **"Another search is in progress"** — the server handles one request at a time. Wait a moment and try again.
- **No AD document found** — not all companies have an AD document available on the portal.
- **Form errors / timeouts** — the site structure may change. Check for updates to this package.
## Development
 
```bash
npm test
```
 
## License
 
MIT
 
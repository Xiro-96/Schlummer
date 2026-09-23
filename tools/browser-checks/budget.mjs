// Das Schlafbudget an echten Daten: die uebliche Nacht ist Nettoschlaf, nicht
// Zeit im Bett. Wird das verwechselt, faellt die Weckempfehlung still aus.
import { chromium, devices } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const BILDER = join(HIER, 'shots');
mkdirSync(BILDER, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox']
});
let fehler = 0;
const pruefe = (b, t) => { if (!b) { fehler++; console.log('  NICHT ERFUELLT: ' + t); } };

const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
page.on('pageerror', (e) => { fehler++; console.log('  pageerror: ' + e.message); });
page.on('console', (m) => { if (m.type() === 'error') { fehler++; console.log('  console: ' + m.text()); } });
await page.clock.install({ time: new Date('2026-09-23T11:45:00+02:00') });
await page.addInitScript((j) => localStorage.setItem('schlummer.state.v1', j),
  readFileSync(join(HIER, 'fixtures-tag.json'), 'utf8'));
await page.goto('http://127.0.0.1:8145/index.html', { waitUntil: 'networkidle' });
await page.waitForSelector('.arc-center');

const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
console.log('  ' + (text.match(/Fürs Schlafbudget.{0,110}|Schläft sie länger.{0,110}/) || ['(keine Budget-Zeile)'])[0]);

// Die Weckempfehlung darf nicht ausfallen - genau das passierte, als die
// uebliche Nacht als Zeit im Bett gerechnet wurde.
pruefe(/Schlafbudget|Schläft sie länger/.test(text), 'Budget-Zeile ist da');
// Die Vorlage hat Naechte von 19:30 bis 07:00 - also 11:30 im Bett - mit
// Wachphasen an jedem zweiten Tag. Der Nettoschlaf liegt darunter. Wuerde die
// Zeit im Bett als "uebliche Nacht" gelten, bliebe fuer den Tag zu wenig
// uebrig und die Weckempfehlung fiele aus.
pruefe(/bleiben der Nacht 11 Std 30 Min/.test(text), 'uebliche Nacht ist Nettoschlaf');
pruefe(!/bleiben der Nacht 12 Std/.test(text), 'nicht die Zeit im Bett');

// Liegt die Grenze vor der erwarteten Weckzeit, muss sie auch so klingen.
pruefe(/Fürs Schlafbudget wäre 13:08 die Grenze/.test(text), 'Grenze richtig formuliert');
pruefe(!/ist Luft/.test(text), 'keine "Luft", wo keine ist');

await page.screenshot({ path: join(BILDER, 'shot-budget.png'), fullPage: true });
await browser.close();
console.log(fehler ? `\n${fehler} Abweichung(en)` : '\nAlles wie erwartet');
process.exit(fehler ? 1 : 0);

// Das Schlafangebot: Zeit im Bett plus Tagschlaf.
//
// Ein Kind, das rund 12:30 schlaeft, egal wie lange es liegen darf. Der Plan
// soll den Abend so legen, dass das Angebot die Grenze nicht sprengt - sonst
// wird aus der geschenkten Stunde eine Wachphase um eins nachts.
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const BILDER = join(HIER, 'shots');
mkdirSync(BILDER, { recursive: true });
const PORT = process.env.SCHLUMMER_PORT || '8145';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox']
});
let fehler = 0;
const pruefe = (b, t) => { if (!b) { fehler++; console.log('  NICHT ERFUELLT: ' + t); } };

const z = (tag, h, m) =>
  `2026-09-${String(tag).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+02:00`;
const sleeps = [];
for (let tag = 8; tag <= 25; tag++) {
  const grosszuegig = tag % 2 === 0;
  sleeps.push({ id: `p${tag}`, type: 'nap', start: z(tag, 11, 30), end: z(tag, 13, 0),
    note: '', settle: 'fast', mood: 'happy', wakings: null, interruptions: [] });
  sleeps.push({
    id: `n${tag}`, type: 'night',
    start: z(tag, grosszuegig ? 18 : 19, 30),
    end: z(tag + 1, grosszuegig ? 7 : 6, 30),
    note: '', settle: null, mood: null, wakings: null,
    interruptions: grosszuegig ? [{ start: z(tag + 1, 1, 0), end: z(tag + 1, 3, 0) }] : []
  });
}

const stand = JSON.stringify({
  version: 1,
  child: { name: 'Testkind', birthDate: '2025-06-01', dueDate: '' },
  settings: { morningWake: '06:30', soundTimerMin: 45, soundVolume: 0.6, lastSound: 'heartbeat',
    learning: true, napCount: 'auto', ratePrompt: true, reminders: false, onboarded: true },
  sleeps, events: [], notes: [], sickDays: [], morningOverrides: {}
});

const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
page.on('pageerror', (e) => { fehler++; console.log('  pageerror: ' + e.message); });
page.on('console', (m) => { if (m.type() === 'error') { fehler++; console.log('  console: ' + m.text()); } });
// Morgen des 26.: um 06:30 aufgestanden, noch kein Nickerchen.
await page.clock.install({ time: new Date('2026-09-26T08:00:00+02:00') });
await page.addInitScript((j) => {
  if (!localStorage.getItem('schlummer.state.v1')) localStorage.setItem('schlummer.state.v1', j);
}, stand);
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
await page.waitForSelector('.arc-center');

await page.tap('[data-action="go"][data-route="statistik"]');
await page.waitForTimeout(350);
const karte = await page.evaluate(() => {
  const h = [...document.querySelectorAll('h2')].find((x) => /Schlaf du heute anbietest/.test(x.textContent));
  return h ? h.closest('.card').innerText.replace(/\s+/g, ' ') : '';
});
pruefe(Boolean(karte), 'die Angebots-Karte ist da');
console.log('  ' + karte.slice(0, 300));
const grenze = karte.match(/Ihre Grenze[^0-9]*(\d+) Std (\d+) Min/);
pruefe(Boolean(grenze), 'die Karte nennt eine Grenze');
if (grenze) {
  const min = Number(grenze[1]) * 60 + Number(grenze[2]);
  console.log('  Grenze:', min, 'Min');
  pruefe(min >= 12 * 60 + 30 && min <= 13 * 60 + 15, `die Grenze liegt plausibel (ist ${min} Min)`);
}

// Und der Plan haelt sich daran.
await page.tap('[data-action="go"][data-route="plan"]');
await page.waitForSelector('.timeline li');
const zeilen = await page.$$eval('.timeline li', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
for (const zl of zeilen) console.log('  ' + zl);
const dauer = (s) => { const m = s.match(/(\d+) Std (\d+) Min/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const nacht = zeilen.find((x) => /Nachtschlaf/.test(x));
const naps = zeilen.filter((x) => /Nickerchen/.test(x));
const tagschlaf = naps.reduce((a, x) => a + (dauer(x) || 0), 0);
const angebot = (dauer(nacht) || 0) + tagschlaf;
console.log('  geplantes Angebot:', Math.floor(angebot / 60) + ':' + String(angebot % 60).padStart(2, '0'));
pruefe(angebot <= 13 * 60 + 15, `der Plan bleibt unter der Grenze (ist ${angebot} Min)`);

await page.screenshot({ path: join(BILDER, 'shot-angebot.png'), fullPage: true });
await browser.close();
console.log(fehler ? `\n${fehler} Abweichung(en)` : '\nAlles wie erwartet');
process.exit(fehler ? 1 : 0);

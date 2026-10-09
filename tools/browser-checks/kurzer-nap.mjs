// Ein Nickerchen, das nach einem Schlafzyklus vorbei war.
//
// Genau der Fall vom 09.10.: Kind um 06:34 wach, um 10:22 hingelegt, um 10:46
// wieder auf - 24 Minuten. Die App plante daraufhin 7 Std 42 Min Wachzeit bis
// 18:28 ins Bett. Das schafft kein Kind. Erwartet wird jetzt: ein zweites
// Nickerchen im Plan, und eine Bettzeit, die in der Naehe der gewohnten liegt.
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

const bz = (tag, h, m) =>
  `2026-09-${String(tag).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+02:00`;
// Zwoelf gelernte Tage mit einem langen Mittagsschlaf und ruhigen Naechten.
const sleeps = [];
for (let tag = 14; tag <= 25; tag++) {
  sleeps.push({ id: `p${tag}`, type: 'nap', start: bz(tag, 11, 15), end: bz(tag, 13, 0),
    note: '', settle: 'fast', mood: 'happy', wakings: null, interruptions: [] });
  sleeps.push({ id: `n${tag}`, type: 'night', start: bz(tag, 19, 10), end: bz(tag + 1, 6, 30),
    note: '', settle: null, mood: null, wakings: null, interruptions: [] });
}
// Heute: um 06:34 auf, von 10:22 bis 10:46 geschlafen.
sleeps.push({ id: 'nacht-heute', type: 'night', start: bz(25, 19, 10), end: bz(26, 6, 34),
  note: '', settle: null, mood: null, wakings: null, interruptions: [] });
sleeps.push({ id: 'kurz', type: 'nap', start: bz(26, 10, 22), end: bz(26, 10, 46),
  note: '', settle: 'fast', mood: 'happy', wakings: null, interruptions: [] });

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
await page.clock.install({ time: new Date('2026-09-26T11:44:00+02:00') });
await page.addInitScript((j) => {
  if (!localStorage.getItem('schlummer.state.v1')) localStorage.setItem('schlummer.state.v1', j);
}, stand);
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
await page.waitForSelector('.arc-center');

await page.tap('[data-action="go"][data-route="plan"]');
await page.waitForSelector('.timeline li');
const zeilen = await page.$$eval('.timeline li', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
for (const z of zeilen) console.log('  ' + z);

const nickerchen = zeilen.filter((z) => /Nickerchen/.test(z));
pruefe(nickerchen.length >= 2, `ein zweites Nickerchen ist eingeplant (sind ${nickerchen.length})`);

const nacht = zeilen.find((z) => /Nachtschlaf/.test(z));
const bett = nacht && nacht.match(/(\d{2}):(\d{2})/);
if (bett) {
  const minuten = Number(bett[1]) * 60 + Number(bett[2]);
  console.log('  Bettzeit:', bett[0]);
  pruefe(minuten >= 18 * 60 + 30, `die Bettzeit rutscht nicht in den Nachmittag (ist ${bett[0]})`);
}

// Und das lange Wachfenster darf es so nicht geben.
const fenster = zeilen.filter((z) => /Wachfenster/.test(z));
for (const f of fenster) {
  const m = f.match(/(\d+) Std (\d+) Min/);
  if (m) pruefe(Number(m[1]) < 7, `kein Wachfenster von sieben Stunden (${f})`);
}

await page.screenshot({ path: join(BILDER, 'shot-kurzer-nap.png'), fullPage: true });
await browser.close();
console.log(fehler ? `\n${fehler} Abweichung(en)` : '\nAlles wie erwartet');
process.exit(fehler ? 1 : 0);

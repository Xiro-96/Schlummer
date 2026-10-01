// Aufstehzeit von Hand setzen, an einem Tag ohne erfasste Nacht.
//
// Genau das ging eine Version lang nicht: die Eingabe landete in den
// Einstellungen, und die gelernte Gewohnheit hatte Vorrang davor. Man tippte
// eine Zeit ein und es passierte nichts.
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
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

// Zehn Naechte mit Aufstehen gegen 06:40 - daraus lernt die App ihre
// Gewohnheit. Fuer heute ist nichts erfasst.
const bz = (tag, h, m) =>
  `2026-09-${String(tag).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+02:00`;
const sleeps = [];
for (const [tag, h, m] of [[21, 6, 38], [22, 6, 42], [23, 6, 40], [24, 6, 36], [25, 6, 40]]) {
  sleeps.push({ id: `n${tag}`, type: 'night', start: bz(tag - 1, 19, 15), end: bz(tag, h, m),
    note: '', settle: null, mood: null, wakings: null, interruptions: [] });
  sleeps.push({ id: `p${tag}`, type: 'nap', start: bz(tag, 11, 30), end: bz(tag, 13, 20),
    note: '', settle: 'fast', mood: 'happy', wakings: null, interruptions: [] });
}

const stand = JSON.stringify({
  version: 1,
  child: { name: 'Testkind', birthDate: '2025-06-01', dueDate: '' },
  settings: { morningWake: '06:38', soundTimerMin: 45, soundVolume: 0.6, lastSound: 'heartbeat',
    learning: true, napCount: 'auto', ratePrompt: true, reminders: false, onboarded: true },
  sleeps, events: [], notes: [], sickDays: [], morningOverrides: {}
});

const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
page.on('pageerror', (e) => { fehler++; console.log('  pageerror: ' + e.message); });
page.on('console', (m) => { if (m.type() === 'error') { fehler++; console.log('  console: ' + m.text()); } });
await page.clock.install({ time: new Date('2026-10-01T08:00:00+02:00') });
await page.addInitScript((j) => {
  if (!localStorage.getItem('schlummer.state.v1')) localStorage.setItem('schlummer.state.v1', j);
}, stand);
await page.goto('http://127.0.0.1:8145/index.html', { waitUntil: 'networkidle' });
await page.waitForSelector('.arc-center');

const geh = async (route) => {
  await page.tap(`[data-action="go"][data-route="${route}"]`);
  await page.waitForTimeout(280);
};

// Ausgangslage: geschaetzt aus der Gewohnheit
await geh('plan');
await page.waitForSelector('#morning');
const vorher = await page.inputValue('#morning');
console.log('  vorher (geschätzt):', vorher);
pruefe(vorher === '06:40', `Gewohnheit als Ausgangswert (ist ${vorher})`);
pruefe(/keine Nacht erfasst/.test(await page.evaluate(() => document.body.innerText)),
  'Hinweis, dass die Zeit geschätzt ist');

// Jetzt von Hand auf 05:50 setzen
await page.fill('#morning', '05:50');
await page.dispatchEvent('#morning', 'change');
await page.waitForTimeout(400);
const nachher = await page.inputValue('#morning');
console.log('  nach der Eingabe:', nachher);
pruefe(nachher === '05:50', `die Eingabe haelt (ist ${nachher})`);

// Und sie ueberlebt den Wechsel der Ansicht ...
await geh('heute');
await geh('plan');
await page.waitForSelector('#morning');
const spaeter = await page.inputValue('#morning');
pruefe(spaeter === '05:50', `haelt beim Zurueckblaettern (ist ${spaeter})`);

// ... und den Neustart.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.arc-center');
await geh('plan');
await page.waitForSelector('#morning');
const neustart = await page.inputValue('#morning');
console.log('  nach dem Neustart:', neustart);
pruefe(neustart === '05:50', `haelt ueber den Neustart (ist ${neustart})`);

// Der Hinweis "geschaetzt" muss jetzt weg sein - die Zeit ist gesetzt.
pruefe(!/keine Nacht erfasst/.test(await page.evaluate(() => document.body.innerText)),
  'kein Schaetz-Hinweis mehr, wenn die Zeit gesetzt ist');

// Der ganze Plan haengt daran: das Nickerchen rueckt mit nach vorn.
const zeilen = await page.$$eval('.timeline li', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
console.log('  ' + zeilen[0]);
pruefe(/^05:50 /.test(zeilen[0]), 'der Plan startet bei der gesetzten Zeit');

// Eine erfasste Nacht schlaegt die Handeingabe weiterhin.
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('schlummer.state.v1'));
  s.sleeps.push({ id: 'heute-nacht', type: 'night',
    start: '2026-09-30T19:20:00+02:00', end: '2026-10-01T07:05:00+02:00',
    note: '', settle: null, mood: null, wakings: null, interruptions: [] });
  localStorage.setItem('schlummer.state.v1', JSON.stringify(s));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.arc-center');
await geh('plan');
await page.waitForSelector('#morning');
const mitNacht = await page.inputValue('#morning');
console.log('  mit erfasster Nacht:', mitNacht);
pruefe(mitNacht === '07:05', `die erfasste Nacht gilt (ist ${mitNacht})`);

await page.screenshot({ path: join(BILDER, 'shot-aufstehzeit.png'), fullPage: true });
await browser.close();
console.log(fehler ? `\n${fehler} Abweichung(en)` : '\nAlles wie erwartet');
process.exit(fehler ? 1 : 0);

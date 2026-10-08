// Das Tagschlaf-Ziel aus den ruhigen Naechten: steht es in der Statistik, und
// rechnet der Plan damit?
//
// Hintergrund: Je mehr dieses Kind mittags schlaeft, desto haeufiger liegt es
// nachts wach. Die App soll das erkennen und das Nickerchen danach planen -
// nicht nach dem Richtwert des Alters.
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

// Vierzehn Tage im Wechsel: 1:20 Mittagsschlaf und durchgeschlafen, oder
// 2:20 Mittagsschlaf und zwei Stunden wach. Zeit im Bett immer gleich.
const bz = (tag, h, m) =>
  `2026-09-${String(tag).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+02:00`;
const sleeps = [];
for (let tag = 15; tag <= 28; tag++) {
  const viel = tag % 2 === 1;
  sleeps.push({
    id: `p${tag}`, type: 'nap', start: bz(tag, 11, 0), end: bz(tag, viel ? 13 : 12, 20),
    note: '', settle: 'fast', mood: 'happy', wakings: null, interruptions: []
  });
  sleeps.push({
    id: `n${tag}`, type: 'night', start: bz(tag, 19, 0), end: bz(tag + 1, 6, 30),
    note: '', settle: null, mood: null, wakings: viel ? 1 : 0,
    interruptions: viel ? [{ start: bz(tag + 1, 1, 0), end: bz(tag + 1, 3, 0) }] : []
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
await page.clock.install({ time: new Date('2026-09-29T08:00:00+02:00') });
await page.addInitScript((j) => {
  if (!localStorage.getItem('schlummer.state.v1')) localStorage.setItem('schlummer.state.v1', j);
}, stand);
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
await page.waitForSelector('.arc-center');

const geh = async (route) => {
  await page.tap(`[data-action="go"][data-route="${route}"]`);
  await page.waitForTimeout(320);
};

// Die Statistik soll beide Zahlen nennen.
await geh('statistik');
const text = await page.evaluate(() => document.body.innerText);
pruefe(/Wie viel Mittagsschlaf zu ruhigen N/.test(text), 'Die Karte ist da');
const karte = await page.evaluate(() => {
  const h = [...document.querySelectorAll('h2')].find((x) => /Mittagsschlaf zu ruhigen/.test(x.textContent));
  return h ? h.closest('.card').innerText.replace(/\s+/g, ' ') : '';
});
console.log('  ' + karte.slice(0, 220));
pruefe(/1 Std 20 Min/.test(karte), 'der ruhige Wert steht da (1:20)');
pruefe(/2 Std 20 Min/.test(karte), 'der unruhige Wert steht da (2:20)');

// Und der Plan rechnet damit: ein Nickerchen von rund 1:20, nicht von 2:20.
await geh('plan');
await page.waitForSelector('.timeline li');
const zeilen = await page.$$eval('.timeline li', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
for (const z of zeilen) console.log('  ' + z);
const nickerchen = zeilen.find((z) => /Nickerchen/.test(z));
pruefe(Boolean(nickerchen), 'ein Nickerchen steht im Plan');
const dauer = nickerchen && nickerchen.match(/(\d+) Std (\d+) Min|(\d+) Min/);
const minuten = (() => {
  if (!dauer) return null;
  return dauer[1] ? Number(dauer[1]) * 60 + Number(dauer[2]) : Number(dauer[3]);
})();
console.log('  geplantes Nickerchen:', minuten, 'Min');
pruefe(minuten !== null && minuten <= 95, `das Nickerchen bleibt beim Ziel (ist ${minuten} Min)`);

// Und jetzt der Unterschied, der leicht durcheinandergeht: der Bogen zeigt
// eine Prognose ("wach etwa"), die Karte darunter eine Empfehlung. Die
// Prognose muss sagen, wie lange das Kind wirklich schlaeft - sonst steht
// da eine Zahl, die mit der Erfahrung der Eltern nicht zusammenpasst.
await geh('heute');
await page.tap('[data-action="start-nap"]');
await page.waitForTimeout(400);
const bogen = await page.evaluate(() => document.querySelector('.arc-center').innerText.replace(/\s+/g, ' '));
console.log('  Bogen:', bogen);
const prognose = bogen.match(/wach etwa (\d{2}):(\d{2})/);
pruefe(Boolean(prognose), 'der Bogen nennt eine Prognose');
if (prognose) {
  // Start war 08:00. Die gelernte Laenge liegt zwischen den 1:20 der ruhigen
  // und den 2:20 der unruhigen Tage - das Ziel von 80 Minuten darf es nicht
  // sein, sonst ist aus der Prognose eine Empfehlung geworden.
  const minuten = Number(prognose[1]) * 60 + Number(prognose[2]) - 8 * 60;
  console.log('  Prognose:', minuten, 'Min nach dem Einschlafen');
  pruefe(minuten > 85, `die Prognose ist die gelernte Laenge, nicht das Ziel (ist ${minuten} Min)`);
}
const heuteText = await page.evaluate(() => document.body.innerText);
const empfehlung = heuteText.match(/(?:bis|wäre) (\d{2}):(\d{2})/);
pruefe(Boolean(empfehlung), 'es gibt eine Weckempfehlung');
if (empfehlung && prognose) {
  const e = Number(empfehlung[1]) * 60 + Number(empfehlung[2]);
  const p = Number(prognose[1]) * 60 + Number(prognose[2]);
  console.log('  Weckempfehlung:', empfehlung[0], '| Prognose:', prognose[0]);
  pruefe(e < p, 'die Empfehlung liegt vor der Prognose');
}

await page.screenshot({ path: join(BILDER, 'shot-tagziel.png'), fullPage: true });
await browser.close();
console.log(fehler ? `\n${fehler} Abweichung(en)` : '\nAlles wie erwartet');
process.exit(fehler ? 1 : 0);

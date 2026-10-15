// Experiment starten, laufen lassen, auswerten.
//
// Der Punkt der Sache: Alles andere in der App ist Beobachtung, und die kann
// Ursache und Wirkung verwechseln. Wer die Zeiten absichtlich setzt, kann das
// trennen - aber nur, wenn die Auswertung auch sagt, wenn sie nichts weiss.
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
// Zwei Wochen vorher: spaet ins Bett, langer Mittagsschlaf, jede zweite Nacht
// eine lange Wachphase.
const sleeps = [];
for (let tag = 1; tag <= 14; tag++) {
  sleeps.push({ id: `p${tag}`, type: 'nap', start: z(tag, 12, 30), end: z(tag, 14, 40),
    note: '', settle: 'fast', mood: 'happy', wakings: null, interruptions: [] });
  sleeps.push({
    id: `n${tag}`, type: 'night', start: z(tag, 19, 45), end: z(tag + 1, 7, 30),
    note: '', settle: null, mood: null, wakings: null,
    interruptions: tag % 2 === 0 ? [{ start: z(tag + 1, 1, 0), end: z(tag + 1, 2, 30) }] : []
  });
}

const stand = JSON.stringify({
  version: 1,
  child: { name: 'Testkind', birthDate: '2025-06-01', dueDate: '' },
  settings: { morningWake: '07:30', soundTimerMin: 45, soundVolume: 0.6, lastSound: 'heartbeat',
    learning: true, napCount: 'auto', ratePrompt: false, reminders: false, onboarded: true,
    wunschBett: '19:00', wunschAuf: '06:30' },
  sleeps, events: [], notes: [], sickDays: [], morningOverrides: {},
  experiment: null, experimente: []
});

const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
page.on('pageerror', (e) => { fehler++; console.log('  pageerror: ' + e.message); });
page.on('console', (m) => { if (m.type() === 'error') { fehler++; console.log('  console: ' + m.text()); } });
await page.clock.install({ time: new Date('2026-09-15T08:00:00+02:00') });
await page.addInitScript((j) => {
  if (!localStorage.getItem('schlummer.state.v1')) localStorage.setItem('schlummer.state.v1', j);
}, stand);
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
await page.waitForSelector('.arc-center');

const geh = async (route) => {
  await page.tap(`[data-action="go"][data-route="${route}"]`);
  await page.waitForTimeout(320);
};
const karte = async (muster) =>
  page.evaluate((m) => {
    const h = [...document.querySelectorAll('h2')].find((x) => new RegExp(m).test(x.textContent));
    return h ? h.closest('.card').innerText.replace(/\s+/g, ' ') : '';
  }, muster);

// Starten
await geh('mehr');
await page.waitForSelector('[data-action="start-experiment"]');
await page.tap('[data-action="start-experiment"]');
await page.waitForTimeout(400);
const gestartet = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('schlummer.state.v1'));
  return s.experiment;
});
pruefe(Boolean(gestartet && !gestartet.ende), 'das Experiment ist gespeichert');
console.log('  gestartet:', gestartet && gestartet.name, '| Ziel:', JSON.stringify(gestartet && gestartet.ziel));
pruefe(gestartet && gestartet.ziel.bettMinute === 19 * 60, 'die Wunsch-Bettzeit ist die Vorgabe');

// Am dritten Tag: Hinweis auf der Startseite, aber noch kein Urteil.
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('schlummer.state.v1'));
  for (let tag = 15; tag <= 16; tag++) {
    const zz = (t, h, m) => `2026-09-${String(t).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+02:00`;
    s.sleeps.push({ id: `pe${tag}`, type: 'nap', start: zz(tag, 11, 30), end: zz(tag, 13, 0),
      note: '', settle: 'fast', mood: 'happy', wakings: null, interruptions: [] });
    s.sleeps.push({ id: `ne${tag}`, type: 'night', start: zz(tag, 19, 0), end: zz(tag + 1, 6, 30),
      note: '', settle: null, mood: null, wakings: null, interruptions: [] });
  }
  localStorage.setItem('schlummer.state.v1', JSON.stringify(s));
});
await page.clock.setFixedTime(new Date('2026-09-17T09:00:00+02:00'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.arc-center');
const heute = await karte('Rhythmus');
console.log('  Startseite:', heute.slice(0, 180));
pruefe(/Tag 3 von 7/.test(heute), 'die Startseite zeigt den Tag des Experiments');

await geh('statistik');
const frueh = await karte('Rhythmus');
pruefe(/zu wenig/.test(frueh), 'bei zwei Naechten sagt die Auswertung, dass es zu wenig ist');

// Volle Woche nachtragen und auswerten.
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('schlummer.state.v1'));
  const zz = (t, h, m) => `2026-09-${String(t).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+02:00`;
  for (let tag = 17; tag <= 21; tag++) {
    s.sleeps.push({ id: `pe${tag}`, type: 'nap', start: zz(tag, 11, 30), end: zz(tag, 13, 0),
      note: '', settle: 'fast', mood: 'happy', wakings: null, interruptions: [] });
    s.sleeps.push({ id: `ne${tag}`, type: 'night', start: zz(tag, 19, 0), end: zz(tag + 1, 6, 30),
      note: '', settle: null, mood: null, wakings: null,
      interruptions: tag === 19 ? [{ start: zz(tag + 1, 1, 0), end: zz(tag + 1, 2, 10) }] : [] });
  }
  localStorage.setItem('schlummer.state.v1', JSON.stringify(s));
});
await page.clock.setFixedTime(new Date('2026-09-22T09:00:00+02:00'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.arc-center');
await geh('statistik');
const fertig = await karte('Rhythmus');
console.log('  Auswertung:', fertig.slice(0, 460));
pruefe(/7 von 7/.test(fertig), 'die Auswertung zaehlt die eingehaltenen Tage');
pruefe(/1 von 7/.test(fertig), 'die langen Wachphasen im Experiment stehen da');
pruefe(/7 von 14/.test(fertig), 'und die davor');
pruefe(/von 100/.test(fertig), 'die Auswertung sagt, wie oft das Zufall waere');
pruefe(!/zu wenig/.test(fertig), 'mit sieben Naechten wird gerechnet');

await page.screenshot({ path: join(BILDER, 'shot-experiment.png'), fullPage: true });
await browser.close();
console.log(fehler ? `\n${fehler} Abweichung(en)` : '\nAlles wie erwartet');
process.exit(fehler ? 1 : 0);

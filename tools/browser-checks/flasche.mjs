// Flasche und Windel erfassen - zwei Tipps pro Wachphase, Menge am Abend.
//
// Der Fall dahinter: Das Kind bekommt abends knapp 300 ml, hat nachts eine
// sehr volle Windel und dann nochmal eine Flasche. Drei Erklaerungen stehen
// nebeneinander, und keine laesst sich erschliessen - nur beobachten. Damit
// das klappt, muss die Erfassung an der Stelle sein, an der man morgens
// ohnehin steht, und zwei Tipps kosten.
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
for (let tag = 12; tag <= 25; tag++) {
  sleeps.push({ id: `p${tag}`, type: 'nap', start: z(tag, 11, 30), end: z(tag, 13, 10),
    note: '', settle: 'fast', mood: 'happy', wakings: null, interruptions: [] });
  sleeps.push({ id: `n${tag}`, type: 'night', start: z(tag, 19, 30), end: z(tag + 1, 6, 40),
    note: '', settle: 'fast', mood: 'happy', wakings: null,
    interruptions: [{ start: z(tag + 1, 1, 30), end: z(tag + 1, 3, 0) }] });
}

const stand = JSON.stringify({
  version: 1,
  child: { name: 'Testkind', birthDate: '2025-06-01', dueDate: '' },
  settings: { morningWake: '06:40', soundTimerMin: 45, soundVolume: 0.6, lastSound: 'heartbeat',
    learning: true, napCount: 'auto', ratePrompt: false, reminders: false, onboarded: true,
    wunschBett: '', wunschAuf: '' },
  sleeps, events: [], notes: [], sickDays: [], morningOverrides: {},
  experiment: null, experimente: []
});

const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
page.on('pageerror', (e) => { fehler++; console.log('  pageerror: ' + e.message); });
page.on('console', (m) => { if (m.type() === 'error') { fehler++; console.log('  console: ' + m.text()); } });
await page.clock.install({ time: new Date('2026-09-26T09:00:00+02:00') });
await page.addInitScript((j) => {
  if (!localStorage.getItem('schlummer.state.v1')) localStorage.setItem('schlummer.state.v1', j);
}, stand);
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
await page.waitForSelector('.arc-center');

const flagWert = () => page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('schlummer.state.v1'));
  const n = s.sleeps.find((x) => x.id === 'n25');
  return n.interruptions[0].flasche;
});

// Der Schalter muss dreiwertig sein: ja -> nein -> offen.
await page.waitForSelector('[data-action="toggle-flag"][data-feld="flasche"]');
pruefe(await flagWert() === undefined, 'am Anfang ist nichts beantwortet');
await page.tap('[data-action="toggle-flag"][data-feld="flasche"]');
await page.waitForTimeout(250);
pruefe(await flagWert() === true, 'erster Tipp: ja');
await page.tap('[data-action="toggle-flag"][data-feld="flasche"]');
await page.waitForTimeout(250);
pruefe(await flagWert() === false, 'zweiter Tipp: nein');
await page.tap('[data-action="toggle-flag"][data-feld="flasche"]');
await page.waitForTimeout(250);
pruefe(await flagWert() === null, 'dritter Tipp loescht die Angabe wieder');
await page.tap('[data-action="toggle-flag"][data-feld="flasche"]');
await page.waitForTimeout(250);

// Die Windel ist ein eigener Schalter.
await page.tap('[data-action="toggle-flag"][data-feld="windel"]');
await page.waitForTimeout(250);
const beide = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('schlummer.state.v1'));
  const g = s.sleeps.find((x) => x.id === 'n25').interruptions[0];
  return { flasche: g.flasche, windel: g.windel };
});
console.log('  nach den Tipps:', JSON.stringify(beide));
pruefe(beide.flasche === true && beide.windel === true, 'beide Angaben stehen nebeneinander');

// Die Abendmenge.
await page.fill('#abend-ml', '300');
await page.dispatchEvent('#abend-ml', 'change');
await page.waitForTimeout(300);
const ml = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('schlummer.state.v1')).sleeps.find((x) => x.id === 'n25').flascheMl
);
console.log('  Abendflasche gespeichert:', ml);
pruefe(ml === 300, `die Menge haelt (ist ${ml})`);

// Und die Auswertung sagt bei einer Nacht, dass es zu wenig ist.
await page.tap('[data-action="go"][data-route="statistik"]');
await page.waitForTimeout(350);
const karte = await page.evaluate(() => {
  const h = [...document.querySelectorAll('h2')].find((x) => /Flasche, Windel/.test(x.textContent));
  return h ? h.closest('.card').innerText.replace(/\s+/g, ' ') : '';
});
console.log('  ' + karte.slice(0, 260));
pruefe(Boolean(karte), 'die Auswertungs-Karte ist da');
pruefe(/reichen die Daten noch nicht/.test(karte), 'bei einer Nacht wird nicht gerechnet');

// Mit genug Naechten wird gerechnet.
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('schlummer.state.v1'));
  let i = 0;
  for (const n of s.sleeps) {
    if (n.type !== 'night' || !n.interruptions.length) continue;
    const mit = i % 2 === 0;
    n.interruptions[0].flasche = mit;
    if (!mit) n.interruptions[0].end = n.interruptions[0].start;
    i++;
  }
  localStorage.setItem('schlummer.state.v1', JSON.stringify(s));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.arc-center');
await page.tap('[data-action="go"][data-route="statistik"]');
await page.waitForTimeout(350);
const karte2 = await page.evaluate(() => {
  const h = [...document.querySelectorAll('h2')].find((x) => /Flasche, Windel/.test(x.textContent));
  return h ? h.closest('.card').innerText.replace(/\s+/g, ' ') : '';
});
console.log('  ' + karte2.slice(0, 320));
pruefe(/von 100/.test(karte2), 'mit genug Naechten steht die Zufallschance da');

// Und dasselbe am Nickerchen: ein Schalter am Schlaf selbst, ein ml-Feld.
// Die Karte heisst "Nickerchen heute" - also braucht es eines von heute.
await page.evaluate(() => {
  const st = JSON.parse(localStorage.getItem('schlummer.state.v1'));
  st.sleeps.push({ id: 'p-heute', type: 'nap',
    start: '2026-09-26T10:30:00+02:00', end: '2026-09-26T12:00:00+02:00',
    note: '', settle: 'fast', mood: 'happy', wakings: null, interruptions: [] });
  localStorage.setItem('schlummer.state.v1', JSON.stringify(st));
});
await page.clock.setFixedTime(new Date('2026-09-26T13:00:00+02:00'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.arc-center');
await page.waitForTimeout(350);
const napKarte = await page.evaluate(() => {
  const h = [...document.querySelectorAll('h2')].find((x) => /Nickerchen heute/.test(x.textContent));
  return h ? h.closest('.card').innerText.replace(/\s+/g, ' ') : '';
});
console.log('  ' + napKarte.slice(0, 160));
pruefe(Boolean(napKarte), 'die Nickerchen-Karte ist da');
const napChip = '.nap-block [data-action="toggle-flag"][data-feld="windel"]';
await page.waitForSelector(napChip);
await page.tap(napChip);
await page.waitForTimeout(250);
const napWindel = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('schlummer.state.v1')).sleeps.find((x) => x.id === 'p-heute').windel
);
pruefe(napWindel === true, `die Angabe haengt am Nickerchen (ist ${napWindel})`);
await page.fill('.nap-block .ml-feld', '150');
await page.dispatchEvent('.nap-block .ml-feld', 'change');
await page.waitForTimeout(300);
const napMl = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('schlummer.state.v1')).sleeps.find((x) => x.id === 'p-heute').flascheMl
);
console.log('  Nickerchen-Flasche:', napMl, '| Windel:', napWindel);
pruefe(napMl === 150, `die Menge am Nickerchen haelt (ist ${napMl})`);
// Die Abendmenge darf davon unberuehrt bleiben - zwei Felder, zwei Eintraege.
const abendNoch = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('schlummer.state.v1')).sleeps.find((x) => x.id === 'n25').flascheMl
);
pruefe(abendNoch === 300, `die Abendmenge bleibt stehen (ist ${abendNoch})`);

await page.screenshot({ path: join(BILDER, 'shot-flasche.png'), fullPage: true });
await browser.close();
console.log(fehler ? `\n${fehler} Abweichung(en)` : '\nAlles wie erwartet');
process.exit(fehler ? 1 : 0);

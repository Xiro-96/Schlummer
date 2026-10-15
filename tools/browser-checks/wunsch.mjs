// Wunschrhythmus und der Knopf unter der Bewertung.
//
// Zwei Beschwerden auf einmal: Der Plan schlug 20:15 vor, obwohl die Familie
// 19 Uhr will - die App hatte die verrutschten Ausschlaf-Morgen mitgelernt.
// Und der Knopf im Bewertungs-Sheet hatte gar keinen Handler, da passierte
// beim Tippen schlicht nichts.
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

// Ein Kind, dessen Rhythmus nach hinten gerutscht ist: Bett gegen 20:00,
// morgens erst um 07:30 raus.
const z = (tag, h, m) =>
  `2026-09-${String(tag).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+02:00`;
const sleeps = [];
for (let tag = 12; tag <= 25; tag++) {
  sleeps.push({ id: `p${tag}`, type: 'nap', start: z(tag, 12, 30), end: z(tag, 14, 20),
    note: '', settle: 'fast', mood: 'happy', wakings: null, interruptions: [] });
  sleeps.push({ id: `n${tag}`, type: 'night', start: z(tag, 20, 0), end: z(tag + 1, 7, 30),
    note: '', settle: null, mood: null, wakings: null, interruptions: [] });
}

const stand = JSON.stringify({
  version: 1,
  child: { name: 'Testkind', birthDate: '2025-06-01', dueDate: '' },
  settings: { morningWake: '07:30', soundTimerMin: 45, soundVolume: 0.6, lastSound: 'heartbeat',
    learning: true, napCount: 'auto', ratePrompt: true, reminders: false, onboarded: true,
    wunschBett: '', wunschAuf: '' },
  sleeps, events: [], notes: [], sickDays: [], morningOverrides: {}
});

const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
page.on('pageerror', (e) => { fehler++; console.log('  pageerror: ' + e.message); });
page.on('console', (m) => { if (m.type() === 'error') { fehler++; console.log('  console: ' + m.text()); } });
await page.clock.install({ time: new Date('2026-09-26T08:30:00+02:00') });
await page.addInitScript((j) => {
  if (!localStorage.getItem('schlummer.state.v1')) localStorage.setItem('schlummer.state.v1', j);
}, stand);
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
await page.waitForSelector('.arc-center');

const geh = async (route) => {
  await page.tap(`[data-action="go"][data-route="${route}"]`);
  await page.waitForTimeout(320);
};
const bettzeit = async () => {
  await geh('plan');
  await page.waitForSelector('.timeline li');
  const zeilen = await page.$$eval('.timeline li', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  const nacht = zeilen.find((x) => /Nachtschlaf/.test(x));
  const m = nacht && nacht.match(/(\d{2}):(\d{2})/);
  return { text: zeilen, minuten: m ? Number(m[1]) * 60 + Number(m[2]) : null };
};

const vorher = await bettzeit();
console.log('  ohne Wunsch:', vorher.text.find((x) => /Nachtschlaf/.test(x)));
pruefe(vorher.minuten >= 19 * 60 + 30, `ohne Wunsch folgt der Plan der Gewohnheit (ist ${vorher.minuten})`);

// Jetzt den Wunsch setzen: 19:00 ins Bett, 06:30 raus.
await geh('mehr');
await page.waitForSelector('#wunsch-bett');
await page.fill('#wunsch-bett', '19:00');
await page.dispatchEvent('#wunsch-bett', 'change');
await page.waitForTimeout(300);
await page.fill('#wunsch-auf', '06:30');
await page.dispatchEvent('#wunsch-auf', 'change');
await page.waitForTimeout(400);
const hinweis = await page.evaluate(() => {
  const h = [...document.querySelectorAll('h2')].find((x) => /Wunschrhythmus/.test(x.textContent));
  return h ? h.closest('.card').innerText.replace(/\s+/g, ' ') : '';
});
console.log('  ' + hinweis.slice(0, 260));
pruefe(/Angebot von/.test(hinweis), 'die Karte rechnet das Angebot aus');

const nachher = await bettzeit();
console.log('  mit Wunsch:  ', nachher.text.find((x) => /Nachtschlaf/.test(x)));
pruefe(
  nachher.minuten !== null && Math.abs(nachher.minuten - 19 * 60) <= 30,
  `der Plan haelt sich an die Wunsch-Bettzeit (ist ${nachher.minuten})`
);

// Und der Knopf im Bewertungs-Sheet.
await geh('heute');
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('schlummer.state.v1'));
  s.sleeps.push({ id: 'zu-bewerten', type: 'night',
    start: '2026-09-25T19:00:00+02:00', end: '2026-09-26T06:30:00+02:00',
    note: '', settle: null, mood: null, wakings: null, interruptions: [] });
  localStorage.setItem('schlummer.state.v1', JSON.stringify(s));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.arc-center');
await page.evaluate(() => {
  document.querySelector('[data-action="rate-sleep"]').click();
});
await page.waitForTimeout(350);
const offen = await page.evaluate(() => document.querySelector('dialog').open);
pruefe(offen, 'das Bewertungs-Sheet ist offen');
await page.evaluate(() => {
  document.querySelector('dialog [data-action="close-dialog"]').click();
});
await page.waitForTimeout(350);
const zu = await page.evaluate(() => !document.querySelector('dialog').open);
console.log('  Sheet nach dem Tippen auf den Knopf:', zu ? 'zu' : 'OFFEN');
pruefe(zu, 'der Knopf schliesst das Sheet');

await page.screenshot({ path: join(BILDER, 'shot-wunsch.png'), fullPage: true });
await browser.close();
console.log(fehler ? `\n${fehler} Abweichung(en)` : '\nAlles wie erwartet');
process.exit(fehler ? 1 : 0);

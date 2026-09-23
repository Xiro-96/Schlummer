// Der Fall aus dem Screenshot: ein Nickerchen, das vor zwei Tagen gestartet
// und nie beendet wurde. Die App zeigte "Schläft seit 48h".
// Dazu: im Krank-Modus wird gar nicht mehr zum Tracken aufgefordert.
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bilder liegen neben den Pruefungen - praktisch beim Nachsehen, wenn eine
// Pruefung meckert. Sie gehoeren nicht ins Repo (siehe .gitignore).
const BILDER = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(BILDER, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox']
});
let fehler = 0;
const pruefe = (b, t) => { if (!b) { fehler++; console.log('  NICHT ERFUELLT: ' + t); } };

const JETZT = '2026-09-18T11:45:00+02:00';

function stand({ krank = [], sleeps = [] } = {}) {
  return JSON.stringify({
    version: 1,
    child: { name: 'Lia', birthDate: '2025-06-10', dueDate: '' },
    settings: { morningWake: '05:50', soundTimerMin: 45, soundVolume: 0.6, lastSound: 'heartbeat',
      learning: true, napCount: 'auto', ratePrompt: true, reminders: false, onboarded: true },
    sleeps, events: [], notes: [], sickDays: krank
  });
}

async function lauf(name, daten, pruefung) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { fehler++; console.log('  pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { fehler++; console.log('  console: ' + m.text()); } });
  await page.clock.install({ time: new Date(JETZT) });
  await page.addInitScript((j) => localStorage.setItem('schlummer.state.v1', j), daten);
  await page.goto('http://127.0.0.1:8145/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.arc-center');
  const bogen = await page.$eval('.arc-center', (e) => e.textContent.replace(/\s+/g, ' ').trim());
  const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  console.log(`\n### ${name}\n  Bogen: ${bogen}`);
  await pruefung({ page, bogen, text });
  await page.screenshot({ path: `${BILDER}/shot-${name}.png`, fullPage: true });
  await ctx.close();
}

// Ein Nickerchen, das vor 48 Stunden gestartet wurde
const haenger = [{ id: 'fest', type: 'nap', start: '2026-09-16T09:44:00.000Z', end: null,
  note: '', settle: null, mood: null, wakings: null, interruptions: [] }];

await lauf('haenger', stand({ krank: ['2026-09-18'], sleeps: haenger }), async ({ page, bogen, text }) => {
  pruefe(!/Schläft seit/.test(bogen), 'kein "Schläft seit"');
  pruefe(/Eintrag ohne Ende/.test(bogen), 'Bogen nennt den hängenden Eintrag');
  pruefe(/So lange kann das nicht gewesen sein/.test(text), 'Karte erklärt das Problem');
  const knopf = await page.$eval('[data-action="fix-stuck"]', (e) => e.textContent.trim());
  console.log('  Vorschlag:', knopf);
  await page.screenshot({ path: `${BILDER}/shot-haenger-vorher.png`, fullPage: true });
  pruefe(/^Auf Mi\., 16\.09\. \d{2}:\d{2} beenden$/.test(knopf), 'Beenden-Knopf nennt Tag und Zeit');
  pruefe(!/Schläft gerade/.test(text), 'keine Laufend-Karte mit 48 Std');
  pruefe(!/Aufgewacht/.test(text), 'kein Aufgewacht-Knopf, der die 48 Std festschreibt');
  pruefe(/seit Mi\., 16\.09\./.test(bogen), 'Bogen nennt den Tag des Eintrags');

  // Ein Tipp zieht den Eintrag gerade
  await page.tap('[data-action="fix-stuck"]');
  await page.waitForTimeout(400);
  const danach = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  pruefe(!/Eintrag ohne Ende/.test(danach), 'nach dem Tipp ist der Hinweis weg');
  const offen = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('schlummer.state.v1')).sleeps.filter((s) => !s.end).length);
  pruefe(offen === 0, 'kein offener Eintrag mehr');
});

// Krank und nichts läuft: kein Tracken-Angebot
await lauf('krank-ohne-tracken', stand({ krank: ['2026-09-18'] }), async ({ bogen, text, page }) => {
  pruefe(/Kranker Tag/.test(bogen), 'ruhige Bogenmitte');
  pruefe(!/trotzdem eintragen/.test(text), 'kein Tracken-Angebot');
  pruefe(!/Nickerchen startet|Nacht startet/.test(text), 'keine Startknöpfe');
  pruefe(/Schlaf mitschreiben aus/.test(text), 'Karte nennt das Mitschreiben als aus');
  pruefe(!/Tippe im Bogen/.test(text), 'kein Bedien-Hinweis ohne Symbole');
  pruefe(/Plan → Schlaf nachtragen/.test(text), 'Karte zeigt den Weg zum Nachtragen');
});

// Gesund: alles wie gewohnt
await lauf('gesund', stand(), async ({ text }) => {
  pruefe(/Nickerchen startet/.test(text), 'Startknöpfe sind da');
  pruefe(/Kind ist krank/.test(text), 'Krank-Schalter ist da');
});

await browser.close();
console.log(fehler ? `\n${fehler} Abweichung(en)` : '\nAlles wie erwartet');
process.exit(fehler ? 1 : 0);

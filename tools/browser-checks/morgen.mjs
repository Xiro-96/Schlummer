// Nach Tagen ohne Eintrag: die App nimmt die gelebte Aufstehzeit, nicht die
// Zahl aus den Einstellungen - und sagt, dass sie geschaetzt ist.
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

// Alles in Ortszeit (Berlin ist im September +02:00).
const bz = (tag, h, m) => `2026-09-${String(tag).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+02:00`;

const sleeps = [];
for (const [tag, h, m] of [[13, 6, 40], [14, 6, 50], [15, 6, 45], [16, 6, 45], [17, 6, 45]]) {
  sleeps.push({ id: `n${tag}`, type: 'night', start: bz(tag - 1, 19, 10), end: bz(tag, h, m),
    note: '', settle: null, mood: null, wakings: null, interruptions: [] });
  sleeps.push({ id: `p${tag}`, type: 'nap', start: bz(tag, 11, 30), end: bz(tag, 13, 20),
    note: '', settle: 'fast', mood: 'happy', wakings: null, interruptions: [] });
}

async function lauf(name, krank, pruefung) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { fehler++; console.log('  pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { fehler++; console.log('  console: ' + m.text()); } });
  await page.clock.install({ time: new Date('2026-09-20T09:00:00+02:00') });
  await page.addInitScript((j) => localStorage.setItem('schlummer.state.v1', j), JSON.stringify({
    version: 1,
    child: { name: 'Lia', birthDate: '2025-06-10', dueDate: '' },
    settings: { morningWake: '05:50', soundTimerMin: 45, soundVolume: 0.6, lastSound: 'heartbeat',
      learning: true, napCount: 'auto', ratePrompt: true, reminders: false, onboarded: true },
    sleeps, events: [], notes: [], sickDays: krank
  }));
  await page.goto('http://127.0.0.1:8145/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.arc-center');
  await page.tap('[data-action="go"][data-route="plan"]');
  await page.waitForSelector('#morning');
  const zeit = await page.inputValue('#morning');
  const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  console.log(`\n### ${name}\n  Aufgewacht am Morgen: ${zeit}`);
  await pruefung({ zeit, text });
  await ctx.close();
}

// Der 20.09. hat keine Nacht: die App nimmt 06:45 statt der eingestellten 05:50
await lauf('geschaetzt', [], ({ zeit, text }) => {
  pruefe(zeit === '06:45', `übliche Aufstehzeit statt Einstellung (ist ${zeit})`);
  pruefe(/keine Nacht erfasst/.test(text), 'Hinweis, dass die Zeit geschätzt ist');
  pruefe(/Lia sonst aufsteht/.test(text), 'Hinweis nennt das Kind');
});

// Sind fast alle Naechte als krank markiert, bleibt zu wenig uebrig - dann
// eben die Einstellung. Das beweist, dass die Markierung wirklich filtert.
await lauf('krank-filtert', ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16'], ({ zeit, text }) => {
  pruefe(zeit === '05:50', `zu wenig gesunde Nächte -> Einstellung (ist ${zeit})`);
  pruefe(/keine Nacht erfasst/.test(text), 'Hinweis bleibt');
});

// Ist die Nacht erfasst, zaehlt sie - ohne Hinweis.
{
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { fehler++; console.log('  pageerror: ' + e.message); });
  await page.clock.install({ time: new Date('2026-09-17T09:00:00+02:00') });
  await page.addInitScript((j) => localStorage.setItem('schlummer.state.v1', j), JSON.stringify({
    version: 1, child: { name: 'Lia', birthDate: '2025-06-10', dueDate: '' },
    settings: { morningWake: '05:50', learning: true, napCount: 'auto', onboarded: true,
      soundTimerMin: 45, soundVolume: 0.6, lastSound: 'heartbeat', ratePrompt: true, reminders: false },
    sleeps, events: [], notes: [], sickDays: []
  }));
  await page.goto('http://127.0.0.1:8145/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.arc-center');
  await page.tap('[data-action="go"][data-route="plan"]');
  await page.waitForSelector('#morning');
  const zeit = await page.inputValue('#morning');
  const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  console.log(`\n### erfasst\n  Aufgewacht am Morgen: ${zeit}`);
  pruefe(zeit === '06:45', `die erfasste Nacht zaehlt (ist ${zeit})`);
  pruefe(!/keine Nacht erfasst/.test(text), 'kein Hinweis, wenn die Nacht erfasst ist');
  await ctx.close();
}

await browser.close();
console.log(fehler ? `\n${fehler} Abweichung(en)` : '\nAlles wie erwartet');
process.exit(fehler ? 1 : 0);

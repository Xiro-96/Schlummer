import { test } from 'node:test';
import assert from 'node:assert/strict';

// Der Speicher liest und schreibt localStorage - im Test ein kleines Stück
// Ersatz, damit die Krank-Logik ohne Browser prüfbar ist.
const speicher = new Map();
globalThis.localStorage = {
  getItem: (k) => (speicher.has(k) ? speicher.get(k) : null),
  setItem: (k, v) => speicher.set(k, String(v)),
  removeItem: (k) => speicher.delete(k)
};

const store = await import('../js/store.js');

const iso = (jahr, monat, tag, h = 12, m = 0) => new Date(jahr, monat - 1, tag, h, m).toISOString();

function frischerStand(sleeps = [], sickDays = []) {
  speicher.set(
    'schlummer.state.v1',
    JSON.stringify({ version: 1, child: {}, settings: {}, sleeps, events: [], notes: [], sickDays })
  );
  store.resetAll();
  store.importJSON(
    JSON.stringify({ version: 1, child: {}, settings: {}, sleeps, events: [], notes: [], sickDays })
  );
}

test('Tagesschlüssel folgt der Ortszeit, nicht UTC', () => {
  // 23:30 Ortszeit gehört zum laufenden Tag, auch wenn UTC schon weiter ist.
  assert.equal(store.dayKeyOf(new Date(2026, 8, 16, 23, 30)), '2026-09-16');
  assert.equal(store.dayKeyOf(new Date(2026, 0, 5, 0, 15)), '2026-01-05');
});

test('Krank-Markierung lässt sich setzen und wieder entfernen', () => {
  frischerStand();
  const tag = new Date(2026, 8, 16, 10, 0);
  assert.equal(store.isSickDay(tag), false);
  assert.equal(store.toggleSickDay(tag), true);
  assert.equal(store.isSickDay(tag), true);
  assert.equal(store.toggleSickDay(tag), false);
  assert.equal(store.isSickDay(tag), false);
});

test('Kranke Tage fallen aus dem Lernen, bleiben aber im Protokoll', () => {
  const sleeps = [
    { id: 'a', type: 'nap', start: iso(2026, 9, 15, 11), end: iso(2026, 9, 15, 13) },
    { id: 'b', type: 'night', start: iso(2026, 9, 15, 19), end: iso(2026, 9, 16, 6) },
    { id: 'c', type: 'nap', start: iso(2026, 9, 16, 11), end: iso(2026, 9, 16, 12) }
  ];
  frischerStand(sleeps, ['2026-09-15']);

  // Im Protokoll ist alles da ...
  assert.equal(store.allSleeps().length, 3);
  // ... fürs Lernen bleibt nur der gesunde Tag. Die Nacht gehört zum Abend,
  // an dem sie beginnt - sie fällt also mit raus.
  assert.deepEqual(store.learningSleeps().map((s) => s.id), ['c']);
});

test('Ohne kranke Tage ist nichts gefiltert', () => {
  const sleeps = [{ id: 'a', type: 'nap', start: iso(2026, 9, 16, 11), end: iso(2026, 9, 16, 12) }];
  frischerStand(sleeps);
  assert.equal(store.learningSleeps().length, store.allSleeps().length);
});

test('Kranke Tage werden nur im gefragten Zeitraum gezählt', () => {
  const jetzt = new Date(2026, 8, 16, 10, 0);
  frischerStand([], ['2026-09-15', '2026-09-10', '2026-07-01']);
  assert.equal(store.sickDayCount(28, jetzt), 2); // der Juli-Tag ist zu alt
  assert.equal(store.sickDayCount(3, jetzt), 1);
});

test('Krank-Markierungen wandern durch Export und Import', () => {
  frischerStand([], ['2026-09-15']);
  const datei = store.exportJSON('3.8');
  assert.match(datei, /"2026-09-15"/);
  frischerStand();
  assert.equal(store.isSickDay(new Date(2026, 8, 15)), false);
  store.importJSON(datei);
  assert.equal(store.isSickDay(new Date(2026, 8, 15)), true);
});

test('Eine Datei ohne Krank-Feld lädt trotzdem', () => {
  store.importJSON(JSON.stringify({ version: 1, sleeps: [], settings: {}, child: {} }));
  assert.deepEqual(store.getState().sickDays, []);
  assert.equal(store.isSickDay(new Date()), false);
});

/* ------------------------------------------------ Übliche Aufstehzeit */

const nacht = (tag, endStunde, endMinute = 0) => ({
  id: `n${tag}`,
  type: 'night',
  start: new Date(2026, 8, tag - 1, 19, 0).toISOString(),
  end: new Date(2026, 8, tag, endStunde, endMinute).toISOString()
});

function mitNaechten(sleeps, sickDays = []) {
  store.importJSON(
    JSON.stringify({
      version: 1,
      child: {},
      settings: { morningWake: '05:50' },
      sleeps,
      events: [],
      notes: [],
      sickDays
    })
  );
}

test('Ohne erfasste Nacht zählt die gelebte Aufstehzeit, nicht die Einstellung', () => {
  // Einstellung sagt 05:50, tatsächlich steht das Kind gegen 06:45 auf.
  mitNaechten([nacht(14, 6, 40), nacht(15, 6, 50), nacht(16, 6, 45), nacht(17, 6, 45)]);

  assert.equal(store.usualMorningMinutes(new Date(2026, 8, 20)), 6 * 60 + 45);
  const morgen = store.morningWakeFor(new Date(2026, 8, 20, 9, 0));
  assert.equal(morgen.getHours(), 6);
  assert.equal(morgen.getMinutes(), 45);
});

test('Eine erfasste Nacht schlägt jede Schätzung', () => {
  mitNaechten([nacht(14, 6, 40), nacht(15, 6, 50), nacht(16, 6, 45), nacht(17, 7, 20)]);

  const morgen = store.morningWakeFor(new Date(2026, 8, 17, 9, 0));
  assert.equal(morgen.getHours(), 7);
  assert.equal(morgen.getMinutes(), 20);
});

test('Kranke Nächte verschieben die übliche Aufstehzeit nicht', () => {
  // Am 16. und 17. krank und lange geschlafen - das darf nicht zählen.
  // Die Nacht gehört zum Abend davor, also sind der 15. und 16. markiert.
  mitNaechten(
    [nacht(14, 6, 40), nacht(15, 6, 50), nacht(16, 9, 0), nacht(17, 9, 30)],
    ['2026-09-15', '2026-09-16']
  );

  // Nur der 14. und 15. bleiben: 06:40 und 06:50 -> 06:45.
  assert.equal(store.usualMorningMinutes(new Date(2026, 8, 20), { minTage: 2 }), 6 * 60 + 45);
});

test('Zu wenige Nächte: dann eben die Einstellung', () => {
  mitNaechten([nacht(16, 6, 40)]);

  assert.equal(store.usualMorningMinutes(new Date(2026, 8, 20)), null);
  const morgen = store.morningWakeFor(new Date(2026, 8, 20, 9, 0));
  assert.equal(morgen.getHours(), 5);
  assert.equal(morgen.getMinutes(), 50);
});

/* ------------------------------------- Aufstehzeit von Hand setzen */

test('Eine von Hand gesetzte Aufstehzeit schlägt die Schätzung', () => {
  // Gewohnheit liegt bei 06:45, für den 20. ist nichts erfasst.
  mitNaechten([nacht(14, 6, 40), nacht(15, 6, 50), nacht(16, 6, 45), nacht(17, 6, 45)]);
  const tag = new Date(2026, 8, 20, 9, 0);
  assert.equal(store.morningWakeFor(tag).getHours(), 6);

  store.setMorningOverride(tag, '05:50');
  const gesetzt = store.morningWakeFor(tag);
  assert.equal(gesetzt.getHours(), 5);
  assert.equal(gesetzt.getMinutes(), 50);
  assert.equal(store.morningOverrideFor(tag), '05:50');

  // Nur für diesen Tag - der Nachbartag bleibt bei der Gewohnheit.
  assert.equal(store.morningWakeFor(new Date(2026, 8, 19, 9, 0)).getHours(), 6);

  // Und sie lässt sich wieder entfernen.
  store.setMorningOverride(tag, null);
  assert.equal(store.morningOverrideFor(tag), null);
  assert.equal(store.morningWakeFor(tag).getHours(), 6);
});

test('Eine erfasste Nacht schlägt auch die Handeingabe', () => {
  mitNaechten([nacht(14, 6, 40), nacht(15, 6, 50), nacht(16, 6, 45), nacht(17, 7, 20)]);
  const tag = new Date(2026, 8, 17, 9, 0);
  store.setMorningOverride(tag, '05:50');
  // Gemessen schlägt gesetzt: die Nacht endet um 07:20.
  assert.equal(store.morningWakeFor(tag).getHours(), 7);
  assert.equal(store.morningWakeFor(tag).getMinutes(), 20);
});

test('Gesetzte Aufstehzeiten wandern durch Export und Import', () => {
  mitNaechten([]);
  store.setMorningOverride(new Date(2026, 9, 1), '05:50');
  const datei = store.exportJSON('4.4');
  assert.match(datei, /"2026-10-01": ?"05:50"/);

  mitNaechten([]);
  assert.equal(store.morningOverrideFor(new Date(2026, 9, 1)), null);
  store.importJSON(datei);
  assert.equal(store.morningOverrideFor(new Date(2026, 9, 1)), '05:50');
});

test('Eine Datei ohne das Feld lädt weiterhin', () => {
  store.importJSON(JSON.stringify({ version: 1, sleeps: [], settings: {}, child: {} }));
  assert.deepEqual(store.getState().morningOverrides, {});
  assert.equal(store.morningOverrideFor(new Date()), null);
});

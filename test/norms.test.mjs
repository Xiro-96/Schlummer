import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NIGHT_NORMS } from '../js/data.js';
import {
  averageWakings,
  clinicHintsFor,
  compareWakings,
  nearestWakingNorm,
  nightWakingReport,
  wakingCount
} from '../js/norms.js';

const NOW = new Date(2024, 4, 20, 9, 0, 0, 0);
const nightsAgo = (d, wakings) => ({
  id: `n${d}`,
  type: 'night',
  start: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - d - 1, 19, 30),
  end: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - d, 6, 45),
  wakings
});

test('Normwerte tragen ihre Quelle', () => {
  assert.ok(NIGHT_NORMS.source.includes('Paavonen'));
  assert.ok(NIGHT_NORMS.wakings.length >= 3);
  for (const n of NIGHT_NORMS.wakings) {
    assert.ok(n.months > 0 && n.mean > 0);
  }
});

test('Nächstgelegener Ankerwert - ohne Interpolation', () => {
  assert.equal(nearestWakingNorm(30 * 6).months, 6);
  assert.equal(nearestWakingNorm(30 * 8).months, 8);
  assert.equal(nearestWakingNorm(30 * 11).months, 12);
  // Weit außerhalb: nächster Anker, aber ausdrücklich als ungenau markiert
  const far = nearestWakingNorm(30 * 24);
  assert.equal(far.months, 12);
  assert.equal(far.exact, false);
  assert.equal(nearestWakingNorm(30 * 6).exact, true);
});

test('Eigener Schnitt zählt nur erfasste Nächte', () => {
  const sleeps = [nightsAgo(1, 2), nightsAgo(2, 3), nightsAgo(3, null), nightsAgo(4, 1)];
  const avg = averageWakings(sleeps, { now: NOW });
  assert.equal(avg.nights, 3);
  assert.equal(avg.mean, 2);
  assert.deepEqual(averageWakings([], { now: NOW }), { nights: 0, mean: null });
});

test('Alte Nächte fallen aus dem Fenster', () => {
  const sleeps = [nightsAgo(1, 4), nightsAgo(30, 0)];
  assert.equal(averageWakings(sleeps, { nights: 14, now: NOW }).nights, 1);
});

test('Einordnung: typisch, mehr, weniger', () => {
  const age = 30 * 6; // Normwert 2,5
  const typisch = compareWakings(age, { mean: 2.4, nights: 7 });
  assert.equal(typisch.status, 'typisch');
  assert.match(typisch.text, /2,5/);
  assert.equal(compareWakings(age, { mean: 4, nights: 7 }).status, 'mehr');
  assert.equal(compareWakings(age, { mean: 1, nights: 7 }).status, 'weniger');
  assert.equal(compareWakings(age, { mean: null, nights: 0 }), null);
});

test('Einordnung benennt, wenn der Vergleichswert nicht zum Alter passt', () => {
  const alt = compareWakings(30 * 24, { mean: 2, nights: 7 });
  assert.match(alt.text, /nächstgelegener belegter Wert/);
});

test('Hinweise der Studienautoren passen zum Alter', () => {
  const sechs = clinicHintsFor(30 * 6).map((h) => h.text).join(' ');
  assert.match(sechs, /dreimal oder öfter/);
  assert.equal(clinicHintsFor(30 * 6).every((h) => Math.abs(h.months - 6) <= 2), true);
  assert.equal(clinicHintsFor(30 * 40).length, 0, 'für Kleinkinder gibt es keine Anker');
});

test('Erfasste Wachphasen zählen vor der Bewertungsangabe', () => {
  const nacht = (id, d, gaps, wakings = null) => ({
    id,
    type: 'night',
    start: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - d - 1, 19, 0),
    end: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - d, 6, 30),
    wakings,
    interruptions: gaps
  });
  // Zwei erfasste Wachphasen schlagen die Angabe "1"
  const mitPhasen = nacht('a', 1, [{ start: 1, end: 2 }, { start: 3, end: 4 }], '1');
  assert.equal(wakingCount(mitPhasen), 2);
  // Ohne Phasen zählt die Bewertung
  assert.equal(wakingCount(nacht('b', 2, [], '3')), 3);
  // Ohne beides zählt die Nacht nicht mit
  assert.equal(wakingCount(nacht('c', 3, [])), null);

  const schnitt = averageWakings([mitPhasen, nacht('b', 2, [], '3'), nacht('c', 3, [])], { now: NOW });
  assert.equal(schnitt.nights, 2, 'nur Nächte mit Angabe');
  assert.equal(schnitt.mean, 2.5);
});

test('Wachphasen der letzten Nächte werden zusammengefasst', () => {
  const T = (tag, h, m) => new Date(2026, 7, tag, h, m, 0, 0);
  const sleeps = [
    {
      id: 'n1', type: 'night', start: T(25, 19, 50), end: T(26, 6, 47),
      interruptions: [
        { start: T(25, 22, 30), end: T(25, 23, 10) },
        { start: T(26, 2, 48), end: T(26, 5, 0) }
      ]
    },
    { id: 'n2', type: 'night', start: T(26, 19, 0), end: T(27, 6, 30), interruptions: [] },
    {
      id: 'n3', type: 'night', start: T(27, 19, 40), end: T(28, 6, 43),
      interruptions: [{ start: T(27, 22, 17), end: T(27, 22, 47) }]
    },
    // Ein Nickerchen zählt hier nicht mit.
    { id: 'nap', type: 'nap', start: T(27, 11, 0), end: T(27, 12, 0), interruptions: [] }
  ];
  const r = nightWakingReport(sleeps, { now: T(28, 12, 0) });

  assert.equal(r.naechte, 3);
  assert.equal(r.mitWachphasen, 2);
  assert.equal(r.minutenGesamt, 40 + 132 + 30);
  assert.equal(r.minutenSchnitt, Math.round(202 / 3));
  assert.equal(r.laengste.minuten, 132);
  assert.equal(r.haeufigsteStunde, 22, 'zweimal gegen 22 Uhr');
});

test('Ohne erfasste Wachphasen bleibt der Bericht leer, aber gueltig', () => {
  const T = (tag, h, m) => new Date(2026, 7, tag, h, m, 0, 0);
  const r = nightWakingReport(
    [{ id: 'n', type: 'night', start: T(27, 19, 0), end: T(28, 6, 30), interruptions: [] }],
    { now: T(28, 12, 0) }
  );
  assert.equal(r.naechte, 1);
  assert.equal(r.mitWachphasen, 0);
  assert.equal(r.minutenSchnitt, 0);
  assert.equal(r.laengste, null);
  assert.equal(r.haeufigsteStunde, null);
});

test('Der Bericht trennt Wachphasen nach ihrer Lage in der Nacht', () => {
  const nacht = (tag, gaps) => ({
    type: 'night',
    start: new Date(2024, 4, tag, 19, 0),
    end: new Date(2024, 4, tag + 1, 6, 0),
    interruptions: gaps
  });
  const sleeps = [
    // Zweimal gegen Morgen und lang, einmal kurz nach dem Einschlafen.
    nacht(17, [{ start: new Date(2024, 4, 18, 4, 20), end: new Date(2024, 4, 18, 5, 20) }]),
    nacht(18, [{ start: new Date(2024, 4, 19, 4, 30), end: new Date(2024, 4, 19, 6, 0) }]),
    nacht(19, [{ start: new Date(2024, 4, 19, 20, 30), end: new Date(2024, 4, 19, 20, 50) }])
  ];
  const r = nightWakingReport(sleeps, { nights: 14, now: NOW });

  assert.equal(r.naechte, 3);
  assert.equal(r.mitWachphasen, 3);
  assert.deepEqual(r.phasen.spaet, { anzahl: 2, minuten: 150 });
  assert.deepEqual(r.phasen.frueh, { anzahl: 1, minuten: 20 });
  assert.deepEqual(r.phasen.mitte, { anzahl: 0, minuten: 0 });
  assert.equal(r.schwerpunkt, 'spaet');
  assert.equal(r.laengste.lage, 'spaet');
});

test('Ohne deutlichen Schwerpunkt sagt der Bericht nichts über die Lage', () => {
  const nacht = (tag, gaps) => ({
    type: 'night',
    start: new Date(2024, 4, tag, 19, 0),
    end: new Date(2024, 4, tag + 1, 6, 0),
    interruptions: gaps
  });
  const sleeps = [
    nacht(18, [{ start: new Date(2024, 4, 18, 20, 30), end: new Date(2024, 4, 18, 21, 0) }]),
    nacht(19, [{ start: new Date(2024, 4, 20, 4, 30), end: new Date(2024, 4, 20, 5, 0) }])
  ];
  assert.equal(nightWakingReport(sleeps, { nights: 14, now: NOW }).schwerpunkt, null);
});

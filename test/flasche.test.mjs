import { test } from 'node:test';
import assert from 'node:assert/strict';

import { flaschenNaechte, flaschenReport, MIN_NAECHTE } from '../js/flasche.js';

const nacht = (tag, { ml = null, phasen = [] } = {}) => ({
  type: 'night',
  start: new Date(2024, 4, tag, 19, 30),
  end: new Date(2024, 4, tag + 1, 6, 30),
  flascheMl: ml,
  interruptions: phasen.map((p) => ({
    start: new Date(2024, 4, tag + 1, 1, 0),
    end: new Date(2024, 4, tag + 1, 1, 0 + p.min),
    flasche: p.flasche,
    windel: p.windel
  }))
});

const NOW = new Date(2024, 4, 22, 9, 0);

test('Nicht beantwortet ist nicht dasselbe wie nein', () => {
  const rows = flaschenNaechte(
    [
      nacht(1, { phasen: [{ min: 90, flasche: true, windel: true }] }),
      nacht(2, { phasen: [{ min: 90, flasche: false, windel: false }] }),
      nacht(3, { phasen: [{ min: 90 }] }),
      nacht(4)
    ],
    { now: NOW, days: 30 }
  );
  assert.equal(rows[0].flasche, true);
  assert.equal(rows[1].flasche, false);
  assert.equal(rows[2].flasche, null, 'ohne Angabe bleibt es offen');
  assert.equal(rows[3].flasche, null, 'ohne Wachphase gibt es nichts zu beantworten');
});

test('Eine Nacht gilt als Flaschennacht, sobald eine Phase sie nennt', () => {
  const n = {
    type: 'night',
    start: new Date(2024, 4, 1, 19, 30),
    end: new Date(2024, 4, 2, 6, 30),
    interruptions: [
      { start: new Date(2024, 4, 1, 21, 0), end: new Date(2024, 4, 1, 21, 20), flasche: false },
      { start: new Date(2024, 4, 2, 2, 0), end: new Date(2024, 4, 2, 3, 30), flasche: true }
    ]
  };
  const rows = flaschenNaechte([n], { now: NOW, days: 30 });
  assert.equal(rows[0].flasche, true);
  assert.equal(rows[0].lang, true);
  assert.equal(rows[0].laengste, 90);
  assert.equal(rows[0].wach, 110);
});

test('Ohne jede Angabe gibt es keinen Bericht', () => {
  const sleeps = [nacht(1, { phasen: [{ min: 90 }] }), nacht(2)];
  assert.equal(flaschenReport(sleeps, { now: NOW, days: 30 }), null);
});

test('Zu wenige Nächte: der Bericht sagt es, statt zu rechnen', () => {
  const sleeps = [
    nacht(1, { phasen: [{ min: 90, flasche: true }] }),
    nacht(2, { phasen: [{ min: 20, flasche: false }] })
  ];
  const r = flaschenReport(sleeps, { now: NOW, days: 30 });
  assert.equal(r.flasche.genug, false);
  assert.equal(r.flasche.zufall, null);
  assert.equal(r.flasche.mit.naechte, 1);
  assert.equal(r.beantwortet, 2);
});

test('Mit genug Nächten wird verglichen und die Zufallschance genannt', () => {
  // Sechs Nächte mit Flasche, alle lang; sechs ohne, alle kurz.
  const sleeps = [];
  for (let tag = 1; tag <= 6; tag++) {
    sleeps.push(nacht(tag, { phasen: [{ min: 90, flasche: true }] }));
  }
  for (let tag = 8; tag <= 13; tag++) {
    sleeps.push(nacht(tag, { phasen: [{ min: 15, flasche: false }] }));
  }
  const r = flaschenReport(sleeps, { now: NOW, days: 30 });
  assert.equal(r.flasche.genug, true);
  assert.equal(r.flasche.mit.naechte, 6);
  assert.equal(r.flasche.mit.lang, 6);
  assert.equal(r.flasche.ohne.lang, 0);
  assert.ok(r.flasche.zufall < 0.01, `p war ${r.flasche.zufall}`);
});

test('Die Abendmenge wird am Mittelwert geteilt', () => {
  const sleeps = [];
  for (let tag = 1; tag <= 5; tag++) {
    sleeps.push(nacht(tag, { ml: 300, phasen: [{ min: 90, flasche: true }] }));
  }
  for (let tag = 7; tag <= 11; tag++) {
    sleeps.push(nacht(tag, { ml: 120, phasen: [{ min: 10, flasche: false }] }));
  }
  const r = flaschenReport(sleeps, { now: NOW, days: 30 });
  assert.equal(r.mitMenge, 10);
  assert.equal(r.mengeMedian, 210);
  assert.ok(r.menge, 'die Menge wird verglichen');
  assert.equal(r.menge.grenze, 210);
  assert.equal(r.menge.mit.naechte, 5);
  assert.equal(r.menge.ohne.naechte, 5);
  assert.equal(r.menge.mit.lang, 5);
  assert.equal(r.menge.ohne.lang, 0);
});

test('Kranke Tage und Fehleinträge bleiben draußen', () => {
  const kurz = {
    type: 'night',
    start: new Date(2024, 4, 3, 0, 20),
    end: new Date(2024, 4, 3, 0, 45),
    interruptions: []
  };
  const rows = flaschenNaechte([nacht(1, { ml: 200 }), kurz], {
    now: NOW,
    days: 30,
    sickDays: ['2024-05-01']
  });
  assert.equal(rows.length, 0);
});

test('Die Schwelle ist dokumentiert und wird eingehalten', () => {
  assert.ok(MIN_NAECHTE >= 4, 'unter vier Nächten je Seite ist nichts zu holen');
});

/* ------------------------------------------------------- Mittagsschlaf */

import { nickerchenReport, KURZES_NICKERCHEN } from '../js/flasche.js';

const nickerchen = (tag, minuten, { ml = null, windel = null } = {}) => ({
  type: 'nap',
  start: new Date(2024, 4, tag, 11, 30),
  end: new Date(2024, 4, tag, 11, 30 + minuten),
  flascheMl: ml,
  windel,
  interruptions: []
});

test('Ohne jede Angabe gibt es keinen Mittagsbericht', () => {
  const r = nickerchenReport([nickerchen(1, 100), nickerchen(2, 40)], { now: NOW, days: 30 });
  assert.equal(r, null);
});

test('Null Milliliter heisst "ohne Flasche", leer heisst "nicht erfasst"', () => {
  const sleeps = [];
  for (let tag = 1; tag <= 5; tag++) sleeps.push(nickerchen(tag, 40, { ml: 200 }));
  for (let tag = 7; tag <= 11; tag++) sleeps.push(nickerchen(tag, 110, { ml: 0 }));
  // Zwei Tage ohne Angabe duerfen keine Seite auffuellen.
  sleeps.push(nickerchen(13, 30), nickerchen(14, 120));
  const r = nickerchenReport(sleeps, { now: NOW, days: 30 });

  assert.equal(r.nickerchen, 12);
  assert.equal(r.mitMenge, 10);
  assert.equal(r.flasche.mit.naechte, 5);
  assert.equal(r.flasche.ohne.naechte, 5);
  assert.equal(r.flasche.mit.lang, 5, 'alle mit Flasche waren kurz');
  assert.equal(r.flasche.ohne.lang, 0);
  assert.ok(r.flasche.zufall < 0.01, `p war ${r.flasche.zufall}`);
});

test('Die Grenze fuer ein kurzes Nickerchen ist eine Stunde', () => {
  const sleeps = [];
  for (let tag = 1; tag <= 5; tag++) {
    sleeps.push(nickerchen(tag, KURZES_NICKERCHEN - 1, { ml: 200 }));
  }
  for (let tag = 7; tag <= 11; tag++) {
    sleeps.push(nickerchen(tag, KURZES_NICKERCHEN, { ml: 0 }));
  }
  const r = nickerchenReport(sleeps, { now: NOW, days: 30 });
  assert.equal(r.flasche.mit.lang, 5);
  assert.equal(r.flasche.ohne.lang, 0);
});

test('Unterwegs eingeschlafen zaehlt auch hier nicht mit', () => {
  const unterwegs = { ...nickerchen(1, 25, { ml: 0 }), unterwegs: true };
  const r = nickerchenReport([unterwegs, nickerchen(2, 100, { ml: 0 })], { now: NOW, days: 30 });
  assert.equal(r.nickerchen, 1);
});

test('Die volle Windel wird mittags genauso verglichen', () => {
  const sleeps = [];
  for (let tag = 1; tag <= 5; tag++) sleeps.push(nickerchen(tag, 35, { windel: true }));
  for (let tag = 7; tag <= 11; tag++) sleeps.push(nickerchen(tag, 115, { windel: false }));
  const r = nickerchenReport(sleeps, { now: NOW, days: 30 });
  assert.equal(r.windel.genug, true);
  assert.equal(r.windel.mit.lang, 5);
  assert.equal(r.windel.ohne.lang, 0);
});

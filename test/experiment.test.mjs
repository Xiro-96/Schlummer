import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  experimentReport,
  fisherExact,
  naechteMitTag,
  phaseStats,
  tagGehalten
} from '../js/experiment.js';

/* ------------------------------------------------------- Exakter Test */

test('Der Zufallstest trifft bekannte Werte', () => {
  // Lehrbuchbeispiel (Fisher, "tea tasting"): 3/1 gegen 1/3.
  assert.ok(Math.abs(fisherExact(3, 1, 1, 3) - 0.4857) < 0.001, String(fisherExact(3, 1, 1, 3)));
  // Perfekte Trennung bei 4 gegen 4.
  assert.ok(Math.abs(fisherExact(4, 0, 0, 4) - 0.0286) < 0.001, String(fisherExact(4, 0, 0, 4)));
  // Gar kein Unterschied.
  assert.ok(fisherExact(2, 2, 2, 2) > 0.999, String(fisherExact(2, 2, 2, 2)));
  // Leere Tafel bricht nicht.
  assert.equal(fisherExact(0, 0, 0, 0), 1);
});

test('Sieben gegen sieben Nächte sind selten beweiskräftig', () => {
  // Von 5 auf 2 lange Wachphasen - sieht nach viel aus, ist es aber nicht.
  const p = fisherExact(2, 5, 5, 2);
  assert.ok(p > 0.2, `p war ${p}`);
});

/* --------------------------------------------------------- Rohmaterial */

const nacht = (tag, bettH, bettM, aufH, aufM, wachMin = 0) => {
  const start = new Date(2024, 4, tag, bettH, bettM);
  const end = new Date(2024, 4, tag + 1, aufH, aufM);
  const wachAb = new Date(2024, 4, tag + 1, 1, 0);
  return {
    type: 'night',
    start,
    end,
    interruptions: wachMin ? [{ start: wachAb, end: new Date(wachAb.getTime() + wachMin * 60000) }] : []
  };
};
const nap = (tag, minuten) => ({
  type: 'nap',
  start: new Date(2024, 4, tag, 12, 0),
  end: new Date(2024, 4, tag, 12, 0 + minuten),
  interruptions: []
});

test('Die Nacht gehört zum Tag, an dessen Abend sie beginnt', () => {
  const rows = naechteMitTag([nap(1, 90), nacht(1, 19, 0, 6, 30, 0)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tagschlaf, 90);
  assert.equal(rows[0].imBett, 11 * 60 + 30);
  assert.equal(rows[0].angebot, 13 * 60);
  assert.equal(rows[0].geschlafen, 13 * 60);
});

test('Kranke Tage zählen nicht mit', () => {
  const rows = naechteMitTag([nap(1, 90), nacht(1, 19, 0, 6, 30)], { sickDays: ['2024-05-01'] });
  assert.equal(rows.length, 0);
});

test('Fehleinträge fliegen raus', () => {
  // Eine "Nacht" von 25 Minuten ist ein Tippfehler, keine Nacht.
  const kurz = {
    type: 'night',
    start: new Date(2024, 4, 1, 0, 20),
    end: new Date(2024, 4, 1, 0, 45),
    interruptions: []
  };
  assert.equal(naechteMitTag([kurz]).length, 0);
});

/* ------------------------------------------------------------ Einhalten */

test('Ein Tag gilt als gehalten, wenn alle drei Vorgaben stimmen', () => {
  const rows = naechteMitTag([nap(1, 90), nacht(1, 19, 10, 6, 40)]);
  const ziel = { bettMinute: 19 * 60, aufMinute: 6 * 60 + 30, tagschlaf: 90 };
  assert.equal(tagGehalten(rows[0], ziel), true);
  // Eine Stunde zu spät ins Bett ist nicht mehr dieselbe Vorgabe.
  const spaet = naechteMitTag([nap(2, 90), nacht(2, 20, 15, 6, 40)]);
  assert.equal(tagGehalten(spaet[0], ziel), false);
  // Und zu viel Mittagsschlaf auch nicht.
  const lang = naechteMitTag([nap(3, 160), nacht(3, 19, 10, 6, 40)]);
  assert.equal(tagGehalten(lang[0], ziel), false);
});

/* ------------------------------------------------------------ Bericht */

function bauen() {
  // Zwei Wochen "vorher" mit spaeten Zeiten und vielen langen Wachphasen,
  // danach eine Woche nach Vorgabe und fast ruhig.
  const sleeps = [];
  for (let tag = 1; tag <= 14; tag++) {
    sleeps.push(nap(tag, 130));
    sleeps.push(nacht(tag, 19, 45, 7, 30, tag % 2 === 0 ? 90 : 0));
  }
  for (let tag = 15; tag <= 21; tag++) {
    sleeps.push(nap(tag, 90));
    sleeps.push(nacht(tag, 19, 0, 6, 30, tag === 17 ? 70 : 0));
  }
  return sleeps;
}

test('Der Bericht vergleicht beide Phasen und sagt, wie sicher das ist', () => {
  const b = experimentReport(
    bauen(),
    {
      start: new Date(2024, 4, 15).toISOString(),
      tage: 7,
      ziel: { bettMinute: 19 * 60, aufMinute: 6 * 60 + 30, tagschlaf: 90 }
    },
    { now: new Date(2024, 4, 22, 9, 0) }
  );

  assert.equal(b.waehrend.naechte, 7);
  assert.equal(b.vorher.naechte, 14);
  assert.equal(b.waehrend.lang, 1);
  assert.equal(b.vorher.lang, 7);
  assert.equal(b.gehalten.tage, 7);
  assert.equal(b.gehalten.von, 7);
  assert.equal(b.genug, true);
  // 1 von 7 gegen 7 von 14 - das ist ein Unterschied, aber kein Beweis.
  assert.ok(b.zufall > 0.02 && b.zufall < 0.3, `p war ${b.zufall}`);
  assert.equal(b.waehrend.angebotMedian, 13 * 60);
  assert.equal(b.laeuft, false);
});

test('Zu wenige Nächte: der Bericht sagt es, statt zu rechnen', () => {
  const sleeps = [nap(15, 90), nacht(15, 19, 0, 6, 30)];
  const b = experimentReport(
    sleeps,
    { start: new Date(2024, 4, 15).toISOString(), tage: 7, ziel: null },
    { now: new Date(2024, 4, 16, 9, 0) }
  );
  assert.equal(b.genug, false);
  assert.equal(b.zufall, null);
  assert.equal(b.waehrend.naechte, 1);
});

test('Ein laufendes Experiment weiß, der wievielte Tag es ist', () => {
  const b = experimentReport(
    bauen(),
    { start: new Date(2024, 4, 15).toISOString(), tage: 7, ziel: null },
    { now: new Date(2024, 4, 17, 18, 0) }
  );
  assert.equal(b.laeuft, true);
  assert.equal(b.tagNummer, 3);
});

test('Ohne Einträge bleibt die Auswertung leer statt falsch', () => {
  const b = experimentReport([], { start: new Date(2024, 4, 15).toISOString(), tage: 7 }, {
    now: new Date(2024, 4, 22)
  });
  assert.equal(b.waehrend.naechte, 0);
  assert.equal(b.genug, false);
  assert.equal(phaseStats([]).wachMedian, null);
});

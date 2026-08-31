import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addMinutes, bandForAge, fmtTime, minutesBetween } from '../js/schedule.js';
import { bandForNapCount, learnProfile } from '../js/learning.js';
import { clockArc, explainNextSleep, shortFormula, sleepWindow } from '../js/explain.js';

const at = (h, m = 0, day = 20) => new Date(2024, 4, day, h, m, 0, 0);
const band12 = bandForAge(430); // 12-15 Monate
const leer = { active: false, confidence: 0, samples: { windows: 0 }, values: {}, calibration: { nap: { minutes: 0 }, evening: { minutes: 0 } } };

test('Zeitfenster liegt symmetrisch um die Zielzeit', () => {
  const w = sleepWindow(at(11, 7), 277);
  assert.equal(w.spread, 28);
  assert.equal(fmtTime(w.start), '10:39');
  assert.equal(fmtTime(w.end), '11:35');
  // Grenzen: kurze Wachfenster bekommen mindestens 10 Minuten Spanne
  assert.equal(sleepWindow(at(9), 45).spread, 10);
  assert.equal(sleepWindow(at(9), 600).spread, 45, 'nach oben auf 45 begrenzt');
});

test('Gemessene Schwankung weitet das Fenster, engt es aber nie ein', () => {
  // Schwankt das Kind stark, wird das Fenster breiter statt scheingenau.
  assert.equal(sleepWindow(at(11), 200, 38).spread, 38);
  // Eine kleine gemessene Streuung macht das Fenster nicht enger als die
  // Grundunsicherheit der Rechnung.
  assert.equal(sleepWindow(at(11), 200, 5).spread, 20);
  // Auch die Messung bleibt gedeckelt.
  assert.equal(sleepWindow(at(11), 200, 90).spread, 45);
});

test('Herleitung nennt Alter, Richtwert, Wachfenster und Startzeit', () => {
  const einNap = bandForNapCount(band12, 1);
  const e = explainNextSleep({
    band: einNap,
    baseBand: band12,
    profile: leer,
    ageLabel: '14 Monate, 1 Woche',
    lastWake: at(6, 30),
    napsDone: 0,
    napSetting: 1
  });
  const labels = e.steps.map((s) => s.label);
  assert.ok(labels.some((l) => l === 'Alter'));
  assert.ok(labels.some((l) => l.startsWith('Richtwert')));
  assert.ok(labels.some((l) => l.includes('Heute 1 Nickerchen')), 'Tagesform fehlt');
  assert.ok(labels.some((l) => l.startsWith('Wachfenster Nummer')));
  assert.ok(labels.some((l) => l === 'Aufgewacht'));
  // 06:30 plus erstes Wachfenster
  assert.equal(minutesBetween(at(6, 30), e.target), einNap.wakeWindowMin);
  assert.equal(e.isNight, false);
  assert.equal(e.totalWindows, 2);
});

test('Nach dem letzten Nickerchen wird die Nacht erklärt', () => {
  const einNap = bandForNapCount(band12, 1);
  const e = explainNextSleep({
    band: einNap,
    baseBand: band12,
    profile: leer,
    ageLabel: '14 Monate',
    lastWake: at(12, 28),
    napsDone: 1
  });
  assert.equal(e.isNight, true);
  assert.ok(e.steps.some((s) => s.label.includes('vor der Nacht')));
  assert.equal(minutesBetween(at(12, 28), e.target), einNap.wakeWindowMax);
});

test('Gelerntes und Bewertungen tauchen in der Herleitung auf', () => {
  const profile = {
    active: true,
    confidence: 0.62,
    samples: { windows: 14 },
    values: {},
    calibration: { nap: { minutes: 9, samples: 12 }, evening: { minutes: 0 } }
  };
  const band = { ...band12, personalized: true };
  const e = explainNextSleep({
    band,
    baseBand: band12,
    profile,
    ageLabel: '14 Monate',
    lastWake: at(6, 30),
    napsDone: 0
  });
  const text = e.steps.map((s) => `${s.label} ${s.value} ${s.note || ''}`).join(' | ');
  assert.match(text, /gelernt/i);
  assert.match(text, /62 %/);
  assert.match(text, /\+9 Min/);
});

test('Ohne eigene Daten bleibt die Herleitung kurz und ohne Lernschritt', () => {
  const e = explainNextSleep({
    band: band12,
    baseBand: band12,
    profile: leer,
    ageLabel: '14 Monate',
    lastWake: at(6, 30)
  });
  const text = e.steps.map((s) => s.label).join(' ');
  assert.ok(!/gelernt/i.test(text));
  assert.equal(e.steps.length, 4);
});

test('Weicht der Plan von der Rechnung ab, wird das ausgewiesen', () => {
  const einNap = bandForNapCount(band12, 1);
  const e = explainNextSleep({
    band: einNap,
    baseBand: band12,
    profile: leer,
    ageLabel: '14 Monate',
    lastWake: at(12, 28),
    napsDone: 1,
    planned: at(18, 30),
    isNight: true
  });
  const clamp = e.steps.find((s) => s.label.includes('Abendfenster'));
  assert.ok(clamp, 'Begrenzung fehlt in der Herleitung');
  assert.equal(clamp.value, '18:30');
  assert.match(clamp.note, /Rechnung ergibt|ohne Nickerchen/);
  // Ergebnis ist die Zeit aus dem Plan, nicht die rohe Rechnung
  assert.equal(fmtTime(e.target), '18:30');
});

test('Stimmen Rechnung und Plan überein, gibt es keinen Zusatzschritt', () => {
  const einNap = bandForNapCount(band12, 1);
  const e = explainNextSleep({
    band: einNap,
    baseBand: band12,
    profile: leer,
    ageLabel: '14 Monate',
    lastWake: at(6, 30),
    napsDone: 0,
    // 06:30 + das erste Wachfenster eines Ein-Nickerchen-Tages
    planned: addMinutes(at(6, 30), einNap.wakeWindowMin)
  });
  assert.ok(!e.steps.some((s) => s.label.includes('Abendfenster')));
});

test('Kurzformel ist als Zeile lesbar', () => {
  assert.equal(shortFormula(at(6, 30), 277), '06:30 + 4 Std 37 Min Wachfenster');
});

test('Uhr-Bögen rechnen Zeiten in Grad um', () => {
  const dayStart = at(0, 0);
  assert.deepEqual(clockArc(at(0), at(6), dayStart), { from: 0, to: 90 });
  assert.deepEqual(clockArc(at(12), at(18), dayStart), { from: 180, to: 270 });
  // Nacht über Mitternacht wird am Tagesrand abgeschnitten
  const nacht = clockArc(at(19, 30), at(6, 30, 21), dayStart);
  assert.equal(Math.round(nacht.to), 360);
  assert.equal(clockArc(at(5), at(4), dayStart), null, 'Ende vor Beginn');
});

test('Vor der Nacht gilt das letzte Wachfenster, auch nach ausgefallenem Nickerchen', () => {
  const einNap = bandForNapCount(band12, 1);
  const e = explainNextSleep({
    band: einNap,
    baseBand: band12,
    profile: leer,
    ageLabel: '14 Monate',
    lastWake: at(6, 30),
    napsDone: 0,
    planned: at(19, 30),
    isNight: true
  });
  assert.equal(e.windowMinutes, einNap.wakeWindowMax, 'nicht das letzte Fenster benutzt');
  assert.equal(e.skippedNap, true);
  assert.equal(e.clamped, true);
  const clamp = e.steps.find((s) => s.label.includes('Abendfenster'));
  assert.match(clamp.note, /ohne Nickerchen/);
});

test('Der Schlafdruck taucht in der Herleitung auf und verschiebt die Zeit', () => {
  const einNap = bandForNapCount(band12, 1);
  const ohne = explainNextSleep({
    band: einNap,
    baseBand: band12,
    profile: leer,
    ageLabel: '14 Monate',
    lastWake: at(12, 31),
    napsDone: 1,
    isNight: true
  });
  const mit = explainNextSleep({
    band: einNap,
    baseBand: band12,
    profile: leer,
    ageLabel: '14 Monate',
    lastWake: at(12, 31),
    napsDone: 1,
    isNight: true,
    pressure: { minutes: -23, deficit: 70 }
  });
  const schritt = mit.steps.find((s) => s.label === 'Schlaf bisher');
  assert.ok(schritt, 'Schritt fehlt');
  assert.equal(schritt.value, '-23 Min');
  assert.match(schritt.note, /weniger Tagschlaf/);
  assert.equal(minutesBetween(mit.computed, ohne.computed), 23, 'Zeit nicht verschoben');
  assert.ok(!ohne.steps.some((s) => s.label === 'Schlaf des Tages'));
});

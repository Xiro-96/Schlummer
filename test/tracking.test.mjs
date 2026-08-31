import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  describeEvent,
  eventsForDay,
  lastEvent,
  mergeTimeline,
  summarizeDay
} from '../js/tracking.js';

const at = (h, m = 0, day = 15) => new Date(2024, 4, day, h, m, 0, 0);

const events = [
  { id: 'e1', type: 'feed', kind: 'breast', side: 'left', minutes: 15, at: at(6, 30) },
  { id: 'e2', type: 'diaper', kind: 'wet', at: at(6, 45) },
  { id: 'e3', type: 'feed', kind: 'bottle', amountMl: 120, at: at(10, 0) },
  { id: 'e4', type: 'diaper', kind: 'both', at: at(10, 15) },
  { id: 'e5', type: 'feed', kind: 'solid', at: at(12, 30) },
  { id: 'e6', type: 'feed', kind: 'bottle', amountMl: 150, at: at(17, 0) },
  { id: 'e7', type: 'diaper', kind: 'dirty', at: at(19, 0) },
  // Vortag - darf nicht mitzählen
  { id: 'e0', type: 'feed', kind: 'bottle', amountMl: 999, at: at(20, 0, 14) }
];

test('Einträge werden dem richtigen Kalendertag zugeordnet', () => {
  const list = eventsForDay(events, at(12));
  assert.equal(list.length, 7);
  assert.equal(list[0].id, 'e1', 'aufsteigend sortiert');
  assert.equal(eventsForDay(events, at(12, 0, 14)).length, 1);
});

test('Tageszusammenfassung zählt Mahlzeiten, Menge und Windeln', () => {
  const s = summarizeDay(events, at(12));
  assert.equal(s.feeds, 4);
  assert.equal(s.breast, 1);
  assert.equal(s.bottle, 2);
  assert.equal(s.solid, 1);
  assert.equal(s.totalMl, 270, 'nur der heutige Tag');
  assert.equal(s.diapers, 3);
  assert.equal(s.wet, 2, '"Beides" zählt als nass');
  assert.equal(s.dirty, 2, '"Beides" zählt als Stuhl');
});

test('Längste Pause zwischen zwei Mahlzeiten', () => {
  const s = summarizeDay(events, at(12));
  // 12:30 -> 17:00 = 270 Minuten
  assert.equal(s.longestFeedGapMin, 270);
  assert.equal(summarizeDay([events[0]], at(12)).longestFeedGapMin, null, 'eine Mahlzeit = keine Pause');
  assert.equal(summarizeDay([], at(12)).feeds, 0);
});

test('Letzter Eintrag je Typ', () => {
  assert.equal(lastEvent(events, 'feed').id, 'e6');
  assert.equal(lastEvent(events, 'diaper').id, 'e7');
  assert.equal(lastEvent([], 'feed'), null);
});

test('Beschriftung nennt die wichtigen Details', () => {
  assert.equal(describeEvent(events[0]), 'Stillen links 15 Min');
  assert.equal(describeEvent(events[2]), 'Flasche 120 ml');
  assert.equal(describeEvent(events[4]), 'Beikost');
  assert.equal(describeEvent(events[3]), 'Beides');
  assert.equal(describeEvent({ type: 'feed', kind: 'bottle' }), 'Flasche', 'ohne Menge');
  assert.equal(describeEvent({ type: 'unsinn' }), '');
});

test('Gemeinsame Zeitleiste mischt Schlaf und Alltag, neueste zuerst', () => {
  const sleeps = [
    { id: 's1', type: 'nap', start: at(9, 0), end: at(10, 20) },
    { id: 's2', type: 'nap', start: at(13, 0), end: at(14, 0) }
  ];
  const merged = mergeTimeline(sleeps, eventsForDay(events, at(12)));
  assert.equal(merged.length, 9);
  assert.equal(merged[0].data.id, 'e7', 'jüngster Eintrag zuerst');
  assert.equal(merged[merged.length - 1].data.id, 'e1');
  const sleepEntry = merged.find((m) => m.kind === 'sleep');
  assert.ok(sleepEntry, 'Schlaf fehlt in der Zeitleiste');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bandForAge } from '../js/schedule.js';
import {
  blend,
  collectSamples,
  expectedNapCount,
  learnProfile,
  napTransitionReport,
  napTrend,
  napTransitionHint,
  personalizedBand,
  weightedMedian
} from '../js/learning.js';

const NOW = new Date(2024, 4, 20, 18, 0, 0, 0);
const band = bandForAge(200); // 6-8 Monate: 135-165 Min, 3 Naps, Nap ~75 Min

/** Baut ein Protokoll: pro Tag Nacht + Nickerchen mit festen Wachfenstern. */
function log({ days = 10, windows = [135, 150, 165], napMinutes = 75, morning = 7 }) {
  const out = [];
  for (let d = days; d >= 1; d--) {
    const base = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - d);
    const wake = new Date(base.getFullYear(), base.getMonth(), base.getDate(), morning, 0);
    out.push({
      id: `n${d}`,
      type: 'night',
      start: new Date(wake.getTime() - 11 * 3600e3),
      end: wake
    });
    let cursor = wake;
    for (let i = 0; i < windows.length; i++) {
      const start = new Date(cursor.getTime() + windows[i] * 60000);
      const end = new Date(start.getTime() + napMinutes * 60000);
      out.push({ id: `s${d}-${i}`, type: 'nap', start, end });
      cursor = end;
    }
  }
  return out;
}

test('Ohne eigene Daten bleibt es beim Altersband', () => {
  const profile = learnProfile([], band, NOW);
  assert.equal(profile.active, false);
  const personal = personalizedBand(band, profile);
  assert.equal(personal.wakeWindowMin, band.wakeWindowMin);
  assert.equal(personal.wakeWindowMax, band.wakeWindowMax);
  assert.equal(personal.naps, band.naps);
  assert.equal(personal.personalized, false);
});

test('Gewichteter Median bevorzugt schwerere Stichproben', () => {
  assert.equal(weightedMedian([]), null);
  assert.equal(weightedMedian([{ value: 5, weight: 1 }]), 5);
  const samples = [
    { value: 60, weight: 0.1 },
    { value: 61, weight: 0.1 },
    { value: 180, weight: 5 }
  ];
  assert.equal(weightedMedian(samples), 180);
});

test('Stichproben werden nach Position im Tag getrennt', () => {
  const s = collectSamples(log({ days: 4 }), NOW);
  assert.equal(s.days >= 4, true);
  assert.ok(s.firstWindows.length >= 4, 'erste Wachfenster fehlen');
  assert.ok(s.middleWindows.length >= 8, 'mittlere Wachfenster fehlen');
  assert.ok(s.napLengths.every((x) => x.value === 75));
  assert.ok(s.mornings.every((x) => x.value === 7 * 60));
  // Jüngere Tage wiegen mehr als ältere.
  const weights = s.napLengths.map((x) => x.weight);
  assert.ok(Math.max(...weights) > Math.min(...weights));
});

test('Ein Langschläfer bekommt längere Wachfenster als das Altersband', () => {
  const profile = learnProfile(log({ days: 12, windows: [190, 200, 210] }), band, NOW);
  assert.equal(profile.active, true);
  assert.ok(profile.confidence > 0.6, `Konfidenz zu niedrig: ${profile.confidence}`);
  const personal = personalizedBand(band, profile);
  assert.ok(personal.wakeWindowMin > band.wakeWindowMin);
  assert.ok(personal.wakeWindowMin >= 165, `zu wenig gelernt: ${personal.wakeWindowMin}`);
  assert.ok(personal.wakeWindowMin <= personal.wakeWindowMax);
  assert.equal(personal.personalized, true);
});

test('Kurze Wachfenster werden ebenfalls gelernt', () => {
  const profile = learnProfile(log({ days: 12, windows: [95, 100, 110] }), band, NOW);
  const personal = personalizedBand(band, profile);
  assert.ok(personal.wakeWindowMin < band.wakeWindowMin, 'Minimum nicht gesenkt');
  assert.ok(personal.wakeWindowMin >= band.wakeWindowMin * 0.6, 'unter die Sicherheitsgrenze gerutscht');
});

test('Ausreißer werden begrenzt', () => {
  // Ein einzelner Autofahrt-Tag mit absurd langem Wachfenster
  const entries = log({ days: 10 });
  entries.push({
    id: 'x',
    type: 'nap',
    start: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 1, 20, 0),
    end: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 1, 21, 0)
  });
  const profile = learnProfile(entries, band, NOW);
  const personal = personalizedBand(band, profile);
  assert.ok(personal.wakeWindowMax <= band.wakeWindowMax * 1.5);
  assert.ok(personal.wakeWindowMin >= band.wakeWindowMin * 0.6);
});

test('Blend: wenige Daten zaehlen wenig, viele Daten zaehlen viel', () => {
  const little = blend(100, 200, 1);
  const much = blend(100, 200, 60);
  assert.ok(little.value < much.value);
  assert.ok(little.value < 130, `zu schnell gelernt: ${little.value}`);
  assert.ok(much.value > 140, `zu langsam gelernt: ${much.value}`);
  assert.equal(blend(100, null, 10).value, 100);
});

test('Nap-Übergang wird erkannt und im Plan berücksichtigt', () => {
  const profile = learnProfile(log({ days: 8, windows: [180, 210] }), band, NOW);
  const personal = personalizedBand(band, profile);
  assert.equal(personal.naps, 2, `erwartet 2 Naps, bekommen ${personal.naps}`);
  const hint = napTransitionHint(band, profile);
  assert.ok(hint, 'kein Übergangshinweis');
  assert.equal(hint.to, 2);
  assert.match(hint.text, /Nickerchen/);
});

test('Passt die Anzahl der Nickerchen zum Alter, gibt es keinen Hinweis', () => {
  const profile = learnProfile(log({ days: 8 }), band, NOW);
  assert.equal(personalizedBand(band, profile).naps, 3);
  assert.equal(napTransitionHint(band, profile), null);
});

test('Tagschlafmenge folgt den eigenen Nickerchen', () => {
  const profile = learnProfile(log({ days: 14, napMinutes: 45 }), band, NOW);
  const personal = personalizedBand(band, profile);
  assert.ok(personal.napLengthMin < band.napLengthMin);
  assert.ok(personal.dayTimeSleepMin < band.dayTimeSleepMin);
});

test('Der laufende Tag verfaelscht die Nickerchen-Anzahl nicht', () => {
  const entries = log({ days: 6 });
  // Heute erst ein Nickerchen erfasst
  entries.push({
    id: 'today',
    type: 'nap',
    start: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 9, 0),
    end: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 10, 15)
  });
  const profile = learnProfile(entries, band, NOW);
  assert.equal(personalizedBand(band, profile).naps, 3);
});

test('Bettzeitfenster folgt der tatsächlichen Routine - im sicheren Rahmen', () => {
  // Familie legt konstant um 21:15 ins Bett (Band: 18:30-20:00)
  const late = log({ days: 8 }).map((s) =>
    s.type === 'night'
      ? { ...s, start: new Date(s.start.getFullYear(), s.start.getMonth(), s.start.getDate(), 21, 15) }
      : s
  );
  const profile = learnProfile(late, band, NOW);
  const personal = personalizedBand(band, profile);
  assert.ok(personal.bedtimeLatest > band.bedtimeLatest, 'Fenster nicht verschoben');
  assert.ok(personal.bedtimeLatest <= '20:30', `zu weit verschoben: ${personal.bedtimeLatest}`);
  assert.ok(personal.bedtimeEarliest >= '18:00');
});

test('Ohne Nachtdaten bleibt das Abendfenster wie im Altersband', () => {
  const napsOnly = log({ days: 8 }).filter((s) => s.type !== 'night');
  const profile = learnProfile(napsOnly, band, NOW);
  const personal = personalizedBand(band, profile);
  assert.equal(personal.bedtimeEarliest, band.bedtimeEarliest);
  assert.equal(personal.bedtimeLatest, band.bedtimeLatest);
});

/* --------------------------------------------------- Feedback / Kalibrierung */

import { calibration, napQuality, nudgeFor } from '../js/learning.js';

/** Wie log(), aber mit Bewertungen an jedem Nickerchen. */
function ratedLog({ days = 10, windows = [135, 150, 165], napMinutes = 75, rating = {} }) {
  return log({ days, windows, napMinutes }).map((s) =>
    s.type === 'nap' ? { ...s, ...rating } : s
  );
}

test('Schlafqualität wird aus Bewertung und Länge abgeleitet', () => {
  assert.equal(napQuality({}, 80), 'unknown');
  assert.equal(napQuality({ settle: 'fast' }, 80), 'good');
  assert.equal(napQuality({ settle: 'ok', mood: 'happy' }, 45), 'good');
  assert.equal(napQuality({ settle: 'slow' }, 80), 'bad');
  assert.equal(napQuality({ settle: 'fast' }, 12), 'bad', 'zu kurz ist nicht gut');
  assert.equal(napQuality({ settle: 'fast', mood: 'grumpy' }, 80), 'bad');
});

test('Richtungskorrektur zeigt in die richtige Richtung', () => {
  // Schwer eingeschlafen, dann lange geschlafen -> war noch nicht müde genug
  assert.ok(nudgeFor({ settle: 'slow' }, 90) > 0);
  // Schwer eingeschlafen und kurz geschlafen -> übermüdet
  assert.ok(nudgeFor({ settle: 'slow' }, 15) < 0);
  // Sofort weg und trotzdem kurz -> übermüdet
  assert.ok(nudgeFor({ settle: 'fast' }, 15) < 0);
  assert.equal(nudgeFor({ settle: 'fast' }, 90), 0);
  assert.equal(nudgeFor({}, 90), null, 'ohne Bewertung keine Korrektur');
});

test('Kalibrierung dämpft wenige Bewertungen und begrenzt den Ausschlag', () => {
  assert.deepEqual(calibration([]), { minutes: 0, samples: 0 });
  const one = calibration([{ value: 12, weight: 1 }]);
  assert.ok(one.minutes > 0 && one.minutes < 6, `zu starker Ausschlag: ${one.minutes}`);
  const many = calibration(Array.from({ length: 20 }, () => ({ value: 12, weight: 1 })));
  assert.ok(many.minutes >= 10, `zu schwacher Ausschlag: ${many.minutes}`);
  const extreme = calibration(Array.from({ length: 40 }, () => ({ value: 90, weight: 1 })));
  assert.equal(extreme.minutes, 30, 'Obergrenze greift nicht');
});

test('„Schwer eingeschlafen, lange geschlafen“ verlängert die Wachfenster', () => {
  const neutral = personalizedBand(band, learnProfile(log({ days: 10 }), band, NOW));
  const slowSettle = personalizedBand(
    band,
    learnProfile(ratedLog({ days: 10, rating: { settle: 'slow', mood: 'happy' } }), band, NOW)
  );
  assert.ok(
    slowSettle.wakeWindowMin > neutral.wakeWindowMin,
    `${slowSettle.wakeWindowMin} <= ${neutral.wakeWindowMin}`
  );
});

test('Übermüdungszeichen verkürzen die Wachfenster', () => {
  const neutral = personalizedBand(band, learnProfile(log({ days: 10 }), band, NOW));
  const overtired = personalizedBand(
    band,
    learnProfile(
      ratedLog({ days: 10, napMinutes: 16, rating: { settle: 'slow', mood: 'grumpy' } }),
      band,
      NOW
    )
  );
  assert.ok(
    overtired.wakeWindowMin < neutral.wakeWindowMin,
    `${overtired.wakeWindowMin} >= ${neutral.wakeWindowMin}`
  );
});

test('Gut bewertete Tage praegen den Plan staerker als schlecht bewertete', () => {
  const good = log({ days: 6, windows: [120, 130, 140] }).map((s) =>
    s.type === 'nap' ? { ...s, settle: 'fast', mood: 'happy' } : s
  );
  // Gleich viele Tage mit langen Wachfenstern, aber schlecht bewertet
  const bad = log({ days: 12, windows: [190, 200, 200] })
    .filter((s) => s.start < new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 6))
    .map((s) => (s.type === 'nap' ? { ...s, settle: 'slow', mood: 'grumpy' } : s));
  const profile = learnProfile([...bad, ...good], band, NOW);
  const personal = personalizedBand(band, profile);
  assert.ok(
    personal.wakeWindowMin < 160,
    `schlechte Tage dominieren den Plan: ${personal.wakeWindowMin}`
  );
});

test('Ohne Bewertungen bleibt das Ergebnis unveraendert', () => {
  const plain = personalizedBand(band, learnProfile(log({ days: 10 }), band, NOW));
  const withNulls = personalizedBand(
    band,
    learnProfile(ratedLog({ days: 10, rating: { settle: null, mood: null } }), band, NOW)
  );
  assert.equal(withNulls.wakeWindowMin, plain.wakeWindowMin);
  assert.equal(withNulls.wakeWindowMax, plain.wakeWindowMax);
});

test('Schweres Einschlafen am Abend verlaengert nur das Abendfenster', () => {
  const entries = log({ days: 10 }).map((s) => (s.type === 'night' ? { ...s, settle: 'slow' } : s));
  const profile = learnProfile(entries, band, NOW);
  const personal = personalizedBand(band, profile);
  const neutral = personalizedBand(band, learnProfile(log({ days: 10 }), band, NOW));
  assert.ok(personal.wakeWindowMax > neutral.wakeWindowMax);
  assert.equal(personal.wakeWindowMin, neutral.wakeWindowMin);
});

/* ------------------------------------------------ Feste Anzahl Nickerchen */

import { bandForNapCount } from '../js/learning.js';
import { buildPlan, fmtTime, timeOnDay } from '../js/schedule.js';

test('Gleiche Anzahl Nickerchen laesst das Band unveraendert', () => {
  const same = bandForNapCount(band, band.naps);
  assert.equal(same, band);
});

test('Ein Nickerchen statt zwei verlaengert die Wachfenster passend', () => {
  const zwoelfMonate = bandForAge(430); // 12-15 Monate, 2 Nickerchen
  const einNap = bandForNapCount(zwoelfMonate, 1);
  assert.equal(einNap.naps, 1);
  assert.equal(einNap.napCountAdjusted, true);
  assert.ok(
    einNap.wakeWindowMin > zwoelfMonate.wakeWindowMin,
    'Wachfenster nicht verlaengert'
  );
  // Die Bilanz muss aufgehen: Wachzeit + Tagschlaf = 24h - Nacht
  const summe = einNap.wakeWindowMin + einNap.wakeWindowMax + einNap.napLengthMin;
  assert.ok(Math.abs(summe - (24 * 60 - zwoelfMonate.nightSleepMin)) < 30, `Bilanz stimmt nicht: ${summe}`);
  assert.ok(einNap.wakeWindowMin >= 280 && einNap.wakeWindowMin <= 320, `${einNap.wakeWindowMin} Min`);
  // Fällt ein Nickerchen weg, wird das verbliebene länger - ersetzt aber nicht
  // beide: rund anderthalb bis zwei Stunden statt 75 oder 150 Minuten.
  assert.ok(
    einNap.napLengthMin > zwoelfMonate.napLengthMin && einNap.napLengthMin < zwoelfMonate.dayTimeSleepMin,
    `Nickerchenlänge unplausibel: ${einNap.napLengthMin}`
  );
});

test('Ohne Nickerchen bleibt ein einziges langes Wachfenster', () => {
  const ohne = bandForNapCount(bandForAge(430), 0);
  assert.equal(ohne.naps, 0);
  assert.equal(ohne.dayTimeSleepMin, 0);
  assert.equal(ohne.napLengthMin, 0);
  // 24h - 11h Nacht = 13h Wachzeit in einem Fenster
  assert.ok(ohne.wakeWindowMax > 12 * 60, `${ohne.wakeWindowMax} Min`);
});

test('Ein-Nickerchen-Tag ergibt genau einen Nap und eine sinnvolle Bettzeit', () => {
  const einNap = bandForNapCount(bandForAge(430), 1);
  const morgens = new Date(2024, 4, 20, 6, 30);
  const plan = buildPlan({ band: einNap, morningWake: morgens, sleeps: [], now: new Date(2024, 4, 20, 7, 0) });
  const naps = plan.blocks.filter((b) => b.type === 'nap');
  assert.equal(naps.length, 1, `erwartet 1 Nickerchen, bekommen ${naps.length}`);
  // Erstes Nickerchen am spaeten Vormittag, nicht um halb zehn
  assert.ok(naps[0].start.getHours() >= 10, `Nickerchen zu frueh: ${fmtTime(naps[0].start)}`);
  assert.ok(naps[0].start.getHours() <= 12, `Nickerchen zu spaet: ${fmtTime(naps[0].start)}`);
  // Bettzeit trotzdem berechnet und im Abendfenster
  assert.ok(plan.bedtime >= timeOnDay(morgens, einNap.bedtimeEarliest));
  assert.ok(plan.bedtime <= timeOnDay(morgens, einNap.bedtimeLatest));
});

test('Kurzer Ein-Nickerchen-Tag zieht die Bettzeit nach vorn', () => {
  const einNap = bandForNapCount(bandForAge(430), 1);
  const morgens = new Date(2024, 4, 20, 6, 30);
  // Lias Tag: 11:11 bis 12:28, also nur 77 Minuten
  const plan = buildPlan({
    band: einNap,
    morningWake: morgens,
    sleeps: [{ id: 'x', start: new Date(2024, 4, 20, 11, 11), end: new Date(2024, 4, 20, 12, 28) }],
    now: new Date(2024, 4, 20, 13, 0)
  });
  assert.equal(plan.blocks.filter((b) => b.type === 'nap').length, 1, 'kein zweites Nickerchen einplanen');
  const bedtime = plan.bedtime;
  assert.ok(bedtime.getHours() >= 18 && bedtime.getHours() <= 19, `Bettzeit ${fmtTime(bedtime)}`);
});

/* -------------------------------------------------- Schlafdruck des Tages */

import { sleepPressure } from '../js/learning.js';

test('Kurzes Nickerchen erhöht den Schlafdruck', () => {
  const einNap = bandForNapCount(bandForAge(430), 1); // Nickerchen ~2 Std 30
  // Lias Tag: geplant 150 Min, tatsächlich 80 Min
  const druck = sleepPressure(einNap, 1, 80);
  assert.equal(druck.deficit, einNap.napLengthMin - 80);
  assert.ok(druck.minutes < 0, 'Wachfenster muss kürzer werden');
  assert.ok(druck.minutes >= -30, 'nicht mehr als eine halbe Stunde');
});

test('Langes Nickerchen verschiebt nur leicht nach hinten', () => {
  const einNap = bandForNapCount(bandForAge(430), 1);
  const druck = sleepPressure(einNap, 1, einNap.napLengthMin + 90);
  assert.ok(druck.minutes > 0);
  assert.ok(druck.minutes <= 20, 'nach oben schwächer begrenzt');
});

test('Ohne Nickerchen gibt es keinen Schlafdruck-Anteil', () => {
  assert.deepEqual(sleepPressure(bandForAge(430), 0, 0), {
    minutes: 0,
    deficit: 0,
    nightDeficit: 0
  });
});

test('Der Schlafdruck zieht Lias Bettzeit nach vorn', () => {
  const einNap = bandForNapCount(bandForAge(430), 1);
  const morgens = new Date(2024, 4, 20, 6, 35);
  const kurzerNap = [{ id: 'x', start: new Date(2024, 4, 20, 11, 11), end: new Date(2024, 4, 20, 12, 31) }];
  const jetzt = new Date(2024, 4, 20, 13, 0);

  const ohne = buildPlan({ band: einNap, morningWake: morgens, sleeps: kurzerNap, now: jetzt });
  const druck = sleepPressure(einNap, 1, 80);
  const mit = buildPlan({
    band: einNap,
    morningWake: morgens,
    sleeps: kurzerNap,
    now: jetzt,
    pressureMinutes: druck.minutes
  });
  assert.ok(mit.bedtime < ohne.bedtime, 'Bettzeit muss früher liegen');
  // Erwartet werden gut anderthalb Stunden Mittagsschlaf; 80 Minuten sind
  // ein spürbares, aber kein dramatisches Defizit.
  const differenz = (ohne.bedtime - mit.bedtime) / 60000;
  assert.ok(differenz >= 5 && differenz <= 25, `Verschiebung ${differenz} Min`);
});


test('Eine kurze Nacht erhöht den Schlafdruck des Tages', () => {
  const band = bandForAge(430);
  const normal = sleepPressure(band, 0, 0, band.nightSleepMin);
  assert.equal(normal.minutes, 0, 'Norm-Nacht verschiebt nichts');

  const kurz = sleepPressure(band, 0, 0, band.nightSleepMin - 60);
  assert.equal(kurz.nightDeficit, 60);
  assert.equal(kurz.minutes, -15, 'ein Viertel des Fehlbetrags');

  const lang = sleepPressure(band, 0, 0, band.nightSleepMin + 60);
  assert.ok(lang.minutes > 0 && lang.minutes <= 15, 'nach oben begrenzt');

  // Sehr kurze Nacht: gedeckelt bei einer halben Stunde
  const sehrKurz = sleepPressure(band, 0, 0, band.nightSleepMin - 300);
  assert.equal(sehrKurz.minutes, -30);
});

test('Tag- und Nachtdefizit addieren sich, bleiben aber begrenzt', () => {
  const band = bandForAge(430);
  const beides = sleepPressure(band, 1, band.napLengthMin - 60, band.nightSleepMin - 120);
  assert.ok(beides.minutes < -20, 'beides zusammen drückt stärker');
  assert.ok(beides.minutes >= -45, 'aber nicht unbegrenzt');
  assert.equal(beides.deficit, 60);
  assert.equal(beides.nightDeficit, 120);
});

test('Die Tagesform wird am Beginn des ersten Nickerchens erkannt', () => {
  const band = bandForAge(430);
  const T = (tag, h, m) => new Date(2025, 7, tag, h, m, 0, 0);
  // Lias Muster: Zwei-Nickerchen-Tage starten früh, Ein-Nickerchen-Tage spät.
  const sleeps = [];
  const tage = [
    [10, 2], [11, 1], [12, 2], [13, 1], [14, 2], [15, 1], [16, 2], [17, 1]
  ];
  for (const [tag, anzahl] of tage) {
    if (anzahl === 2) {
      sleeps.push({ id: `a${tag}`, type: 'nap', start: T(tag, 9, 40), end: T(tag, 10, 40) });
      sleeps.push({ id: `b${tag}`, type: 'nap', start: T(tag, 14, 20), end: T(tag, 15, 10) });
    } else {
      sleeps.push({ id: `a${tag}`, type: 'nap', start: T(tag, 11, 10), end: T(tag, 12, 40) });
    }
    sleeps.push({ id: `n${tag}`, type: 'night', start: T(tag, 19, 5), end: T(tag + 1, 6, 35) });
  }
  const profil = learnProfile(sleeps, band, T(18, 8, 0));

  assert.equal(expectedNapCount(profil, T(18, 9, 35)), 2, 'früh los: es folgt noch eines');
  assert.equal(expectedNapCount(profil, T(18, 11, 20)), 1, 'spät los: eines reicht');
  assert.equal(expectedNapCount(profil, T(18, 13, 0)), 1, 'sehr spät erst recht');
});

test('Ohne Tage zu beiden Formen raet die App nicht', () => {
  const band = bandForAge(430);
  const T = (tag, h, m) => new Date(2025, 7, tag, h, m, 0, 0);
  const sleeps = [];
  for (const tag of [10, 11, 12]) {
    sleeps.push({ id: `a${tag}`, type: 'nap', start: T(tag, 9, 40), end: T(tag, 10, 40) });
    sleeps.push({ id: `b${tag}`, type: 'nap', start: T(tag, 14, 20), end: T(tag, 15, 10) });
    sleeps.push({ id: `n${tag}`, type: 'night', start: T(tag, 19, 5), end: T(tag + 1, 6, 35) });
  }
  const profil = learnProfile(sleeps, band, T(13, 8, 0));
  assert.equal(expectedNapCount(profil, T(13, 11, 30)), null, 'nur eine Form gelernt');
  assert.equal(expectedNapCount(profil, null), null);
});

test('Der Uebergangsbericht vergleicht die juengere mit der aelteren Haelfte', () => {
  const band = bandForAge(430);
  const T = (tag, h, m) => new Date(2026, 7, tag, h, m, 0, 0);
  const sleeps = [];
  // Erst zwei Nickerchen früh, dann eines spät und länger.
  for (const tag of [20, 21, 22, 23]) {
    sleeps.push({ id: `a${tag}`, type: 'nap', start: T(tag, 9, 30), end: T(tag, 10, 30) });
    sleeps.push({ id: `b${tag}`, type: 'nap', start: T(tag, 14, 0), end: T(tag, 14, 45) });
  }
  for (const tag of [24, 25, 26, 27]) {
    sleeps.push({ id: `c${tag}`, type: 'nap', start: T(tag, 11, 30), end: T(tag, 13, 45) });
  }
  const r = napTransitionReport(sleeps, band, T(27, 20, 0));

  assert.equal(r.laeuft, true, 'der Übergang läuft');
  assert.equal(r.tage, 8);
  assert.equal(r.frueher.anteilEinzeln, 0);
  assert.equal(r.zuletzt.anteilEinzeln, 1);
  assert.equal(r.verschiebung, 120, 'zwei Stunden später');
  assert.equal(r.frueher.laenge, 105, 'zwei Nickerchen zusammen');
  assert.equal(r.zuletzt.laenge, 135, 'ein längeres statt zweier kurzer');
  assert.equal(r.laengerUm, 30);
});

test('Ohne Wechsel meldet der Bericht keinen Uebergang', () => {
  const band = bandForAge(430);
  const T = (tag, h, m) => new Date(2026, 7, tag, h, m, 0, 0);
  const sleeps = [];
  for (const tag of [20, 21, 22, 23, 24, 25]) {
    sleeps.push({ id: `a${tag}`, type: 'nap', start: T(tag, 9, 30), end: T(tag, 10, 30) });
    sleeps.push({ id: `b${tag}`, type: 'nap', start: T(tag, 14, 0), end: T(tag, 15, 0) });
  }
  const r = napTransitionReport(sleeps, band, T(25, 20, 0));
  assert.equal(r.laeuft, false);
  assert.equal(napTransitionReport(sleeps.slice(0, 4), band, T(21, 20, 0)), null, 'zu wenig Tage');
});

test('Der Trend liefert einen Punkt je Tag, aufsteigend', () => {
  const T = (tag, h, m) => new Date(2026, 7, tag, h, m, 0, 0);
  const sleeps = [
    { id: 'b', type: 'nap', start: T(21, 14, 0), end: T(21, 14, 45) },
    { id: 'a', type: 'nap', start: T(21, 9, 30), end: T(21, 10, 30) },
    { id: 'c', type: 'nap', start: T(22, 11, 0), end: T(22, 12, 30) },
    { id: 'n', type: 'night', start: T(22, 19, 0), end: T(23, 6, 30) }
  ];
  const punkte = napTrend(sleeps, { now: T(23, 12, 0) });
  assert.equal(punkte.length, 2);
  assert.equal(punkte[0].start, 9 * 60 + 30, 'das erste Nickerchen zählt, nicht das zuerst erfasste');
  assert.equal(punkte[0].laenge, 105, 'beide Nickerchen des Tages');
  assert.equal(punkte[0].anzahl, 2);
  assert.equal(punkte[1].anzahl, 1);
  assert.ok(punkte[0].tag < punkte[1].tag, 'aufsteigend sortiert');
});

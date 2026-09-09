import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AGE_BANDS } from '../js/data.js';
import {
  addMinutes,
  ageInDays,
  awakeMinutesIn,
  bedtimeFromBudget,
  buildDayReview,
  findConflicts,
  findMissingNights,
  napCap,
  catchUpFor,
  classifyWaking,
  nightBalance,
  nightDebt,
  nightShiftFor,
  daysSince,
  bandForAge,
  buildPlan,
  fmtCountdown,
  fmtDuration,
  fmtTime,
  formatAge,
  minutesBetween,
  nightEndFor,
  timeOnDay,
  wakeStatus,
  wakeWindowFor
} from '../js/schedule.js';

const at = (h, m = 0, day = 15) => new Date(2024, 4, day, h, m, 0, 0);

test('Alter zählt Kalendertage', () => {
  const birth = new Date(2024, 0, 1);
  assert.equal(ageInDays(birth, null, new Date(2024, 0, 1, 23)), 0);
  assert.equal(ageInDays(birth, null, new Date(2024, 0, 31)), 30);
});

test('Frühgeborene: korrigiertes Alter bis zum 2. Geburtstag', () => {
  const birth = new Date(2024, 0, 1);
  const due = new Date(2024, 2, 1); // 60 Tage später errechnet
  const now = new Date(2024, 5, 1);
  assert.equal(ageInDays(birth, due, now), 92); // ab errechnetem Termin
  assert.equal(ageInDays(birth, null, now), 152); // chronologisch
  // Nach zwei Jahren wieder chronologisch
  const later = new Date(2026, 5, 1);
  assert.equal(ageInDays(birth, due, later), ageInDays(birth, null, later));
});

test('Altersbänder greifen ab ihrem Startalter', () => {
  assert.equal(bandForAge(0).id, 'nb');
  assert.equal(bandForAge(27).id, 'nb');
  assert.equal(bandForAge(28).id, 'w4');
  assert.equal(bandForAge(200).id, 'm6');
  assert.equal(bandForAge(99999).id, AGE_BANDS[AGE_BANDS.length - 1].id);
});

test('Bänder sind aufsteigend und plausibel', () => {
  let prev = -1;
  for (const band of AGE_BANDS) {
    assert.ok(band.minAgeDays > prev, `${band.id} nicht aufsteigend`);
    assert.ok(band.wakeWindowMin <= band.wakeWindowMax, `${band.id} Wachfenster verdreht`);
    assert.ok(band.dayTimeSleepMin + band.nightSleepMin <= 19 * 60, `${band.id} zu viel Schlaf`);
    prev = band.minAgeDays;
  }
});

test('Wachfenster wächst vom ersten zum letzten Fenster des Tages', () => {
  const band = bandForAge(200);
  const first = wakeWindowFor(band, 0, 4);
  const last = wakeWindowFor(band, 3, 4);
  assert.equal(first, band.wakeWindowMin);
  assert.equal(last, band.wakeWindowMax);
  assert.ok(wakeWindowFor(band, 1, 4) > first);
  assert.ok(wakeWindowFor(band, 2, 4) < last);
});

test('Tagesplan: leerer Tag ergibt Naps, Bettzeit und lückenlose Blöcke', () => {
  const band = bandForAge(200); // 6-8 Monate, 3 Naps
  const morningWake = at(7);
  const plan = buildPlan({ band, morningWake, sleeps: [], now: at(7, 5) });

  const naps = plan.blocks.filter((b) => b.type === 'nap');
  assert.ok(naps.length >= 2 && naps.length <= band.naps, `unerwartet ${naps.length} Naps`);
  assert.equal(plan.blocks.filter((b) => b.type === 'night').length, 1);

  // Erster Nap startet nach dem ersten (kürzesten) Wachfenster.
  assert.equal(minutesBetween(morningWake, naps[0].start), band.wakeWindowMin);

  // Blöcke sind lückenlos und aufsteigend.
  for (let i = 1; i < plan.blocks.length; i++) {
    assert.equal(+plan.blocks[i].start, +plan.blocks[i - 1].end, `Lücke bei Block ${i}`);
  }

  const bedtime = plan.bedtime;
  assert.ok(bedtime >= timeOnDay(morningWake, band.bedtimeEarliest));
  assert.ok(bedtime <= timeOnDay(morningWake, band.bedtimeLatest));
});

test('Tagesplan: erfasste Nickerchen überschreiben die Vorhersage', () => {
  const band = bandForAge(200);
  const morningWake = at(6, 30);
  const nap = { start: at(9, 0), end: at(10, 15) };
  const plan = buildPlan({ band, morningWake, sleeps: [nap], now: at(11, 0) });

  const naps = plan.blocks.filter((b) => b.type === 'nap');
  assert.equal(+naps[0].start, +nap.start);
  assert.equal(+naps[0].end, +nap.end);
  assert.equal(naps[0].actual, true);
  assert.equal(plan.dayTimeSleepMin, 75);
  // Der nächste geplante Nap hängt am Ende des erfassten Naps.
  assert.ok(naps[1].start > nap.end);
});

test('Tagesplan: laufender Schlaf wird als "läuft" geführt', () => {
  const band = bandForAge(200);
  const plan = buildPlan({
    band,
    morningWake: at(7),
    sleeps: [{ start: at(9, 30), end: null }],
    now: at(9, 50)
  });
  const running = plan.blocks.find((b) => b.running);
  assert.ok(running, 'kein laufender Block');
  assert.ok(running.end > at(9, 50));
});

test('Tagesplan: später Tagesstart ergibt trotzdem eine sinnvolle Bettzeit', () => {
  const band = bandForAge(400); // 12-15 Monate
  const plan = buildPlan({ band, morningWake: at(11), sleeps: [], now: at(11, 5) });
  assert.ok(plan.bedtime <= timeOnDay(at(11), band.bedtimeLatest));
  assert.ok(plan.bedtime > at(11));
});

test('Kein Nickerchen mehr kurz vor der Bettzeit', () => {
  const band = bandForAge(200);
  const plan = buildPlan({
    band,
    morningWake: at(7),
    sleeps: [
      { start: at(9), end: at(10, 15) },
      { start: at(13), end: at(14, 30) },
      { start: at(17), end: at(17, 40) }
    ],
    now: at(18)
  });
  const planned = plan.blocks.filter((b) => b.type === 'nap' && !b.actual);
  assert.equal(planned.length, 0);
});

test('Wachstatus rechnet Wachzeit und Fortschritt', () => {
  const band = bandForAge(200);
  const status = wakeStatus({
    band,
    lastWakeUp: at(7),
    sleeps: [],
    now: at(8, 30)
  });
  assert.equal(status.sleeping, false);
  assert.equal(status.minutes, 90);
  assert.equal(status.target, band.wakeWindowMin);
  assert.ok(status.progress > 0.6);
  assert.equal(+status.windowEnd, +at(7, band.wakeWindowMin));
});

test('Wachstatus erkennt laufenden Schlaf', () => {
  const band = bandForAge(200);
  const status = wakeStatus({
    band,
    lastWakeUp: at(7),
    sleeps: [{ start: at(9), end: null }],
    now: at(9, 30)
  });
  assert.equal(status.sleeping, true);
  assert.equal(status.minutes, 30);
});

test('Formatierungen', () => {
  assert.equal(fmtDuration(0), '0 Min');
  assert.equal(fmtDuration(45), '45 Min');
  assert.equal(fmtDuration(60), '1 Std');
  assert.equal(fmtDuration(95), '1 Std 35 Min');
  assert.equal(fmtCountdown(65 * 1000), '01:05');
  assert.equal(fmtCountdown(3 * 3600 * 1000 + 61 * 1000), '3:01:01');
  assert.equal(fmtCountdown(-30 * 1000), '+00:30');
  assert.equal(formatAge(3), '3 Tage');
  assert.equal(formatAge(21), '3 Wochen');
  assert.equal(formatAge(200), '6 Monate, 2 Wochen');
});

/* ------------------------------------------- Abgleich mit den Leitlinien */

test('Jedes Altersband bleibt in der empfohlenen Gesamtschlafdauer', () => {
  for (const b of AGE_BANDS) {
    const totalHours = (b.dayTimeSleepMin + b.nightSleepMin) / 60;
    assert.ok(b.guideline, `${b.id} hat keine Leitlinien-Angabe`);
    assert.ok(
      totalHours >= b.guideline.min && totalHours <= b.guideline.max,
      `${b.label}: ${totalHours} h liegt außerhalb von ${b.guideline.min}-${b.guideline.max} h (${b.guideline.source})`
    );
  }
});

test('Nickerchen-Anzahl folgt den belegten Übergangsaltern', () => {
  const napsAt = (days) => bandForAge(days).naps;
  // Wechsel 3 -> 2 Nickerchen: laut Meta-Analyse zwischen 6,5 und 8 Monaten
  assert.ok(napsAt(30 * 6) >= 3, 'mit 6 Monaten noch mindestens 3 Nickerchen');
  assert.equal(napsAt(30 * 9), 2, 'mit 9 Monaten zwei Nickerchen');
  // Wechsel 2 -> 1: zwischen 13 und 18 Monaten
  assert.equal(napsAt(30 * 13), 2, 'mit 13 Monaten noch zwei Nickerchen');
  assert.equal(napsAt(30 * 18), 1, 'mit 18 Monaten ein Nickerchen');
  // Vor dem 2. Geburtstag hören fast keine Kinder ganz auf
  assert.ok(napsAt(700) >= 1, 'vor 2 Jahren noch ein Nickerchen');
  // Mit 3 Jahren schlafen viele noch, mit 4-5 die wenigsten
  assert.equal(napsAt(30 * 40), 1, 'mit gut 3 Jahren noch ein Nickerchen');
  assert.equal(napsAt(30 * 55), 0, 'mit gut 4,5 Jahren keines mehr');
});

test('Wachfenster wachsen monoton mit dem Alter', () => {
  let prevMin = 0;
  let prevMax = 0;
  for (const b of AGE_BANDS) {
    assert.ok(b.wakeWindowMin >= prevMin, `${b.label}: Wachfenster-Minimum sinkt`);
    assert.ok(b.wakeWindowMax >= prevMax, `${b.label}: Wachfenster-Maximum sinkt`);
    prevMin = b.wakeWindowMin;
    prevMax = b.wakeWindowMax;
  }
});

test('Nickerchen-Anzahl sinkt nie mit dem Alter', () => {
  let prev = Infinity;
  for (const b of AGE_BANDS) {
    assert.ok(b.naps <= prev, `${b.label}: mehr Nickerchen als im jüngeren Band`);
    prev = b.naps;
  }
});

test('daysSince zählt ganze Tage', () => {
  const now = new Date(2024, 4, 20, 12, 0);
  assert.equal(daysSince(null, now), null);
  assert.equal(daysSince('kein Datum', now), null);
  assert.equal(daysSince(new Date(2024, 4, 20, 6, 0).toISOString(), now), 0);
  assert.equal(daysSince(new Date(2024, 4, 17, 12, 0).toISOString(), now), 3);
  assert.equal(daysSince(new Date(2024, 4, 25).toISOString(), now), 0, 'Zukunft ergibt 0');
});

test('Erfasste Bloecke tragen die id des Eintrags mit', () => {
  const band = bandForAge(200);
  const plan = buildPlan({
    band,
    morningWake: at(6, 30),
    sleeps: [
      { id: 'abc', start: at(9), end: at(10, 20) },
      { id: 'laeuft', start: at(13), end: null }
    ],
    now: at(13, 30)
  });
  const naps = plan.blocks.filter((b) => b.type === 'nap');
  assert.equal(naps[0].id, 'abc');
  assert.equal(naps[1].id, 'laeuft');
  assert.equal(naps[1].running, true);
  // Geplante Bloecke haben keine id - es gibt ja noch keinen Eintrag
  const geplant = plan.blocks.find((b) => b.type === 'nap' && !b.actual);
  if (geplant) assert.equal(geplant.id, undefined);
});

test('Der Nachtschlaf endet zur üblichen Aufwachzeit', () => {
  const band = bandForAge(430);
  const morgens = at(6, 30);
  const plan = buildPlan({ band, morningWake: morgens, sleeps: [], now: at(7) });
  const nacht = plan.blocks.find((b) => b.type === 'night');
  assert.equal(nacht.end.getHours(), 6, `Nacht endet um ${nacht.end.getHours()} Uhr`);
  assert.equal(nacht.end.getMinutes(), 30);
  assert.ok(nacht.end > nacht.start);
});

test('Unplausible Nachtlängen fallen auf den Normwert zurück', () => {
  const band = bandForAge(430);
  // Aufwachzeit kurz nach der Bettzeit: daraus darf keine Zwei-Stunden-Nacht werden
  const spaeterMorgen = at(21, 30);
  const nacht = nightEndFor(at(20, 0), spaeterMorgen, band);
  assert.equal(minutesBetween(at(20, 0), nacht), band.nightSleepMin);
});

test('Eine laufende Nacht beendet den Plan, statt eine zweite zu planen', () => {
  const band = bandForAge(430);
  const plan = buildPlan({
    band,
    morningWake: at(6, 35),
    sleeps: [
      { id: 'nap', type: 'nap', start: at(11, 11), end: at(12, 31) },
      { id: 'nacht', type: 'night', start: at(19, 3), end: null }
    ],
    now: at(19, 50)
  });
  const naechte = plan.blocks.filter((b) => b.type === 'night');
  assert.equal(naechte.length, 1, 'genau eine Nacht im Plan');
  assert.equal(naechte[0].running, true, 'die laufende Nacht');
  assert.equal(+naechte[0].start, +at(19, 3));
  assert.equal(naechte[0].end.getHours(), 6, 'Nacht endet zur gewohnten Zeit');
  assert.equal(+plan.bedtime, +at(19, 3), 'Bettzeit ist der tatsächliche Beginn');
  // Kein geplantes Nickerchen mehr nach dem Zubettgehen
  assert.equal(plan.blocks.filter((b) => b.type === 'nap' && !b.actual).length, 0);
  // Das Abendwachfenster davor bleibt erhalten
  const abend = plan.blocks.find((b) => b.type === 'wake' && b.evening);
  assert.ok(abend && +abend.end === +at(19, 3));
});

test('Eine bereits beendete Abendnacht steht im Plan, kein zweites Zubettgehen', () => {
  const band = bandForAge(430);
  const plan = buildPlan({
    band,
    morningWake: at(6, 35),
    sleeps: [
      { id: 'nap', type: 'nap', start: at(11, 11), end: at(12, 31) },
      // Nacht begonnen und versehentlich um 20:12 beendet
      { id: 'nacht', type: 'night', start: at(19, 3), end: at(20, 12) }
    ],
    now: at(20, 23)
  });
  const naechte = plan.blocks.filter((b) => b.type === 'night');
  assert.equal(naechte.length, 2, 'die erfasste Nacht und der Rest der Nacht');
  assert.equal(naechte[0].actual, true, 'die erfasste, nicht eine geplante');
  assert.equal(naechte[0].running, false);
  assert.equal(naechte[0].id, 'nacht', 'ohne id wäre die Zeile nicht bearbeitbar');
  assert.equal(+naechte[0].start, +at(19, 3));
  assert.equal(+naechte[0].end, +at(20, 12), 'echtes Ende, keine Prognose');
  assert.equal(+plan.bedtime, +at(19, 3), 'die Bettzeit bleibt der Nachtbeginn');
  assert.equal(naechte[1].continuation, true, 'kein neues Zubettgehen, sondern Weiterschlafen');
  assert.equal(+naechte[1].start, +at(20, 23), 'ab jetzt, nicht erst zur üblichen Bettzeit');
  assert.equal(+naechte[1].end, +at(6, 35, 16), 'bis zur errechneten Aufstehzeit');
});

test('Eine Nacht, die vor der Aufstehzeit endet, ist nicht der Tagesabschluss', () => {
  // Lias Fall: Nacht um 18:45 begonnen, um 20:15 als beendet erfasst.
  const band = bandForAge(430);
  const plan = buildPlan({
    band,
    morningWake: at(6, 28),
    sleeps: [
      { id: 'nap', type: 'nap', start: at(10, 46), end: at(12, 1) },
      { id: 'nacht', type: 'night', start: at(18, 45), end: at(20, 15) }
    ],
    now: at(20, 15)
  });
  const rest = plan.blocks.filter((b) => b.type === 'night').pop();
  assert.equal(rest.continuation, true);
  assert.equal(+rest.end, +at(6, 28, 16), 'die errechnete Aufstehzeit bleibt sichtbar');
  assert.ok(
    plan.blocks.some((b) => b.type !== 'wake' && !b.actual),
    'es steht wieder etwas im Plan'
  );
});

test('Zwei Nachtabschnitte hintereinander stehen beide im Plan', () => {
  const band = bandForAge(430);
  const plan = buildPlan({
    band,
    morningWake: at(6, 30),
    sleeps: [
      { id: 'n1', type: 'night', start: at(18, 45), end: at(20, 15) },
      { id: 'n2', type: 'night', start: at(20, 40), end: null }
    ],
    now: at(21, 10)
  });
  const naechte = plan.blocks.filter((b) => b.type === 'night');
  assert.equal(naechte.length, 2);
  assert.equal(naechte[1].running, true, 'der zweite Abschnitt läuft');
  assert.equal(naechte[1].continued, true, 'als Fortsetzung derselben Nacht markiert');
  const wach = plan.blocks.find((b) => b.type === 'wake' && b.atNight);
  assert.equal(+wach.start, +at(20, 15), 'die Wachphase dazwischen ist sichtbar');
  assert.equal(+wach.end, +at(20, 40));
  assert.equal(+plan.bedtime, +at(18, 45));
});

test('Der Wachstatus misst eine Nacht an der Nachtschlafdauer', () => {
  const band = bandForAge(430);
  const nacht = wakeStatus({
    band,
    lastWakeUp: at(6, 30),
    sleeps: [{ id: 'n', type: 'night', start: at(19, 3), end: null }],
    now: at(20, 40)
  });
  assert.equal(nacht.sleeping, true);
  assert.equal(nacht.night, true);
  assert.equal(nacht.target, band.nightSleepMin, 'nicht die Nickerchenlänge');
  assert.ok(nacht.progress < 0.2, `nach 1,5 Std erst ${Math.round(nacht.progress * 100)} %`);

  const nickerchen = wakeStatus({
    band,
    lastWakeUp: at(6, 30),
    sleeps: [{ id: 'x', type: 'nap', start: at(11, 11), end: null }],
    now: at(12, 26)
  });
  assert.equal(nickerchen.night, false);
  assert.equal(nickerchen.target, band.napLengthMin);
});

test('Nachts kurz wach ist ein eigener Zustand, kein Tagesbeginn', () => {
  const band = bandForAge(430);
  const nacht = {
    id: 'n',
    type: 'night',
    start: at(19, 3),
    end: null,
    interruptions: [{ start: at(23, 55), end: null }]
  };
  const status = wakeStatus({ band, lastWakeUp: at(6, 30), sleeps: [nacht], now: at(0, 40, 21) });
  assert.equal(status.nightWaking, true);
  assert.equal(status.sleeping, false, 'wach - aber');
  assert.equal(status.night, true, 'die Nacht läuft weiter');
  assert.equal(+status.since, +at(23, 55), 'gezählt wird ab dem Aufwachen');
  assert.equal(+status.nightStart, +at(19, 3));

  // Schläft wieder: zurück im Nachtschlaf
  nacht.interruptions[0].end = at(1, 46, 21);
  const danach = wakeStatus({ band, lastWakeUp: at(6, 30), sleeps: [nacht], now: at(2, 0, 21) });
  assert.equal(danach.sleeping, true);
  assert.equal(danach.nightWaking, undefined);
});

test('Zwei Nickerchen an einem Ein-Nickerchen-Tag verkürzen die Wachfenster', async () => {
  const { bandForNapCount, sleepPressure } = await import('../js/learning.js');
  const eingestellt = bandForNapCount(bandForAge(430), 1); // Elternvorgabe: ein Nickerchen
  const tatsaechlich = bandForNapCount(eingestellt, 2); // heute waren es zwei

  assert.ok(
    tatsaechlich.wakeWindowMax < eingestellt.wakeWindowMax,
    'das Abendfenster muss kürzer werden'
  );
  assert.ok(tatsaechlich.wakeWindowMax >= 3 * 60 && tatsaechlich.wakeWindowMax <= 4 * 60);

  // Lias echter Tag: 06:30 wach, Nickerchen 09:35-10:35 und 14:39-15:28
  const naps = [
    { id: 'a', type: 'nap', start: at(9, 35), end: at(10, 35) },
    { id: 'b', type: 'nap', start: at(14, 39), end: at(15, 28) }
  ];
  const druck = sleepPressure(tatsaechlich, 2, 60 + 49);
  const plan = buildPlan({
    band: tatsaechlich,
    morningWake: at(6, 30),
    sleeps: naps,
    now: at(15, 58),
    pressureMinutes: druck.minutes
  });

  const stunde = plan.bedtime.getHours();
  const minute = plan.bedtime.getMinutes();
  assert.ok(
    stunde === 19 && minute <= 30,
    `Bettzeit ${stunde}:${String(minute).padStart(2, '0')} statt kurz nach 19 Uhr`
  );
  // Zum Vergleich: mit dem Ein-Nickerchen-Band landet man weit nach 20 Uhr
  const falsch = buildPlan({
    band: eingestellt,
    morningWake: at(6, 30),
    sleeps: naps,
    now: at(15, 58)
  });
  assert.ok(falsch.bedtime > plan.bedtime, 'altes Verhalten war später');
});

test('Kompakte Dauer für die große Anzeige', async () => {
  const { fmtCompact } = await import('../js/schedule.js');
  assert.equal(fmtCompact(84), '1h 24m');
  assert.equal(fmtCompact(45), '45m');
  assert.equal(fmtCompact(120), '2h');
  assert.equal(fmtCompact(0), '0m');
  assert.equal(fmtCompact(-10), '0m');
});

test('Wer fast durchgeschlafen hat, bekommt keinen Rest-Nacht-Block', () => {
  // Nacht 19:00 bis 05:45: das ist der Morgen, nicht eine Unterbrechung.
  const band = bandForAge(430);
  const plan = buildPlan({
    band,
    morningWake: at(6, 30),
    sleeps: [{ id: 'nacht', type: 'night', start: at(19, 0), end: at(5, 45, 16) }],
    now: at(5, 50, 16)
  });
  assert.equal(
    plan.blocks.filter((b) => b.type === 'night').length,
    1,
    'nur die erfasste Nacht, keine Fortsetzung'
  );
});

test('Kurz vor der Aufstehzeit wird die Nacht nicht mehr fortgesetzt', () => {
  const band = bandForAge(430);
  const plan = buildPlan({
    band,
    morningWake: at(6, 30),
    sleeps: [{ id: 'nacht', type: 'night', start: at(19, 0), end: at(6, 5, 16) }],
    now: at(6, 5, 16)
  });
  assert.equal(plan.blocks.filter((b) => b.continuation).length, 0);
});


test('Nächtliche Wachphasen werden zusammengezählt', () => {
  const nacht = {
    start: at(19, 0),
    end: at(6, 30, 16),
    interruptions: [
      { start: at(2, 10, 16), end: at(3, 5, 16) },
      { start: at(4, 40, 16), end: at(5, 0, 16) }
    ]
  };
  assert.equal(awakeMinutesIn(nacht), 75);
  // Eine offene Phase zählt bis jetzt.
  const laufend = { start: at(19, 0), interruptions: [{ start: at(2, 0, 16), end: null }] };
  assert.equal(awakeMinutesIn(laufend, at(2, 30, 16)), 30);
  assert.equal(awakeMinutesIn({ start: at(19, 0) }), 0);
});

test('Nachts wach schiebt die errechnete Aufstehzeit nach hinten', () => {
  const band = bandForAge(430);
  const ohne = nightEndFor(at(19, 0), at(6, 30), band);
  const mit = nightEndFor(at(19, 0), at(6, 30), band, 60);
  assert.equal(+ohne, +at(6, 30, 16));
  assert.equal(minutesBetween(ohne, mit), 30, 'die halbe Wachzeit');
  // Gedeckelt: auch drei Stunden Wachliegen verschieben nur eine Stunde.
  assert.equal(minutesBetween(ohne, nightEndFor(at(19, 0), at(6, 30), band, 180)), 60);
  assert.equal(nightShiftFor(0), 0);
  assert.equal(nightShiftFor(50), 25);
  assert.equal(nightShiftFor(300), 60);
});

test('Die Wachphasen einer laufenden Nacht stehen im Plan', () => {
  const band = bandForAge(430);
  const plan = buildPlan({
    band,
    morningWake: at(6, 30),
    sleeps: [
      {
        id: 'nacht',
        type: 'night',
        start: at(19, 0),
        end: null,
        interruptions: [{ start: at(22, 0), end: at(23, 0) }]
      }
    ],
    now: at(23, 30)
  });
  const nacht = plan.blocks.find((b) => b.type === 'night');
  assert.equal(+nacht.end, +at(7, 0, 16), 'eine Stunde wach: 30 Min später aufstehen');
  assert.equal(nacht.interruptions.length, 1);
});


test('Der Rückblick zeigt einen vergangenen Tag in der richtigen Reihenfolge', () => {
  const sleeps = [
    // Die Nacht, aus der dieser Tag begann - mit 45 Minuten Wachliegen
    {
      id: 'n0',
      type: 'night',
      start: at(19, 5, 14),
      end: at(6, 20),
      interruptions: [{ start: at(2, 15), end: at(3, 0) }]
    },
    { id: 'a', type: 'nap', start: at(9, 40), end: at(10, 55) },
    { id: 'b', type: 'nap', start: at(14, 30), end: at(15, 40) },
    { id: 'n1', type: 'night', start: at(19, 0), end: at(6, 35, 16) }
  ];
  const r = buildDayReview({ sleeps, day: at(12), morningWake: at(6, 20) });

  assert.equal(r.hasData, true);
  assert.equal(r.naps.length, 2);
  assert.equal(+r.morningWake, +at(6, 20));
  assert.equal(+r.bedtime, +at(19, 0), 'ins Bett am Abend dieses Tages');
  assert.equal(r.nightBefore.id, 'n0');
  assert.equal(r.evening.id, 'n1');

  assert.equal(r.napMinutes, 145, 'zwei Nickerchen');
  assert.equal(r.nightBeforeMinutes, 11 * 60 + 15 - 45, 'Wachphase abgezogen');
  assert.equal(r.wakings, 45);
  assert.equal(r.totalMinutes, r.napMinutes + r.nightBeforeMinutes);

  const arten = r.blocks.map((b) => b.type);
  assert.deepEqual(arten, ['wake', 'nap', 'wake', 'nap', 'wake', 'night']);
  assert.equal(r.blocks[1].index, 1);
  assert.equal(r.blocks[3].index, 2);
  assert.equal(r.blocks[5].id, 'n1');
  assert.equal(r.blocks[4].evening, true);
});

test('Ein Tag ohne Einträge bleibt leer statt zu raten', () => {
  const r = buildDayReview({ sleeps: [], day: at(12) });
  assert.equal(r.hasData, false);
  assert.equal(r.blocks.length, 0);
  assert.equal(r.totalMinutes, 0);
  assert.equal(r.bedtime, null);
});

test('Ein laufender Schlaf im Rückblick ist als laufend markiert', () => {
  const sleeps = [{ id: 'x', type: 'nap', start: at(11, 0), end: null }];
  const r = buildDayReview({ sleeps, day: at(12), morningWake: at(6, 30) });
  const nap = r.blocks.find((b) => b.type === 'nap');
  assert.equal(nap.running, true);
  assert.equal(nap.id, 'x');
});

test('Nickerchen anderer Tage tauchen im Rückblick nicht auf', () => {
  const sleeps = [
    { id: 'gestern', type: 'nap', start: at(11, 0, 14), end: at(12, 0, 14) },
    { id: 'heute', type: 'nap', start: at(11, 0), end: at(12, 0) },
    { id: 'morgen', type: 'nap', start: at(11, 0, 16), end: at(12, 0, 16) }
  ];
  const r = buildDayReview({ sleeps, day: at(12), morningWake: at(6, 30) });
  assert.deepEqual(r.naps.map((n) => n.id), ['heute']);
});


test('Die Datenpruefung findet Doppel, Ueberschneidungen und Unmoegliches', () => {
  const sleeps = [
    { id: 'ok', type: 'nap', start: at(11, 0), end: at(12, 0) },
    { id: 'doppelt', type: 'nap', start: at(11, 0), end: at(12, 0) },
    { id: 'nacht-lang', type: 'night', start: at(19, 0), end: at(23, 47, 16) },
    { id: 'nacht-kurz', type: 'night', start: at(19, 5), end: at(20, 12) },
    { id: 'sauber', type: 'night', start: at(19, 0, 17), end: at(6, 30, 18) }
  ];
  const funde = findConflicts(sleeps, at(12, 0, 18));
  const nach = (id) => funde.find((f) => f.id === id);

  assert.equal(nach('doppelt').grund, 'doppelt');
  assert.equal(nach('nacht-lang').grund, 'zu-lang');
  assert.equal(nach('nacht-kurz').grund, 'zu-kurz', 'der auffälligste Grund zuerst');
  assert.equal(nach('sauber'), undefined, 'saubere Nacht bleibt unangetastet');
  assert.equal(nach('ok'), undefined, 'der erste von zwei gleichen bleibt stehen');
});

test('Ein Ende in der Zukunft faellt auf', () => {
  const funde = findConflicts(
    [{ id: 'x', type: 'nap', start: at(11, 0), end: at(13, 0) }],
    at(12, 0)
  );
  assert.equal(funde[0].grund, 'zukunft');
});

test('Ein sauberes Protokoll meldet nichts', () => {
  const sleeps = [
    { id: 'a', type: 'nap', start: at(9, 30), end: at(10, 30) },
    { id: 'b', type: 'nap', start: at(14, 0), end: at(15, 0) },
    { id: 'c', type: 'night', start: at(19, 0), end: at(6, 30, 16) }
  ];
  assert.deepEqual(findConflicts(sleeps, at(12, 0, 16)), []);
});

test('Endet das letzte Nickerchen spät, rückt die Bettzeit nach hinten', () => {
  // "Schläft das zweite bis 15:00 oder später, muss sie später ins Bett -
  // sonst ist sie nicht müde."
  const band = bandForAge(430);
  const bett = (ende) =>
    buildPlan({
      band,
      morningWake: at(6, 30),
      sleeps: [
        { id: 'a', type: 'nap', start: at(9, 30), end: at(10, 30) },
        { id: 'b', type: 'nap', start: addMinutes(ende, -60), end: ende }
      ],
      now: ende
    }).bedtime;

  const frueh = bett(at(14, 0));
  const spaet = bett(at(16, 0));
  assert.ok(spaet > frueh, 'spätes Nickerchen-Ende verschiebt die Bettzeit nach hinten');
  assert.ok(
    minutesBetween(at(16, 0), spaet) >= 150,
    'nach dem Aufwachen bleibt genug Wachzeit, sonst ist das Kind nicht müde'
  );
});

test('Die Mindestwachzeit sprengt die altersübliche Obergrenze nicht', () => {
  const band = bandForAge(430);
  const plan = buildPlan({
    band,
    morningWake: at(6, 30),
    sleeps: [{ id: 'spaet', type: 'nap', start: at(16, 30), end: at(18, 0) }],
    now: at(18, 0)
  });
  const grenze = timeOnDay(at(6, 30), band.bedtimeLatest);
  assert.ok(plan.bedtime <= grenze, 'nie später als die späteste Bettzeit des Alters');
});

test('Nach einem späten ersten Nickerchen wird kein zweites mehr geplant', () => {
  const band = bandForAge(430);
  const spaet = buildPlan({
    band,
    morningWake: at(6, 30),
    sleeps: [{ id: 'a', type: 'nap', start: at(13, 0), end: at(14, 30) }],
    now: at(14, 30)
  });
  assert.equal(
    spaet.blocks.filter((b) => b.type === 'nap' && !b.actual).length,
    0,
    'danach ist kein Nickerchen mehr unterzubringen'
  );

  const frueh = buildPlan({
    band,
    morningWake: at(6, 30),
    sleeps: [{ id: 'a', type: 'nap', start: at(9, 30), end: at(10, 30) }],
    now: at(10, 30)
  });
  assert.equal(
    frueh.blocks.filter((b) => b.type === 'nap' && !b.actual).length,
    1,
    'nach einem frühen ersten Nickerchen passt noch eines'
  );
});

test('Fehlende Naechte werden gefunden, aber keine erfundenen', () => {
  const sleeps = [
    // 15.: Nickerchen und Nacht - vollständig
    { id: 'a', type: 'nap', start: at(11, 0), end: at(12, 0) },
    { id: 'n1', type: 'night', start: at(19, 0), end: at(6, 30, 16) },
    // 16.: nur ein Nickerchen, die Nacht fehlt
    { id: 'b', type: 'nap', start: at(11, 0, 16), end: at(12, 0, 16) },
    // 17.: wieder mit Nacht
    { id: 'c', type: 'nap', start: at(11, 0, 17), end: at(12, 0, 17) },
    { id: 'n2', type: 'night', start: at(19, 0, 17), end: at(6, 30, 18) }
  ];
  const luecken = findMissingNights(sleeps, at(12, 0, 18));
  assert.equal(luecken.length, 1, 'genau der 16.');
  assert.equal(luecken[0].getDate(), 16);
});

test('Tage ohne Eintraege gelten nicht als Luecke', () => {
  const sleeps = [
    { id: 'a', type: 'nap', start: at(11, 0), end: at(12, 0) },
    { id: 'n', type: 'night', start: at(19, 0), end: at(6, 30, 16) }
  ];
  // Der 16. hat nur das Nachtende, danach nichts mehr - keine Meldung.
  assert.deepEqual(findMissingNights(sleeps, at(12, 0, 20)), []);
});

test('Der laufende Abend wird nicht als Luecke gemeldet', () => {
  const sleeps = [
    { id: 'a', type: 'nap', start: at(11, 0), end: at(12, 0) },
    { id: 'n', type: 'night', start: at(19, 0), end: at(6, 30, 16) },
    { id: 'b', type: 'nap', start: at(11, 0, 16), end: at(12, 0, 16) }
  ];
  // Es ist der 16. am Abend - die heutige Nacht kann noch kommen.
  assert.deepEqual(findMissingNights(sleeps, at(20, 0, 16)), []);
});

test('Die Nachtbilanz zieht den Tagschlaf vom Tagesbedarf ab', () => {
  // Lias 31.08.: 2 Std 6 Min Tagschlaf, Bett 19:20, Aufstehen 07:35
  const b = nightBalance({
    need24h: 767,
    dayMinutes: 126,
    bedtime: at(19, 20),
    morningWake: at(7, 35)
  });
  assert.equal(b.nightNeed, 641, 'Bedarf minus Tagschlaf');
  assert.equal(b.inBed, 735, 'von 19:20 bis 07:35');
  assert.equal(b.surplus, 94, 'gut anderthalb Stunden mehr Bett als Bedarf');
  assert.equal(fmtTime(b.wakeAt), '06:01', 'rechnerisches Nachtende');
});

test('Ohne Überhang meldet die Bilanz keinen', () => {
  const b = nightBalance({
    need24h: 767,
    dayMinutes: 80,
    bedtime: at(19, 3),
    morningWake: at(6, 30)
  });
  assert.ok(Math.abs(b.surplus) <= 5, `kein nennenswerter Überhang: ${b.surplus}`);
});

test('Der Nickerchen-Deckel schützt die Nachtzeit', () => {
  // Übliche Nacht 11:10, Bedarf 12:47 -> für den Tag bleiben 1:37
  const c = napCap({ need24h: 767, nightMinutes: 670, sleptToday: 0, napStart: at(11, 15) });
  assert.equal(c.maxDay, 97);
  assert.equal(fmtTime(c.at), '12:52');
  assert.equal(c.nightNeed, 670);

  // Hat das Kind schon geschlafen, bleibt weniger übrig - unter 45 Minuten
  // wird gar nicht erst geweckt.
  assert.equal(napCap({ need24h: 767, nightMinutes: 670, sleptToday: 60, napStart: at(14, 0) }), null);
});

test('Ohne gelernten Bedarf gibt es keine Weckempfehlung', () => {
  assert.equal(
    napCap({ need24h: null, nightMinutes: 670, napStart: at(11, 0) }),
    null
  );
});

/* ------------------------------------------- Wachphasen und ihr Nachspiel */

// Nacht vom 14. auf den 15.: 19:00 bis 06:00, also 11 Stunden im Bett.
const nacht = (interruptions) => ({
  type: 'night',
  start: at(19, 0, 14),
  end: at(6, 0, 15),
  interruptions
});

test('Wachphasen werden nach ihrer Lage in der Nacht eingeordnet', () => {
  const n = nacht([]);
  // Kurz nach dem Einschlafen: noch nicht müde genug.
  assert.equal(classifyWaking(n.start, n.end, { start: at(20, 30, 14), end: at(21, 0, 14) }), 'frueh');
  // Genau an der Drei-Stunden-Grenze zählt noch als früh.
  assert.equal(classifyWaking(n.start, n.end, { start: at(22, 0, 14), end: at(22, 20, 14) }), 'frueh');
  // Mitten in der Nacht.
  assert.equal(classifyWaking(n.start, n.end, { start: at(1, 0, 15), end: at(1, 30, 15) }), 'mitte');
  // Gegen Morgen: endet weniger als 2,5 Stunden vor dem Aufstehen.
  assert.equal(classifyWaking(n.start, n.end, { start: at(4, 0, 15), end: at(4, 30, 15) }), 'spaet');
});

test('Eine offene Wachphase wird am erwarteten Nachtende gemessen', () => {
  const n = nacht([]);
  assert.equal(classifyWaking(n.start, n.end, { start: at(4, 30, 15), end: null }), 'spaet');
});

test('Das Minus der Nacht zählt gegen die übliche Nacht, nicht gegen eine Norm', () => {
  // 11 Stunden im Bett, 1:45 davon wach -> 9:15 Schlaf gegenüber üblichen 11:00.
  const m = nightDebt(nacht([{ start: at(0, 30, 15), end: at(2, 15, 15) }]), 660);
  assert.equal(m.awake, 105);
  assert.equal(m.slept, 555);
  assert.equal(m.debt, 105);

  // War die Nacht ohnehin länger als üblich, bleibt trotz Wachphase kein Minus.
  assert.equal(nightDebt(nacht([{ start: at(0, 30, 15), end: at(1, 0, 15) }]), 600).debt, 0);
});

test('Ohne übliche Nachtlänge gibt es kein Minus', () => {
  assert.equal(nightDebt(nacht([]), 0), null);
  assert.equal(nightDebt(null, 660), null);
});

test('Ein Schlafminus wird zur Hälfte auf Nickerchen und Bettzeit verteilt', () => {
  const a = catchUpFor(50);
  assert.equal(a.nap, 25);
  assert.equal(a.bedtime, 25);
  // Ein großes Minus wird gedeckelt: der Rhythmus soll nicht kippen.
  assert.equal(catchUpFor(105).nap, 45);
  assert.equal(catchUpFor(105).bedtime, 30);
  // Kleine Abweichungen sind kein Fall für eine Empfehlung.
  assert.equal(catchUpFor(20), null);
  assert.equal(catchUpFor(0), null);
  // Der Nickerchen-Anteil ist bei 45 Minuten gedeckelt.
  assert.equal(catchUpFor(240).nap, 45);
});

test('Nach einer kurzen Nacht darf das Nickerchen länger dauern', () => {
  const ohne = napCap({ need24h: 767, nightMinutes: 670, sleptToday: 0, napStart: at(11, 15) });
  const mit = napCap({ need24h: 767, nightMinutes: 670, sleptToday: 0, napStart: at(11, 15), bonus: 45 });
  assert.equal(mit.maxDay - ohne.maxDay, 45);
  assert.equal(fmtTime(mit.at), '13:37');
});

test('Bei Wachphasen am Rand der Nacht bleibt die Bettzeit, wo sie ist', () => {
  // Gegen Morgen und kurz nach dem Einschlafen: ein früherer Abend verlängert
  // nur die Zeit im Bett - das Minus geht ganz auf das Nickerchen.
  for (const lage of ['spaet', 'frueh']) {
    const a = catchUpFor(105, lage);
    assert.equal(a.bedtime, 0, lage);
    assert.equal(a.nap, 60, lage);
  }
  // Mitten in der Nacht wird weiter aufgeteilt.
  assert.equal(catchUpFor(105, 'mitte').bedtime, 30);
  assert.equal(catchUpFor(105, 'mitte').nap, 45);
});

test('Eine Untergrenze hält die Bettzeit, während der Tag vorrückt', () => {
  const band = bandForAge(450);
  const morningWake = at(6, 15);
  const args = { band, morningWake, sleeps: [], now: at(7, 0), pressureMinutes: -30 };
  const normal = buildPlan(args);
  const geschont = buildPlan({ ...args, bedtimeNotBefore: at(19, 10) });

  // Der Tag rückt in beiden Fällen gleich vor ...
  const erstesNickerchen = (p) => p.blocks.find((b) => b.type === 'nap').start;
  assert.equal(+erstesNickerchen(normal), +erstesNickerchen(geschont));
  // ... nur der Abend bleibt stehen.
  assert.ok(normal.bedtime < at(19, 10));
  assert.equal(fmtTime(geschont.bedtime), '19:10');

  // Eine Untergrenze, die ohnehin früher liegt, ändert nichts.
  assert.equal(+buildPlan({ ...args, bedtimeNotBefore: at(16, 0) }).bedtime, +normal.bedtime);
});

/* -------------------------------------------- Bettzeit aus dem Schlafbudget */

test('Die Bettzeit aus dem Budget lässt Zeit zum Einschlafen', () => {
  // Bedarf 12:47, davon 1:46 mittags -> 11:01 Nacht. Aufstehen 06:30.
  const b = bedtimeFromBudget({ need24h: 767, dayMinutes: 106, morningWake: at(6, 30) });
  assert.equal(fmtTime(b), '19:09'); // 06:30 - 11:01 - 20 Min Einschlafzeit
  // Ein längeres Nickerchen verschiebt die Bettzeit nach hinten, nicht nach vorn.
  assert.ok(bedtimeFromBudget({ need24h: 767, dayMinutes: 150, morningWake: at(6, 30) }) > b);
  assert.equal(bedtimeFromBudget({ need24h: null, morningWake: at(6, 30) }), null);
});

test('Ein Nickerchen, dessen Ende den Abend auffrisst, wird nicht geplant', () => {
  const band = bandForAge(450);
  // Erstes Nickerchen bis 15:30: danach reicht die Wachzeit nicht mehr für
  // ein zweites plus einen Abend.
  const plan = buildPlan({
    band,
    morningWake: at(6, 15),
    sleeps: [{ type: 'nap', start: at(13, 30), end: at(15, 30) }],
    now: at(15, 45)
  });
  assert.equal(plan.plannedNaps, 1);
  assert.ok(plan.bedtime <= timeOnDay(at(6, 15), band.bedtimeLatest));
});

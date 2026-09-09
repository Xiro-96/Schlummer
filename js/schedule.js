/**
 * Reine Rechenlogik für Alter, Wachfenster und Tagesplan.
 * Kein DOM-Zugriff - damit die Funktionen auch im Test laufen.
 */
import { AGE_BANDS } from './data.js';

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Tage zwischen zwei Zeitpunkten (kalendarisch, ohne Uhrzeitanteil). */
export function daysBetween(from, to) {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / DAY);
}

/**
 * Alter in Tagen. Ist ein Geburtstermin (dueDate) hinterlegt und lag dieser
 * nach der Geburt, wird bis zum 2. Geburtstag das korrigierte Alter benutzt -
 * so rechnen Schlafberatungen bei Frühgeborenen.
 */
export function ageInDays(birthDate, dueDate, now = new Date()) {
  const chronological = Math.max(0, daysBetween(birthDate, now));
  if (!dueDate) return chronological;
  const corrected = daysBetween(dueDate, now);
  if (corrected >= chronological) return chronological;
  return chronological > 730 ? chronological : Math.max(0, corrected);
}

/** Passendes Altersband zu einem Alter in Tagen. */
export function bandForAge(days) {
  let match = AGE_BANDS[0];
  for (const band of AGE_BANDS) {
    if (days >= band.minAgeDays) match = band;
  }
  return match;
}

/** Menschenlesbares Alter, z. B. "4 Monate, 2 Wochen". */
export function formatAge(days) {
  if (days < 14) return `${days} ${days === 1 ? 'Tag' : 'Tage'}`;
  if (days < 61) {
    const weeks = Math.floor(days / 7);
    return `${weeks} Wochen`;
  }
  const months = Math.floor(days / 30.44);
  if (months < 24) {
    const restWeeks = Math.floor((days - months * 30.44) / 7);
    return restWeeks > 0
      ? `${months} Monate, ${restWeeks} ${restWeeks === 1 ? 'Woche' : 'Wochen'}`
      : `${months} Monate`;
  }
  const years = Math.floor(days / 365.25);
  const restMonths = Math.floor((days - years * 365.25) / 30.44);
  return restMonths > 0 ? `${years} J., ${restMonths} Mon.` : `${years} Jahre`;
}

/**
 * Wachfenster für das n-te Wachfenster des Tages.
 * Das erste ist am kürzesten, das letzte vor der Nacht am längsten -
 * so machen es die gängigen Wachfenster-Tabellen auch.
 */
export function wakeWindowFor(band, index, totalWindows) {
  const min = band.wakeWindowMin;
  const max = band.wakeWindowMax;
  if (totalWindows <= 1) return max;
  const ratio = Math.min(1, Math.max(0, index / (totalWindows - 1)));
  return Math.round(min + (max - min) * ratio);
}

/** "07:30" -> Date am selben Kalendertag wie ref. */
export function timeOnDay(ref, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), h, m, 0, 0);
  return d;
}

export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * MINUTE);
}

export function minutesBetween(a, b) {
  return Math.round((b - a) / MINUTE);
}

export function fmtTime(date) {
  return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(date);
}

/** 95 -> "1 Std 35 Min", 40 -> "40 Min" */
export function fmtDuration(minutes) {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} Min`;
  if (m === 0) return `${h} Std`;
  return `${h} Std ${m} Min`;
}

/** Ganze Tage seit einem Zeitpunkt (null, wenn es keinen gibt). */
export function daysSince(iso, now = new Date()) {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  return Math.max(0, Math.floor((now - then) / DAY));
}

/** Sehr kurze Dauer für große Zahlen: 84 -> "1h 24m", 45 -> "45m" */
export function fmtCompact(minutes) {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Kompakte Dauer für Kennzahlen: 799 -> "13:19 h" */
export function fmtShort(minutes) {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, '0')} h`;
}

/** Countdown-Format mm:ss bzw. h:mm:ss */
export function fmtCountdown(ms) {
  const negative = ms < 0;
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const body = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return negative ? `+${body}` : body;
}

/**
 * Erzeugt den Tagesplan.
 *
 * @param {object} opts
 * @param {object} opts.band          Altersband
 * @param {Date}   opts.morningWake   Aufwachzeit am Morgen
 * @param {Array}  opts.sleeps        Bereits erfasste Tagschlaf-Einträge
 *                                    ({start, end} als Date, end optional = läuft noch)
 * @param {Date}   opts.now           Jetzt-Zeitpunkt
 * @param {number} opts.pressureMinutes Korrektur der noch geplanten
 *        Wachfenster durch den Schlafdruck des Tages (negativ = kürzer)
 * @param {Date} [opts.bedtimeNotBefore] Untergrenze für die Bettzeit. Ein
 *        Schlafminus spricht nicht immer für einen früheren Abend: lag das
 *        Kind kurz nach dem Einschlafen oder gegen Morgen wach, verlängert
 *        ein früherer Beginn der Nacht nur die Zeit im Bett.
 * @returns {{blocks: Array, bedtime: Date, dayTimeSleepMin: number, plannedNaps: number}}
 */
export function buildPlan({
  band,
  morningWake,
  sleeps = [],
  now = new Date(),
  pressureMinutes = 0,
  bedtimeNotBefore = null
}) {
  // Die Nacht dieses Abends: egal ob sie noch läuft oder schon beendet ist
  // (etwa weil das Kind kurz wach war). Sie beendet den geplanten Tag.
  const nights = sleeps
    .filter((s) => s.type === 'night' && (!s.end || s.start >= morningWake))
    .sort((a, b) => a.start - b.start);
  const eveningNight = nights[0] || null;
  const finished = sleeps
    .filter((s) => s.end && s.type !== 'night')
    .sort((a, b) => a.start - b.start);
  const running = sleeps.find((s) => !s.end && s.type !== 'night') || null;
  const blocks = [];

  let sleptMin = finished.reduce((sum, s) => sum + minutesBetween(s.start, s.end), 0);
  let windowIndex = 0;
  const totalWindows = Math.max(1, band.naps + 1);

  let cursor = morningWake;
  for (const nap of finished) {
    blocks.push({ type: 'wake', start: cursor, end: nap.start, actual: true });
    blocks.push({
      type: 'nap',
      start: nap.start,
      end: nap.end,
      actual: true,
      // Die id wandert mit, damit der Block im Plan bearbeitet werden kann.
      id: nap.id,
      index: ++windowIndex,
      note: nap.note || ''
    });
    cursor = nap.end;
  }

  if (running) {
    blocks.push({ type: 'wake', start: cursor, end: running.start, actual: true });
    const projectedEnd = addMinutes(running.start, band.napLengthMin);
    const end = projectedEnd > now ? projectedEnd : addMinutes(now, 10);
    blocks.push({
      type: 'nap',
      start: running.start,
      end,
      actual: true,
      running: true,
      id: running.id,
      index: ++windowIndex
    });
    sleptMin += minutesBetween(running.start, now);
    cursor = end;
  }

  if (eveningNight) {
    const nightEnd = nightEndFor(
      eveningNight.start,
      morningWake,
      band,
      nights.reduce((sum, n) => sum + awakeMinutesIn(n, now), 0)
    );
    let last = null;
    for (const night of nights) {
      const first = last === null;
      if (night.start > cursor) {
        blocks.push({
          type: 'wake',
          start: cursor,
          end: night.start,
          actual: true,
          evening: first,
          atNight: !first
        });
      }
      // Beendete Nacht mit ihrem echten Ende, laufende mit der Aufstehprognose.
      const end = night.end || nightEndFor(night.start, morningWake, band, awakeMinutesIn(night, now));
      blocks.push({
        type: 'night',
        start: night.start,
        end,
        actual: true,
        running: !night.end,
        id: night.id,
        interruptions: night.interruptions || [],
        continued: !first
      });
      cursor = end;
      last = night;
    }

    // Endet die letzte erfasste Nacht lange vor der errechneten Aufstehzeit,
    // ist die Nacht nicht vorbei: das Kind ist nachts wach. Der Rest der Nacht
    // bleibt im Plan - sonst stuende am Abend "nichts mehr geplant".
    // Wer dagegen fast durchgeschlafen hat, ist morgens einfach wach.
    const nightSlept = nights
      .filter((n) => n.end)
      .reduce((sum, n) => sum + minutesBetween(n.start, n.end), 0);
    const restlicheNacht = last.end ? minutesBetween(now, nightEnd) : 0;
    if (last.end && nightSlept < band.nightSleepMin * 0.7 && restlicheNacht >= 45) {
      const back = last.end > now ? last.end : now;
      if (minutesBetween(last.end, back) >= 1) {
        blocks.push({ type: 'wake', start: last.end, end: back, actual: true, atNight: true });
      }
      blocks.push({ type: 'night', start: back, end: nightEnd, continuation: true });
    }
    return {
      blocks: blocks.filter((b) => b.type !== 'wake' || b.end > b.start),
      bedtime: eveningNight.start,
      dayTimeSleepMin: sleptMin,
      plannedNaps: windowIndex
    };
  }

  const napsDone = windowIndex;
  let remainingNaps = Math.max(0, band.naps - napsDone);
  let budget = Math.max(0, band.dayTimeSleepMin - sleptMin);

  // Die späteste Bettzeit des Alters - die persönliche Routine darf sie nach
  // hinten verschieben, aber nicht darüber hinaus.
  const ceiling = timeOnDay(morningWake, band.bedtimeCeiling || band.bedtimeLatest);
  // Nach dem letzten Schlaf braucht es eine Mindestwachzeit, sonst ist das
  // Kind zur Bettzeit schlicht nicht müde.
  const lastWindowRaw = Math.max(
    30,
    wakeWindowFor(band, totalWindows - 1, totalWindows) + pressureMinutes
  );
  const minEvening = Math.round(lastWindowRaw * 0.75);

  for (let i = 0; i < remainingNaps; i++) {
    const ww = Math.max(
      30,
      wakeWindowFor(band, Math.min(napsDone + i, totalWindows - 1), totalWindows) + pressureMinutes
    );
    const start = addMinutes(cursor, ww);
    // Ein weiteres Nickerchen lohnt nur, wenn danach noch genug Wachzeit bis
    // zur spätestmöglichen Bettzeit bleibt. Schläft das Kind erst spät, reicht
    // eines - sonst läge es abends wach im Bett.
    if (addMinutes(start, 30 + minEvening) > ceiling) {
      remainingNaps = i;
      break;
    }
    const left = remainingNaps - i;
    const suggested = left > 0 ? budget / left : band.napLengthMin;
    const length = Math.round(Math.min(Math.max(suggested, 30), band.napLengthMin * 1.6));
    const end = addMinutes(start, length);
    blocks.push({ type: 'wake', start: cursor, end: start, actual: false });
    blocks.push({ type: 'nap', start, end, actual: false, index: napsDone + i + 1 });
    budget = Math.max(0, budget - length);
    cursor = end;
  }

  // Bettzeit: letztes (längstes) Wachfenster, aber im plausiblen Abendfenster.
  const lastWindow = Math.max(
    30,
    wakeWindowFor(band, totalWindows - 1, totalWindows) + pressureMinutes
  );
  let bedtime = addMinutes(cursor, lastWindow);
  // Bei echtem Schlafdefizit darf die Bettzeit unter die übliche Untergrenze
  // rutschen - genau dafür ist eine frühe Bettzeit da. Nie vor 17:30.
  const floor = timeOnDay(morningWake, band.bedtimeEarliest);
  let earliest =
    pressureMinutes < 0
      ? new Date(
          Math.max(
            addMinutes(floor, pressureMinutes).getTime(),
            timeOnDay(morningWake, '17:30').getTime()
          )
        )
      : floor;
  if (bedtimeNotBefore && bedtimeNotBefore > earliest) earliest = new Date(bedtimeNotBefore);
  const latest = timeOnDay(morningWake, band.bedtimeLatest);
  if (bedtime < earliest) bedtime = earliest;
  if (bedtime > latest) bedtime = latest;
  // Hat der letzte Schlaf lange gedauert oder spät geendet, zählt die
  // Mindestwachzeit mehr als die gewohnte Bettzeit: vorher ist das Kind nicht
  // müde. Die altersübliche Obergrenze bleibt trotzdem stehen.
  const nichtMuede = addMinutes(cursor, minEvening);
  if (bedtime < nichtMuede) bedtime = new Date(Math.min(nichtMuede.getTime(), ceiling.getTime()));
  if (bedtime <= addMinutes(cursor, 30)) bedtime = addMinutes(cursor, 30);

  blocks.push({ type: 'wake', start: cursor, end: bedtime, actual: false, evening: true });
  blocks.push({ type: 'night', start: bedtime, end: nightEndFor(bedtime, morningWake, band), actual: false });

  return {
    blocks: blocks.filter((b) => b.type !== 'wake' || b.end > b.start),
    bedtime,
    dayTimeSleepMin: sleptMin,
    plannedNaps: napsDone + remainingNaps
  };
}

/**
 * Wie lange war das Kind in dieser Nacht wach? Summe der erfassten
 * Wachphasen; eine noch offene zählt bis jetzt.
 */
export function awakeMinutesIn(sleep, now = new Date()) {
  let minutes = 0;
  for (const gap of (sleep && sleep.interruptions) || []) {
    const end = gap.end || now;
    if (end > gap.start) minutes += minutesBetween(gap.start, end);
  }
  return Math.round(minutes);
}

/**
 * Wie viel später das Aufstehen nach nächtlichem Wachliegen liegt. Kinder
 * holen einen Teil der Wachzeit am Morgen nach, aber nicht alles: der
 * Rhythmus zieht sie trotzdem zur gewohnten Zeit aus dem Bett. Deshalb die
 * halbe Wachzeit, höchstens eine Stunde.
 */
export function nightShiftFor(awakeMinutes = 0) {
  return Math.min(60, Math.round(Math.max(0, awakeMinutes) / 2));
}

/**
 * Wohin in der Nacht eine Wachphase gehört. Die Lage sagt mehr als die Dauer,
 * denn die drei Gruppen haben verschiedene Ursachen:
 *
 *   früh  - kurz nach dem Einschlafen wieder wach. Das Kind war meist noch
 *           nicht müde genug: zu früh ins Bett oder zu viel Tagschlaf.
 *   spät  - kurz vor der gewohnten Aufstehzeit. Die Nacht ist rechnerisch
 *           fast voll; früher ins Bett verschärft das eher.
 *   Mitte - dazwischen. Über die Zeiten meist nicht zu erklären.
 *
 * @param {Date} bedtime      Beginn der Nacht
 * @param {Date} morningEnd   Ende der Nacht (tatsächlich oder erwartet)
 * @param {object} gap        Wachphase mit start/end
 * @returns {'frueh'|'mitte'|'spaet'}
 */
export function classifyWaking(bedtime, morningEnd, gap) {
  const end = gap.end || morningEnd;
  if (minutesBetween(bedtime, gap.start) <= 3 * 60) return 'frueh';
  if (minutesBetween(end, morningEnd) <= 150) return 'spaet';
  return 'mitte';
}

/**
 * Was die vergangene Nacht gegenüber einer gewöhnlichen Nacht gekostet hat.
 *
 * Gerechnet wird gegen die Nacht, die diese Familie sonst hat - nicht gegen
 * einen Richtwert. Eine Nacht, die ohnehin länger war als üblich, hinterlässt
 * trotz Wachphase kein Minus.
 *
 * @param {object} night      Nachteintrag mit Date-Objekten
 * @param {number} usualNight übliche Nachtlänge in Minuten
 * @param {Date}   [now]      für eine noch laufende Nacht
 * @returns {null|{awake:number, slept:number, usual:number, debt:number}}
 */
export function nightDebt(night, usualNight, now = new Date()) {
  if (!night || !usualNight) return null;
  const end = night.end || now;
  const awake = awakeMinutesIn(night, now);
  const slept = Math.max(0, minutesBetween(night.start, end) - awake);
  return {
    awake,
    slept: Math.round(slept),
    usual: Math.round(usualNight),
    debt: Math.max(0, Math.round(usualNight - slept))
  };
}

/**
 * Wie ein Schlafminus über den Tag hereingeholt wird.
 *
 * Nicht alles auf einmal: ein sehr langes Nickerchen nimmt der nächsten Nacht
 * wieder Zeit und trägt das Problem weiter. Deshalb die Hälfte über ein
 * längeres Nickerchen, die andere Hälfte über eine frühere Bettzeit - beides
 * begrenzt, damit der Rhythmus nicht kippt.
 *
 * Die Ausnahme sind Wachphasen am Rand der Nacht. Wer schon um vier wach im
 * Bett liegt, liegt nicht deshalb wach, weil er zu spät hineingekommen ist -
 * und wer eine Stunde nach dem Einschlafen wieder aufwacht, war noch nicht
 * müde genug. In beiden Fällen verlängert ein früherer Beginn der Nacht nur
 * die Zeit im Bett. Das Minus geht dann ganz auf das Nickerchen.
 *
 * @param {number} debt    Fehlminuten der letzten Nacht
 * @param {string} [lage]  Lage der Wachphase: 'frueh' | 'mitte' | 'spaet'
 * @returns {null|{nap:number, bedtime:number, debt:number, lage:string|null}}
 */
export function catchUpFor(debt = 0, lage = null) {
  if (!debt || debt < 30) return null;
  const rund = (minuten, deckel) => Math.min(deckel, Math.round(minuten / 5) * 5);
  if (lage === 'spaet' || lage === 'frueh') {
    return { debt: Math.round(debt), nap: rund(debt, 60), bedtime: 0, lage };
  }
  return {
    debt: Math.round(debt),
    nap: rund(debt / 2, 45),
    bedtime: rund(debt / 2, 30),
    lage
  };
}

/**
 * Ende des Nachtschlafs: bis zur üblichen Aufwachzeit am nächsten Morgen,
 * nicht stur Bettzeit plus Norm-Nachtschlaf. Sonst steht bei früher Bettzeit
 * ein unsinniges "05:30" im Plan. Sehr kurze oder sehr lange Nächte werden
 * auf einen plausiblen Rahmen begrenzt. Nächtliches Wachliegen schiebt das
 * Aufstehen nach hinten.
 */
export function nightEndFor(bedtime, morningWake, band, awakeMinutes = 0) {
  const shift = nightShiftFor(awakeMinutes);
  const target = new Date(bedtime);
  target.setHours(morningWake.getHours(), morningWake.getMinutes(), 0, 0);
  if (target <= bedtime) target.setDate(target.getDate() + 1);
  const minutes = minutesBetween(bedtime, target);
  const min = Math.min(9 * 60, band.nightSleepMin);
  const max = Math.max(13 * 60, band.nightSleepMin);
  if (minutes < min || minutes > max) {
    return addMinutes(bedtime, band.nightSleepMin + shift);
  }
  return addMinutes(target, shift);
}

/** Nächster geplanter Schlaf-Block nach "jetzt". */
export function nextSleepBlock(plan, now = new Date()) {
  return plan.blocks.find((b) => b.type !== 'wake' && !b.actual && b.start > now) || null;
}

/**
 * Status für die Startseite: wie lange ist das Kind schon wach und wie weit
 * ist es im aktuellen Wachfenster (0..1+).
 */
export function wakeStatus({ band, lastWakeUp, sleeps, now = new Date() }) {
  const running = sleeps.find((s) => !s.end);
  // Nachts kurz wach: Das Kind ist wach, die Nacht läuft aber weiter -
  // ein eigener Zustand, kein Tagesbeginn.
  const gap = running ? (running.interruptions || []).find((i) => !i.end) : null;
  if (gap) {
    return {
      sleeping: false,
      nightWaking: true,
      night: true,
      since: gap.start,
      nightStart: running.start,
      minutes: minutesBetween(gap.start, now),
      target: 60,
      progress: minutesBetween(gap.start, now) / 60
    };
  }
  if (running) {
    // Eine Nacht misst sich an der Nachtschlafdauer, nicht an der Länge
    // eines Nickerchens.
    const target = running.type === 'night' ? band.nightSleepMin : band.napLengthMin;
    const minutes = minutesBetween(running.start, now);
    return {
      sleeping: true,
      night: running.type === 'night',
      since: running.start,
      minutes,
      target,
      progress: minutes / target
    };
  }
  const napsDone = sleeps.filter((s) => s.end).length;
  const totalWindows = Math.max(1, band.naps + 1);
  const ww = wakeWindowFor(band, Math.min(napsDone, totalWindows - 1), totalWindows);
  const awake = minutesBetween(lastWakeUp, now);
  return {
    sleeping: false,
    since: lastWakeUp,
    minutes: awake,
    target: ww,
    windowEnd: addMinutes(lastWakeUp, ww),
    progress: awake / ww
  };
}

/**
 * Rückblick auf einen einzelnen Tag: was tatsächlich passiert ist. Kein
 * Planen, kein Vorhersagen - nur die erfassten Zeiten in der Reihenfolge des
 * Tages, damit man später nachsehen kann, wie der Tag lief.
 *
 * @param {object}   o
 * @param {object[]} o.sleeps       alle Einträge (Date-Objekte)
 * @param {Date}     o.day          der Tag, um den es geht
 * @param {Date}     [o.morningWake] Aufstehzeit, falls bekannt
 */
export function buildDayReview({ sleeps = [], day = new Date(), morningWake = null }) {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const dayEnd = addMinutes(dayStart, 24 * 60);
  const inDay = (date) => date >= dayStart && date < dayEnd;

  const naps = sleeps
    .filter((s) => s.type === 'nap' && inDay(s.start))
    .sort((a, b) => a.start - b.start);
  const nights = sleeps.filter((s) => s.type === 'night').sort((a, b) => a.start - b.start);
  // Die Nacht, aus der dieser Tag begonnen hat, und die, die ihn beendet.
  const nightBefore = nights.filter((n) => n.end && inDay(n.end)).pop() || null;
  const evening = nights.find((n) => inDay(n.start)) || null;
  const wake = morningWake || (nightBefore ? nightBefore.end : dayStart);

  const blocks = [];
  let cursor = wake;
  let index = 0;
  for (const nap of naps) {
    if (nap.start > cursor) {
      blocks.push({ type: 'wake', start: cursor, end: nap.start, actual: true });
    }
    const end = nap.end || dayEnd;
    blocks.push({
      type: 'nap',
      start: nap.start,
      end,
      actual: true,
      running: !nap.end,
      id: nap.id,
      index: ++index
    });
    cursor = end;
  }
  if (evening) {
    if (evening.start > cursor) {
      blocks.push({ type: 'wake', start: cursor, end: evening.start, actual: true, evening: true });
    }
    blocks.push({
      type: 'night',
      start: evening.start,
      end: evening.end || dayEnd,
      actual: true,
      running: !evening.end,
      id: evening.id,
      interruptions: evening.interruptions || []
    });
  }

  const netto = (sleep) => {
    if (!sleep) return 0;
    const end = sleep.end || dayEnd;
    return Math.max(0, minutesBetween(sleep.start, end) - awakeMinutesIn(sleep, end));
  };
  const napMinutes = naps.reduce((sum, n) => sum + netto(n), 0);
  const nightBeforeMinutes = netto(nightBefore);

  return {
    day: dayStart,
    morningWake: wake,
    naps,
    evening,
    nightBefore,
    bedtime: evening ? evening.start : null,
    blocks: blocks.filter((b) => b.type !== 'wake' || b.end > b.start),
    napMinutes: Math.round(napMinutes),
    nightBeforeMinutes: Math.round(nightBeforeMinutes),
    nightMinutes: Math.round(netto(evening)),
    totalMinutes: Math.round(napMinutes + nightBeforeMinutes),
    wakings: awakeMinutesIn(nightBefore || {}, dayEnd),
    hasData: Boolean(naps.length || evening || nightBefore)
  };
}

/**
 * Findet Einträge, die so nicht stimmen können: doppelte oder überlappende
 * Schläfe und Nächte mit unmöglicher Länge. Solche Reste entstehen durch
 * Fehltipps und verfälschen alles, was daraus gelernt wird.
 *
 * @param {object[]} sleeps Einträge mit Date-Objekten
 * @returns {Array<{id: string, grund: string, text: string, sleep: object}>}
 */
export function findConflicts(sleeps = [], now = new Date()) {
  const fertig = sleeps
    .filter((s) => s.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const treffer = new Map();
  const melde = (sleep, grund, text) => {
    if (!treffer.has(sleep.id)) treffer.set(sleep.id, { id: sleep.id, grund, text, sleep });
  };

  for (const s of fertig) {
    const minuten = minutesBetween(s.start, s.end);
    if (s.type === 'night') {
      if (minuten > 15 * 60) melde(s, 'zu-lang', `Nacht über ${Math.round(minuten / 60)} Stunden`);
      else if (minuten < 3 * 60) melde(s, 'zu-kurz', `Nacht von nur ${Math.round(minuten)} Minuten`);
    } else if (minuten > 5 * 60) {
      melde(s, 'zu-lang', `Nickerchen über ${Math.round(minuten / 60)} Stunden`);
    }
    if (s.end > now) melde(s, 'zukunft', 'Ende liegt in der Zukunft');
  }

  for (let i = 0; i < fertig.length; i++) {
    for (let j = i + 1; j < fertig.length; j++) {
      const a = fertig[i];
      const b = fertig[j];
      if (b.start >= a.end) break;
      const gleich = +a.start === +b.start && +a.end === +b.end;
      melde(
        b,
        gleich ? 'doppelt' : 'ueberlappt',
        gleich ? 'Genau derselbe Eintrag zweimal' : 'Überschneidet sich mit einem anderen Eintrag'
      );
    }
  }
  return [...treffer.values()].sort((a, b) => a.sleep.start - b.sleep.start);
}

/**
 * Nächte, die im Protokoll fehlen: Tage mit Einträgen, an deren Abend keine
 * Nacht beginnt, obwohl es am Tag danach weitergeht. Ohne sie kennt die App
 * weder Bettzeit noch Aufstehzeit - der Tag zählt beim Lernen kaum mit.
 *
 * @param {object[]} sleeps Einträge mit Date-Objekten
 * @param {Date}     now
 * @param {number}   tage   wie weit zurück geschaut wird
 * @returns {Date[]} Abende ohne Nacht, neueste zuerst
 */
export function findMissingNights(sleeps = [], now = new Date(), tage = 14) {
  const heute = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const key = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const beginntNacht = new Set();
  const hatEintrag = new Set();
  for (const s of sleeps) {
    hatEintrag.add(key(s.start));
    if (s.end) hatEintrag.add(key(s.end));
    if (s.type === 'night') beginntNacht.add(key(s.start));
  }
  const luecken = [];
  // Der gestrige Abend ist der jüngste, der schon vorbei sein kann.
  for (let i = 1; i <= tage; i++) {
    const tag = new Date(heute);
    tag.setDate(tag.getDate() - i);
    const naechster = new Date(tag);
    naechster.setDate(naechster.getDate() + 1);
    if (!hatEintrag.has(key(tag)) || !hatEintrag.has(key(naechster))) continue;
    if (!beginntNacht.has(key(tag))) luecken.push(tag);
  }
  return luecken;
}

/**
 * Die Schlafbilanz eines Tages: Was tagsüber geschlafen wird, fehlt nachts.
 * Liegt das Kind länger im Bett, als sein Bedarf hergibt, wird der Überhang
 * zu Wachzeit - meist in den frühen Morgenstunden.
 *
 * @param {object} o
 * @param {number} o.need24h      gelernter Tagesbedarf in Minuten
 * @param {number} o.dayMinutes   bisheriger Tagschlaf in Minuten
 * @param {Date}   o.bedtime      geplante oder erfasste Bettzeit
 * @param {Date}   o.morningWake  gewünschte Aufstehzeit am nächsten Morgen
 * @returns {{nightNeed:number, inBed:number, surplus:number, wakeAt:Date}}
 */
export function nightBalance({ need24h, dayMinutes = 0, bedtime, morningWake }) {
  const nightNeed = Math.max(0, need24h - dayMinutes);
  const ziel = new Date(bedtime);
  ziel.setHours(morningWake.getHours(), morningWake.getMinutes(), 0, 0);
  if (ziel <= bedtime) ziel.setDate(ziel.getDate() + 1);
  const inBed = minutesBetween(bedtime, ziel);
  return {
    dayMinutes: Math.round(dayMinutes),
    nightNeed: Math.round(nightNeed),
    inBed: Math.round(inBed),
    surplus: Math.round(inBed - nightNeed),
    // Wann die Nacht rechnerisch zu Ende ist, wenn sie zur Bettzeit einschläft.
    wakeAt: addMinutes(bedtime, nightNeed)
  };
}

/**
 * Bis wann darf das laufende Nickerchen dauern, damit die Nacht ihre Zeit
 * behält? Ergebnis ist eine Weckempfehlung - oder null, wenn noch reichlich
 * Luft ist oder die Daten dafür nicht reichen.
 *
 * Bezug ist die Nacht, die die Familie üblicherweise hat - nicht die längste
 * mögliche. Sonst bliebe dem Tag rechnerisch nichts übrig.
 *
 * @param {object} o
 * @param {number} o.need24h       gelernter Tagesbedarf
 * @param {number} o.nightMinutes  übliche Nachtlänge dieser Familie
 * @param {number} o.sleptToday    schon geschlafener Tagschlaf (ohne das laufende)
 * @param {Date}   o.napStart      Beginn des laufenden Nickerchens
 * @param {number} [o.minNap=45]   so kurz wird nie geweckt
 * @param {number} [o.bonus=0]     Nachholminuten nach einer kurzen Nacht
 * @returns {null|{at:Date, maxDay:number, nightNeed:number}}
 */
export function napCap({ need24h, nightMinutes, sleptToday = 0, napStart, minNap = 45, bonus = 0 }) {
  if (!need24h || !nightMinutes || !napStart) return null;
  // War die letzte Nacht kurz, darf der Tag heute mehr bekommen: die
  // fehlenden Minuten sind schon weg, die holt die nächste Nacht nicht nach.
  const maxDay = Math.round(need24h - nightMinutes + Math.max(0, bonus));
  if (maxDay <= 0) return null;
  const rest = maxDay - sleptToday;
  if (rest < minNap) return null;
  return { at: addMinutes(napStart, rest), maxDay, nightNeed: Math.round(nightMinutes) };
}

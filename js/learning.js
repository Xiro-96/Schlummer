/**
 * Lernen aus den eigenen Daten.
 *
 * Die Altersbänder aus data.js sind der Startwert. Sobald genug eigene
 * Einträge vorliegen, werden daraus die tatsächlichen Wachfenster,
 * Nickerchenlängen und die Anzahl der Nickerchen geschätzt und mit dem
 * Altersband verrechnet: wenige Daten -> fast nur Altersband, viele Daten ->
 * fast nur eigenes Kind (Shrinkage). Jüngere Tage zählen mehr als ältere.
 *
 * Reine Funktionen, keine Speicher- oder DOM-Zugriffe.
 */
import { DAY, minutesBetween } from './schedule.js';

/** Zeitraum, aus dem gelernt wird. */
export const LEARN_WINDOW_DAYS = 21;
/** Nach so vielen Tagen zählt ein Tag nur noch halb. */
export const HALF_LIFE_DAYS = 7;
/** Steuert, wie schnell eigene Daten das Altersband ablösen. */
export const SHRINKAGE_K = 4;
/** Kürzere Nickerchen gelten als Katzenschläfchen und zählen nicht voll. */
export const MIN_NAP_MINUTES = 10;
export const SOLID_NAP_MINUTES = 20;

/**
 * Bewertete Schläfchen wiegen mehr oder weniger: Was gut lief, ist ein
 * Vorbild für den Plan, was schlecht lief, soll ihn nicht prägen.
 */
export function napQuality(nap, minutes) {
  if (!nap.settle && !nap.mood) return 'unknown';
  const settledWell = nap.settle === 'fast' || nap.settle === 'ok';
  const longEnough = minutes >= SOLID_NAP_MINUTES;
  if (settledWell && longEnough && nap.mood !== 'grumpy') return 'good';
  return 'bad';
}

const QUALITY_WEIGHT = { good: 2, unknown: 1, bad: 0.4 };

/**
 * Richtungskorrektur aus einer Bewertung, in Minuten Wachfenster.
 *
 * Die Logik dahinter: Wer schwer einschläft und trotzdem lange schläft, war
 * noch nicht müde genug - Fenster verlängern. Wer schwer einschläft und dann
 * kurz schläft, war übermüdet - Fenster verkürzen. Schnelles Einschlafen mit
 * kurzem Nickerchen ist ebenfalls ein Übermüdungszeichen.
 */
export function nudgeFor(nap, minutes) {
  const longEnough = minutes >= SOLID_NAP_MINUTES;
  if (nap.settle === 'slow') return longEnough ? 12 : -12;
  if (nap.settle === 'fast' && !longEnough) return -8;
  if (nap.mood === 'grumpy' && !longEnough) return -6;
  if (nap.settle || nap.mood) return 0;
  return null;
}

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

/** Gewichteter Median - robust gegen einzelne Ausreißertage. */
export function weightedMedian(samples) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, s) => sum + s.weight, 0);
  if (total <= 0) return null;
  let acc = 0;
  for (const s of sorted) {
    acc += s.weight;
    if (acc >= total / 2) return s.value;
  }
  return sorted[sorted.length - 1].value;
}

/**
 * Wie stark streuen die Werte um ihren Median? Gewichteter Median der
 * Abweichungen - unempfindlich gegen einzelne Ausreißer. Damit lässt sich
 * unterscheiden, ob eine Familie eine feste Routine hat oder nicht.
 */
export function weightedSpread(samples) {
  const median = weightedMedian(samples);
  if (median == null) return null;
  return weightedMedian(samples.map((s) => ({ value: Math.abs(s.value - median), weight: s.weight })));
}

/** Summe der Gewichte - das "effektive n" für die Shrinkage. */
function weightSum(samples) {
  return samples.reduce((sum, s) => sum + s.weight, 0);
}

/**
 * Zerlegt das Schlafprotokoll in Lernstichproben.
 * @param {Array} sleeps  Einträge mit Date-Objekten (start, end)
 * @param {Date}  now
 */
export function collectSamples(sleeps, now = new Date()) {
  const from = new Date(now.getTime() - LEARN_WINDOW_DAYS * DAY);
  const finished = sleeps
    .filter((s) => s.end && s.start >= from && s.end <= now)
    .sort((a, b) => a.start - b.start);

  const days = new Map();
  for (const sleep of finished) {
    const key = dayKey(sleep.start);
    if (!days.has(key)) days.set(key, { day: sleep.start, naps: [], night: null, morning: null });
    const entry = days.get(key);
    if (sleep.type === 'night') entry.night = sleep;
    else entry.naps.push(sleep);
  }
  // Morgendliches Aufwachen gehört zum Tag, an dem die Nacht endete.
  for (const sleep of finished) {
    if (sleep.type !== 'night') continue;
    const key = dayKey(sleep.end);
    if (!days.has(key)) days.set(key, { day: sleep.end, naps: [], night: null, morning: null });
    days.get(key).morning = sleep.end;
  }

  const firstWindows = [];
  const lastWindows = [];
  const middleWindows = [];
  const napLengths = [];
  const napCounts = [];
  // Dieselben Stichproben, getrennt nach der Tagesform (Anzahl Nickerchen).
  // Ein Tag mit einem Nickerchen hat ganz andere Wachfenster als einer mit
  // zweien - zusammengeworfen ergibt das einen Wert, der zu keinem passt.
  const byCount = new Map();
  const bucket = (anzahl) => {
    if (!byCount.has(anzahl)) {
      byCount.set(anzahl, {
        firstWindows: [],
        middleWindows: [],
        lastWindows: [],
        napLengths: [],
        firstNapStarts: []
      });
    }
    return byCount.get(anzahl);
  };
  const bedtimes = [];
  const mornings = [];
  const napNudges = [];
  const eveningNudges = [];

  for (const entry of days.values()) {
    const ageDays = (now - entry.day) / DAY;
    const weight = Math.pow(0.5, Math.max(0, ageDays) / HALF_LIFE_DAYS);
    const naps = entry.naps
      .filter((n) => minutesBetween(n.start, n.end) >= MIN_NAP_MINUTES)
      .sort((a, b) => a.start - b.start);
    const form = bucket(naps.length);
    // Wann das erste Nickerchen begann, verrät die Tagesform: früh los heißt
    // meist, dass noch eines folgt; spät los heißt, dass eines reicht.
    if (naps.length) {
      form.firstNapStarts.push({ value: minutesOfDay(naps[0].start), weight });
    }

    if (entry.morning) mornings.push({ value: minutesOfDay(entry.morning), weight });
    if (entry.night && minutesOfDay(entry.night.start) >= 16 * 60) {
      bedtimes.push({ value: minutesOfDay(entry.night.start), weight });
    }
    // Nur abgeschlossene Tage zählen für die Anzahl der Nickerchen.
    if (naps.length && dayKey(entry.day) !== dayKey(now)) {
      napCounts.push({ value: naps.length, weight });
    }

    let previousEnd = entry.morning || null;
    naps.forEach((nap, index) => {
      const minutes = minutesBetween(nap.start, nap.end);
      const quality = napQuality(nap, minutes);
      const qualityWeight = weight * QUALITY_WEIGHT[quality];
      napLengths.push({ value: minutes, weight: qualityWeight });
      form.napLengths.push({ value: minutes, weight: qualityWeight });

      if (previousEnd) {
        const window = minutesBetween(previousEnd, nap.start);
        // Nur plausible Wachfenster vor einem echten Nickerchen lernen.
        if (window >= 15 && window <= 8 * 60) {
          if (minutes >= SOLID_NAP_MINUTES) {
            const sample = { value: window, weight: qualityWeight };
            if (index === 0) {
              firstWindows.push(sample);
              form.firstWindows.push(sample);
            } else {
              middleWindows.push(sample);
              form.middleWindows.push(sample);
            }
          }
          const nudge = nudgeFor(nap, minutes);
          if (nudge != null) napNudges.push({ value: nudge, weight });
        }
      }
      previousEnd = nap.end;
    });

    // Wachfenster zwischen letztem Nickerchen und Nacht.
    if (previousEnd && entry.night && entry.night.start > previousEnd) {
      const window = minutesBetween(previousEnd, entry.night.start);
      if (window >= 30 && window <= 8 * 60) {
        lastWindows.push({ value: window, weight });
        form.lastWindows.push({ value: window, weight });
        if (entry.night.settle) {
          eveningNudges.push({ value: entry.night.settle === 'slow' ? 12 : 0, weight });
        }
      }
    }
  }

  return {
    firstWindows,
    middleWindows,
    lastWindows,
    napLengths,
    napCounts,
    bedtimes,
    mornings,
    napNudges,
    eveningNudges,
    byCount,
    days: days.size
  };
}

/** "19:30" -> 1170 */
export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** 1170 -> "19:30" */
export function toClock(minutes) {
  const total = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Mischt Altersband-Wert und gelernten Wert je nach Datenmenge. */
export function blend(baseValue, learnedValue, effectiveN, { min = 0.6, max = 1.5 } = {}) {
  if (learnedValue == null || effectiveN <= 0) return { value: baseValue, weight: 0 };
  const w = effectiveN / (effectiveN + SHRINKAGE_K);
  // Ausreißer dürfen den Plan nicht sprengen.
  const clamped = Math.min(Math.max(learnedValue, baseValue * min), baseValue * max);
  return { value: Math.round(baseValue * (1 - w) + clamped * w), weight: w };
}

/**
 * Mittelt die Richtungskorrekturen und dämpft sie, solange wenige
 * Bewertungen vorliegen. Ergebnis: Minuten, die auf das Wachfenster
 * addiert werden.
 */
export function calibration(nudges, limit = 30) {
  const n = nudges.reduce((sum, s) => sum + s.weight, 0);
  if (n <= 0) return { minutes: 0, samples: 0 };
  const mean = nudges.reduce((sum, s) => sum + s.value * s.weight, 0) / n;
  const damping = n / (n + 3);
  const minutes = Math.max(-limit, Math.min(limit, Math.round(mean * damping)));
  return { minutes, samples: nudges.length };
}

/**
 * Erstellt das persönliche Profil.
 * @returns {{active: boolean, confidence: number, samples: object, values: object}}
 */
export function learnProfile(sleeps, band, now = new Date()) {
  const s = collectSamples(sleeps, now);

  const firstN = weightSum(s.firstWindows);
  const middleN = weightSum(s.middleWindows);
  const lastN = weightSum(s.lastWindows);
  const napN = weightSum(s.napLengths);
  const countN = weightSum(s.napCounts);

  const first = blend(band.wakeWindowMin, weightedMedian(s.firstWindows), firstN);
  const last = blend(band.wakeWindowMax, weightedMedian(s.lastWindows), lastN);
  const napLength = blend(band.napLengthMin, weightedMedian(s.napLengths), napN);
  const napCount = weightedMedian(s.napCounts);

  const totalWeight = firstN + middleN + lastN + napN;
  const confidence = Math.min(1, totalWeight / (totalWeight + 12));

  const napCalibration = calibration(s.napNudges);
  const eveningCalibration = calibration(s.eveningNudges, 20);

  // Pro Tagesform eigene Fenster - sofern für die Form genug Tage da sind.
  const byNapCount = {};
  for (const [anzahl, form] of s.byCount) {
    if (!anzahl) continue;
    const w = weightSum(form.firstWindows) + weightSum(form.lastWindows);
    byNapCount[anzahl] = {
      firstNapStart: weightedMedian(form.firstNapStarts),
      days: weightSum(form.firstNapStarts),
      // Rohwerte: gegen welchen Richtwert sie verrechnet werden, entscheidet
      // sich erst, wenn die Tagesform bekannt ist.
      raw: {
        first: { value: weightedMedian(form.firstWindows), weight: weightSum(form.firstWindows) },
        middle: { value: weightedMedian(form.middleWindows), weight: weightSum(form.middleWindows) },
        last: { value: weightedMedian(form.lastWindows), weight: weightSum(form.lastWindows) },
        napLength: { value: weightedMedian(form.napLengths), weight: weightSum(form.napLengths) }
      },
      firstWindow: blend(band.wakeWindowMin, weightedMedian(form.firstWindows), weightSum(form.firstWindows)),
      middleWindow: blend(
        Math.round((band.wakeWindowMin + band.wakeWindowMax) / 2),
        weightedMedian(form.middleWindows),
        weightSum(form.middleWindows)
      ),
      lastWindow: blend(band.wakeWindowMax, weightedMedian(form.lastWindows), weightSum(form.lastWindows)),
      napLength: blend(band.napLengthMin, weightedMedian(form.napLengths), weightSum(form.napLengths)),
      weight: w
    };
  }

  // Wie gemischt sind die Tage? 0 = immer gleich viele Nickerchen.
  const countTotal = weightSum(s.napCounts);
  let napMix = 0;
  if (countTotal > 0 && napCount != null) {
    napMix = weightSum(s.napCounts.filter((x) => x.value !== napCount)) / countTotal;
  }

  return {
    active: totalWeight > 0,
    confidence,
    calibration: { nap: napCalibration, evening: eveningCalibration },
    samples: {
      windows: Math.round(firstN + middleN + lastN),
      naps: Math.round(napN),
      days: s.days,
      napDays: Math.round(countN)
    },
    raw: {
      first: { value: weightedMedian(s.firstWindows), weight: firstN },
      middle: { value: weightedMedian(s.middleWindows), weight: middleN },
      last: { value: weightedMedian(s.lastWindows), weight: lastN },
      napLength: { value: weightedMedian(s.napLengths), weight: napN }
    },
    values: {
      firstWindow: first,
      lastWindow: last,
      middleWindow: blend(
        Math.round((band.wakeWindowMin + band.wakeWindowMax) / 2),
        weightedMedian(s.middleWindows),
        middleN
      ),
      napLength,
      napCount,
      bedtime: weightedMedian(s.bedtimes),
      bedtimeSpread: weightedSpread(s.bedtimes),
      // Wie sehr schwanken die Wachfenster von Tag zu Tag? Daraus wird das
      // Fenster, das die App statt einer Scheingenauigkeit anzeigt.
      firstWindowSpread: weightedSpread(s.firstWindows),
      lastWindowSpread: weightedSpread(s.lastWindows),
      morning: weightedMedian(s.mornings),
      morningSpread: weightedSpread(s.mornings),
      napCountMix: napMix
    },
    byNapCount
  };
}

/**
 * Altersband + gelernte Werte = das Band, mit dem der Plan gerechnet wird.
 * Ohne eigene Daten kommt exakt das Altersband zurück.
 */
/**
 * Welche Tagesform passt zu einem ersten Nickerchen um diese Zeit? Verglichen
 * wird mit dem, was für dieses Kind üblich ist: Tage mit einem Nickerchen
 * beginnen später als Tage mit zweien. Ohne genug Tage je Form: null.
 *
 * Der reine Abstand zur üblichen Startzeit reicht dafür nicht. Er zieht die
 * Grenze genau in die Mitte zwischen beide Formen und tut so, als wären
 * beide gleich wahrscheinlich. Sind sie aber nicht: Wer an zwei von drei
 * Tagen nur ein Nickerchen macht, macht auch im Zweifel eher eines. Die
 * Grenze wandert deshalb zur selteneren Form hin - gewichtet mit der
 * Häufigkeit, wie bei jeder Einordnung mit Vorwissen.
 *
 * Das ist keine Feinheit: An der Grenze entscheidet sich, ob der Tag ein
 * oder zwei Nickerchen bekommt - und damit die ganze Bettzeit. Ein paar
 * Minuten Unterschied im Beginn dürfen den Abend nicht umwerfen.
 *
 * @param {object} profile        Lernprofil
 * @param {Date}   firstNapStart  Beginn des ersten Nickerchens von heute
 * @returns {number|null} erwartete Anzahl Nickerchen des Tages
 */
export function expectedNapCount(profile, firstNapStart) {
  if (!profile || !profile.active || !profile.byNapCount || !firstNapStart) return null;
  const minute = firstNapStart.getHours() * 60 + firstNapStart.getMinutes();
  const formen = Object.entries(profile.byNapCount)
    .map(([anzahl, form]) => ({ anzahl: Number(anzahl), ...form }))
    .filter((f) => f.firstNapStart != null && f.days >= 1.5)
    .sort((a, b) => a.firstNapStart - b.firstNapStart);
  if (formen.length < 2) return null;

  if (formen.length === 2) {
    const grenze = napCountBoundary(profile);
    return minute <= grenze.minute ? formen[0].anzahl : formen[1].anzahl;
  }

  let beste = null;
  for (const f of formen) {
    const abstand = Math.abs(minute - f.firstNapStart);
    if (!beste || abstand < beste.abstand) beste = { anzahl: f.anzahl, abstand };
  }
  return beste ? beste.anzahl : null;
}

export function personalizedBand(band, profile, dayNapCount = null) {
  if (!profile || !profile.active) return { ...band, personalized: false };

  const cal = profile.calibration || { nap: { minutes: 0 }, evening: { minutes: 0 } };

  // Wie viele Nickerchen hat dieser Tag? Vorgabe schlägt Gelerntes.
  let naps = band.naps;
  const learnedCount = profile.values.napCount;
  if (dayNapCount != null) {
    naps = Math.max(0, Math.round(dayNapCount));
  } else if (learnedCount != null && profile.samples.napDays >= 4) {
    // Anzahl erst übernehmen, wenn mehrere Tage dafür sprechen.
    naps = Math.min(band.naps + 1, Math.max(0, Math.round(learnedCount)));
  }

  // Der Richtwert für genau diese Tagesform. Weicht sie vom Altersband ab,
  // passen dessen Wachfenster nicht mehr - ein Tag mit einem Nickerchen hat
  // andere, längere Fenster als einer mit zweien. Sie werden dann aus der
  // Schlafbilanz des Tages abgeleitet.
  // Gibt es genug eigene Tage dieser Form, zählen deren Rohwerte - verrechnet
  // mit dem Richtwert der Form, nicht mit dem des Altersbands.
  const formRoh =
    profile.byNapCount && profile.byNapCount[naps] && profile.byNapCount[naps].weight >= 2
      ? profile.byNapCount[naps].raw
      : profile.raw;
  const roh = formRoh || profile.raw;

  // Wie lang schläft das Kind an so einem Tag? Davon hängt ab, wie viel
  // Wachzeit überhaupt übrig bleibt - und damit jedes Wachfenster.
  const napPrior = blend(band.napLengthMin, roh.napLength.value, roh.napLength.weight).value;
  const ref =
    naps === band.naps ? band : bandForNapCount({ ...band, napLengthMin: napPrior }, naps);
  const mitte = Math.round((ref.wakeWindowMin + ref.wakeWindowMax) / 2);
  const middle = blend(mitte, roh.middle.value, roh.middle.weight).value + cal.nap.minutes;
  let min = blend(ref.wakeWindowMin, roh.first.value, roh.first.weight).value + cal.nap.minutes;
  let max = blend(ref.wakeWindowMax, roh.last.value, roh.last.weight).value + cal.nap.minutes;
  // Das mittlere Fenster gibt es nur an Tagen mit mehreren Nickerchen. Es darf
  // die Spanne aufziehen, aber nicht das erste Wachfenster überschreiben -
  // sonst zieht ein kurzer Zwei-Nickerchen-Tag den Ein-Nickerchen-Tag mit.
  if (middle < min && naps !== 1) min = middle;
  max = Math.max(max, middle);
  if (max < min) max = min;
  // Die Abendkorrektur betrifft nur das letzte Wachfenster vor der Nacht.
  max += cal.evening.minutes;
  if (max < min) [min, max] = [max, min];
  // Auch nach der Korrektur bleibt alles im sicheren Rahmen - gemessen am
  // Richtwert dieser Tagesform.
  min = Math.round(Math.min(Math.max(min, ref.wakeWindowMin * 0.6), ref.wakeWindowMin * 1.5));
  max = Math.round(Math.min(Math.max(max, ref.wakeWindowMax * 0.6), ref.wakeWindowMax * 1.5));
  if (max < min) max = min;

  const napLength = naps === band.naps ? napPrior : ref.napLengthMin;
  const dayTimeSleep = naps > 0 ? Math.round(naps * napLength) : 0;

  // Abendfenster an die tatsächliche Routine der Familie rücken - aber nie
  // weiter als eine halbe Stunde über das altersübliche Fenster hinaus.
  let bedtimeEarliest = band.bedtimeEarliest;
  let bedtimeLatest = band.bedtimeLatest;
  const learnedBedtime = profile.values.bedtime;
  if (learnedBedtime != null && profile.samples.days >= 3) {
    const floor = toMinutes(band.bedtimeEarliest) - 30;
    const ceil = toMinutes(band.bedtimeLatest) + 30;
    // Je fester die Routine, desto enger das Fenster um sie herum. Bringt eine
    // Familie ihr Kind jeden Abend zur selben Zeit ins Bett, ist das der
    // bessere Anker als jede Rechnung.
    const spread = profile.values.bedtimeSpread;
    const half = spread == null ? 45 : Math.round(Math.min(45, Math.max(15, spread * 1.5)));
    const center = Math.min(Math.max(learnedBedtime, floor + half), ceil - half);
    bedtimeEarliest = toClock(Math.max(floor, center - half));
    bedtimeLatest = toClock(Math.min(ceil, center + half));
  }

  return {
    ...band,
    bedtimeEarliest,
    bedtimeLatest,
    // Die Grenze des Altersbands bleibt erhalten: die gelernte Routine darf
    // das Fenster verschieben, aber der Plan nie darüber hinauslaufen.
    bedtimeCeiling: band.bedtimeCeiling || band.bedtimeLatest,
    wakeWindowMin: min,
    wakeWindowMax: max,
    napLengthMin: napLength,
    naps,
    dayTimeSleepMin: Math.round(
      ref.dayTimeSleepMin * (1 - profile.confidence) + dayTimeSleep * profile.confidence
    ),
    napCountAdjusted: ref.napCountAdjusted || false,
    personalized: true
  };
}

/**
 * Schlafdruck aus der aufgelaufenen Wachzeit.
 *
 * Nicht nur das letzte Wachfenster zählt, sondern auch, wie viel Schlaf der
 * Tag bisher gebracht hat. Wer nach einem kurzen Nickerchen weitermacht,
 * hat mehr Schlafdruck - das nächste Wachfenster fällt kürzer aus, die
 * Bettzeit rutscht nach vorn. Umgekehrt bei einem außergewöhnlich langen
 * Nickerchen.
 *
 * @param {object} band
 * @param {number} napsDone       bereits gemachte Nickerchen
 * @param {number} sleptMinutes   tatsächlicher Tagschlaf bisher
 * @returns {{minutes: number, deficit: number}} Korrektur in Minuten
 */
export function sleepPressure(band, napsDone, sleptMinutes, nightMinutes = 0) {
  // Die letzte Nacht zählt mit: war das Kind nachts lange wach, fehlt der
  // Schlaf am Tag und alle Zeiten rücken nach vorn.
  const nightDeficit = nightMinutes > 0 ? band.nightSleepMin - nightMinutes : 0;
  const nightPart = Math.max(-30, Math.min(15, -nightDeficit / 4));
  if (!napsDone || !band.napLengthMin) {
    return {
      minutes: Math.round(nightPart) || 0,
      deficit: 0,
      nightDeficit: Math.round(nightDeficit)
    };
  }
  const expected = napsDone * band.napLengthMin;
  const deficit = expected - sleptMinutes;
  // Ein Drittel des Fehlbetrags, nach unten stärker begrenzt als nach oben:
  // zu wenig Schlaf drückt spürbar, zu viel Schlaf verschiebt nur leicht.
  const raw = -deficit / 3;
  const dayPart = Math.max(-30, Math.min(20, raw));
  return {
    minutes: Math.round(Math.max(-45, Math.min(20, dayPart + nightPart))),
    deficit: Math.round(deficit),
    nightDeficit: Math.round(nightDeficit)
  };
}

/**
 * Rechnet ein Altersband auf eine andere Anzahl Nickerchen um.
 *
 * Wichtig ist dabei nicht nur die Anzahl: Wer statt zwei nur ein Nickerchen
 * macht, ist zwischen den Schläfchen deutlich länger wach. Die Wachfenster
 * werden deshalb aus der Schlafbilanz des Tages abgeleitet:
 *
 *   Wachzeit = 24 h - (Nachtschlaf + Tagschlaf)
 *   Wachfenster = Wachzeit / (Anzahl Nickerchen + 1)
 *
 * Das erste Fenster fällt etwas kürzer aus, das letzte vor der Nacht länger -
 * so wie es die Wachfenster-Tabellen auch abbilden.
 */
export function bandForNapCount(band, naps) {
  const n = Math.max(0, Math.min(5, Math.round(naps)));
  if (n === band.naps) return band;
  // Der Tagschlaf richtet sich nach der Anzahl - aber nicht linear: fällt ein
  // Nickerchen weg, wird das verbliebene länger, ersetzt aber nicht beide.
  // Die Wurzel bildet genau das ab (bei 2 -> 1 rund 70 % statt 50 % oder 100 %)
  // und trifft die üblichen anderthalb bis zwei Stunden Mittagsschlaf.
  const dayTimeSleep =
    n === 0 ? 0 : Math.round(band.dayTimeSleepMin * Math.sqrt(n / Math.max(1, band.naps)));
  const awake = 24 * 60 - (band.nightSleepMin + dayTimeSleep);
  const average = awake / (n + 1);
  return {
    ...band,
    naps: n,
    dayTimeSleepMin: dayTimeSleep,
    napLengthMin: n === 0 ? 0 : Math.round(dayTimeSleep / n),
    wakeWindowMin: Math.round(average * 0.88),
    wakeWindowMax: Math.round(average * 1.12),
    napCountAdjusted: true
  };
}

/**
 * Hinweis auf einen anstehenden Nickerchen-Übergang: Das Kind macht seit
 * mehreren Tagen verlässlich weniger Nickerchen, als das Alter vorsieht.
 */
export function napTransitionHint(band, profile) {
  if (!profile || !profile.active || profile.samples.napDays < 4) return null;
  const learned = profile.values.napCount;
  if (learned == null) return null;
  if (learned <= band.naps - 1) {
    return {
      from: band.naps,
      to: Math.round(learned),
      text: `Seit einigen Tagen sind es meist ${Math.round(learned)} statt ${band.naps} Nickerchen. Der Plan rechnet bereits damit - typisch für einen Nap-Übergang. Halte in dieser Phase die Bettzeit etwas früher.`
    };
  }
  if (learned >= band.naps + 1) {
    return {
      from: band.naps,
      to: Math.round(learned),
      text: `Dein Kind braucht aktuell mehr Nickerchen (${Math.round(learned)}) als für das Alter üblich. Das kommt in Wachstums- oder Infektphasen vor - der Plan folgt deinen Daten.`
    };
  }
  return null;
}

/**
 * Wie weit ist der Übergang auf weniger Nickerchen? Vergleicht die jüngere
 * mit der älteren Hälfte des Zeitraums: wandert das erste Nickerchen nach
 * hinten und wird länger, ist das das typische Bild.
 *
 * @param {object[]} sleeps  Einträge mit Date-Objekten
 * @param {object}   band    Altersband
 * @param {Date}     now
 * @returns {null|object} null, wenn zu wenig Tage vorliegen
 */
export function napTransitionReport(sleeps, band, now = new Date()) {
  const from = new Date(now.getTime() - LEARN_WINDOW_DAYS * DAY);
  const tage = new Map();
  for (const s of sleeps) {
    if (s.type !== 'nap' || !s.end || s.start < from || s.start > now) continue;
    if (minutesBetween(s.start, s.end) < MIN_NAP_MINUTES) continue;
    const key = dayKey(s.start);
    if (!tage.has(key)) tage.set(key, { tag: s.start, naps: [] });
    tage.get(key).naps.push(s);
  }
  const liste = [...tage.values()].sort((a, b) => a.tag - b.tag);
  if (liste.length < 4) return null;

  const haelfte = Math.floor(liste.length / 2);
  const teil = (eintraege) => {
    const starts = [];
    const laengen = [];
    let einzelne = 0;
    for (const e of eintraege) {
      const naps = [...e.naps].sort((a, b) => a.start - b.start);
      starts.push(naps[0].start.getHours() * 60 + naps[0].start.getMinutes());
      laengen.push(naps.reduce((sum, n) => sum + minutesBetween(n.start, n.end), 0));
      if (naps.length === 1) einzelne++;
    }
    const median = (werte) => {
      const s = [...werte].sort((a, b) => a - b);
      return s.length ? Math.round(s[Math.floor(s.length / 2)]) : null;
    };
    return {
      tage: eintraege.length,
      start: median(starts),
      laenge: median(laengen),
      einzelne,
      anteilEinzeln: eintraege.length ? einzelne / eintraege.length : 0
    };
  };

  const frueher = teil(liste.slice(0, haelfte));
  const zuletzt = teil(liste.slice(haelfte));
  const verschiebung = zuletzt.start - frueher.start;
  const laengerUm = zuletzt.laenge - frueher.laenge;
  // Ein Übergang, wenn zuletzt überwiegend ein Nickerchen gemacht wird, das
  // Altersband aber noch mehr vorsieht.
  const laeuft = zuletzt.anteilEinzeln >= 0.5 && band.naps > 1 && frueher.anteilEinzeln < 1;
  return {
    laeuft,
    von: band.naps,
    zu: 1,
    frueher,
    zuletzt,
    verschiebung,
    laengerUm,
    tage: liste.length
  };
}

/**
 * Ein Punkt je Tag für die Trendanzeige: wann das erste Nickerchen begann und
 * wie viel Tagschlaf zusammenkam.
 */
export function napTrend(sleeps, { days = 14, now = new Date() } = {}) {
  const from = new Date(now.getTime() - days * DAY);
  const tage = new Map();
  for (const s of sleeps) {
    if (s.type !== 'nap' || !s.end || s.start < from || s.start > now) continue;
    if (minutesBetween(s.start, s.end) < MIN_NAP_MINUTES) continue;
    const key = dayKey(s.start);
    if (!tage.has(key)) tage.set(key, { tag: new Date(s.start), naps: [] });
    tage.get(key).naps.push(s);
  }
  return [...tage.values()]
    .map((e) => {
      const naps = [...e.naps].sort((a, b) => a.start - b.start);
      return {
        tag: new Date(e.tag.getFullYear(), e.tag.getMonth(), e.tag.getDate()),
        start: naps[0].start.getHours() * 60 + naps[0].start.getMinutes(),
        laenge: naps.reduce((sum, n) => sum + minutesBetween(n.start, n.end), 0),
        anzahl: naps.length
      };
    })
    .sort((a, b) => a.tag - b.tag);
}

/**
 * Wie viel Schlaf braucht dieses Kind in 24 Stunden? Gelernt aus den eigenen
 * vollständigen Tagen: Nickerchen des Tages plus die Nacht, die an seinem
 * Abend beginnt, abzüglich erfasster Wachphasen.
 *
 * Der Wert ist erstaunlich stabil - und er ist der Grund, warum Tag- und
 * Nachtschlaf gegeneinander laufen: Was mittags geschlafen wird, fehlt nachts.
 *
 * @returns {null|{minutes:number, tage:number, min:number, max:number}}
 */
export function sleepNeed24h(sleeps, now = new Date(), { days = 21 } = {}) {
  const from = new Date(now.getTime() - days * DAY);
  const naps = sleeps.filter((s) => s.type === 'nap' && s.end && s.start >= from);
  const nights = sleeps.filter((s) => s.type === 'night' && s.end && s.start >= from);
  const summen = [];
  for (const nacht of nights) {
    const key = dayKey(nacht.start);
    const tagschlaf = naps
      .filter((n) => dayKey(n.start) === key)
      .reduce((sum, n) => sum + minutesBetween(n.start, n.end), 0);
    const wach = (nacht.interruptions || []).reduce(
      (sum, g) => sum + (g.end ? minutesBetween(g.start, g.end) : 0),
      0
    );
    const gesamt = minutesBetween(nacht.start, nacht.end) - wach + tagschlaf;
    // Offensichtliche Ausreißer (Krankheit, Autofahrt, Fehleintrag) draußen lassen.
    if (gesamt >= 8 * 60 && gesamt <= 16 * 60) summen.push(gesamt);
  }
  if (summen.length < 4) return null;
  const sortiert = [...summen].sort((a, b) => a - b);
  return {
    minutes: Math.round(sortiert[Math.floor(sortiert.length / 2)]),
    tage: sortiert.length,
    min: sortiert[0],
    max: sortiert[sortiert.length - 1]
  };
}

/**
 * Die Grenze zwischen zwei Tagesformen: bis zu dieser Uhrzeit spricht der
 * Beginn des ersten Nickerchens für die frühe Form, danach für die späte.
 *
 * Gewichtet mit der Häufigkeit beider Formen (siehe expectedNapCount), damit
 * dieselbe Zahl im Plan steht, nach der auch gerechnet wird.
 *
 * @param {object} profile Lernprofil
 * @returns {null|{minute:number, frueh:object, spaet:object}}
 */
export function napCountBoundary(profile) {
  if (!profile || !profile.active || !profile.byNapCount) return null;
  const formen = Object.entries(profile.byNapCount)
    .map(([anzahl, form]) => ({ anzahl: Number(anzahl), ...form }))
    .filter((f) => f.firstNapStart != null && f.days >= 1.5)
    .sort((a, b) => a.firstNapStart - b.firstNapStart);
  if (formen.length !== 2) return null;
  const [frueh, spaet] = formen;
  return {
    minute: Math.round(
      (frueh.firstNapStart * spaet.days + spaet.firstNapStart * frueh.days) /
        (frueh.days + spaet.days)
    ),
    frueh,
    spaet
  };
}

/** Median einer Zahlenreihe. */
function median(werte) {
  const s = [...werte].sort((a, b) => a - b);
  if (!s.length) return null;
  const mitte = Math.floor(s.length / 2);
  return s.length % 2 ? s[mitte] : (s[mitte - 1] + s[mitte]) / 2;
}

/** Pearson-Korrelation - grobe Richtungsangabe, kein Beweis. */
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let c = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    c += (xs[i] - mx) * (ys[i] - my);
    vx += (xs[i] - mx) ** 2;
    vy += (ys[i] - my) ** 2;
  }
  return vx > 0 && vy > 0 ? c / Math.sqrt(vx * vy) : 0;
}

/**
 * Was passiert, wenn das erste Nickerchen früher oder später beginnt?
 *
 * Gemessen wird das Wachfenster vom Aufstehen bis zum ersten Nickerchen
 * gegen die Länge genau dieses Nickerchens. Bei vielen Kindern ist der
 * Zusammenhang deutlich: zu früh hingelegt heißt kurz geschlafen, weil der
 * Schlafdruck noch nicht reicht. Genau das erzeugt dann Tage mit zu wenig
 * Tagschlaf - und einen langen, quengeligen Nachmittag.
 *
 * Die Schwelle wird nicht geraten, sondern gesucht: geprüft werden Grenzen
 * im Viertelstundenraster im mittleren Bereich der beobachteten Fenster. Die
 * Antwort kommt nur, wenn beide Gruppen genug Tage haben, der Unterschied
 * deutlich ist und die Richtung stimmt - sonst null statt einer Scheinregel.
 *
 * @param {object[]} sleeps   Einträge mit Date-Objekten
 * @param {object}   [opts]
 * @returns {null|{n:number, r:number, schwelle:number, kurz:object, lang:object, paare:Array}}
 */
export function napWindowEffect(sleeps, { days = 28, now = new Date(), minGruppe = 4 } = {}) {
  const from = new Date(now.getTime() - days * DAY);
  const naps = sleeps
    .filter((s) => s.type === 'nap' && s.end && s.start >= from && s.start <= now)
    .sort((a, b) => a.start - b.start);
  const nights = sleeps.filter((s) => s.type === 'night' && s.end).sort((a, b) => a.start - b.start);

  const paare = [];
  const gesehen = new Set();
  for (const nap of naps) {
    const key = dayKey(nap.start);
    // Nur das erste Nickerchen des Tages: nur dort ist das Wachfenster die
    // Nacht davor und damit über die Tage vergleichbar.
    if (gesehen.has(key)) continue;
    gesehen.add(key);
    let letzteNacht = null;
    for (const n of nights) {
      if (n.end <= nap.start) letzteNacht = n;
      else break;
    }
    if (!letzteNacht) continue;
    const fenster = minutesBetween(letzteNacht.end, nap.start);
    // Unplausible Abstände (fehlende Nacht, Fehleintrag) draußen lassen.
    if (fenster < 60 || fenster > 9 * 60) continue;
    paare.push({ tag: nap.start, fenster, laenge: minutesBetween(nap.start, nap.end) });
  }
  if (paare.length < 2 * minGruppe) return null;

  const r = pearson(
    paare.map((p) => p.fenster),
    paare.map((p) => p.laenge)
  );
  if (!Number.isFinite(r) || r < 0.4) return null;

  const sortiert = [...paare].sort((a, b) => a.fenster - b.fenster);
  const von = sortiert[Math.floor(sortiert.length * 0.25)].fenster;
  const bis = sortiert[Math.ceil(sortiert.length * 0.75) - 1].fenster;
  const kandidaten = [];
  for (let s = Math.ceil(von / 15) * 15; s <= bis; s += 15) {
    const kurz = paare.filter((p) => p.fenster < s);
    const lang = paare.filter((p) => p.fenster >= s);
    if (kurz.length < minGruppe || lang.length < minGruppe) continue;
    const mk = median(kurz.map((p) => p.laenge));
    const ml = median(lang.map((p) => p.laenge));
    kandidaten.push({
      schwelle: s,
      unterschied: ml - mk,
      kurz: { tage: kurz.length, median: Math.round(mk) },
      lang: { tage: lang.length, median: Math.round(ml) }
    });
  }
  if (!kandidaten.length) return null;
  // Liegt zwischen den Gruppen eine Lücke, trennen viele Schwellen gleich
  // gut. Dann die mittlere nehmen: die kleinste wäre zu früh (und der Plan
  // legte wieder zu früh hin), die größte zu streng.
  const bestesMass = Math.max(...kandidaten.map((k) => k.unterschied));
  const gleichwertig = kandidaten.filter((k) => bestesMass - k.unterschied <= 1);
  const beste = gleichwertig[Math.floor((gleichwertig.length - 1) / 2)];
  // Unter einer halben Stunde Unterschied ist das keine Empfehlung wert.
  if (beste.unterschied < 30) return null;
  return { n: paare.length, r, ...beste, paare: sortiert };
}

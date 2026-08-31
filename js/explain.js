/**
 * Herleitung der empfohlenen Schlafenszeit.
 *
 * Beantwortet die Frage "wie kommt diese Uhrzeit zustande?" als Kette
 * nachvollziehbarer Schritte - mit denselben Zahlen, mit denen der Plan
 * tatsächlich rechnet.
 *
 * Reine Funktionen, keine Speicher- oder DOM-Zugriffe.
 */
import { addMinutes, fmtDuration, fmtTime, minutesBetween, wakeWindowFor } from './schedule.js';

/**
 * Zeitfenster statt Punkt: Kinder schlafen nicht auf die Minute genau.
 * Die Spanne wächst mit der Länge des Wachfensters, bleibt aber zwischen
 * 10 und 30 Minuten in jede Richtung.
 */
export function sleepWindow(target, wakeWindowMinutes, measuredSpread = null) {
  // Ohne eigene Daten ein Zehntel des Wachfensters. Sobald genug Tage erfasst
  // sind, zählt, wie stark die Zeiten bei diesem Kind wirklich schwanken -
  // eine Minutenangabe wäre sonst genauer, als die Wirklichkeit ist.
  const grund = Math.round(wakeWindowMinutes * 0.1);
  const roh = measuredSpread == null ? grund : Math.max(grund, Math.round(measuredSpread));
  const spread = Math.max(10, Math.min(45, roh));
  return { start: addMinutes(target, -spread), target, end: addMinutes(target, spread), spread };
}

/**
 * Die Rechenschritte bis zur nächsten Schlafenszeit.
 *
 * @param {object} opts
 * @param {object} opts.band        Band, mit dem gerechnet wird (persönlich)
 * @param {object} opts.baseBand    Reines Altersband
 * @param {object} opts.profile     Lernprofil (kann inaktiv sein)
 * @param {string} opts.ageLabel    z. B. "14 Monate, 1 Woche"
 * @param {Date}   opts.lastWake    Letzter Wachzeitpunkt
 * @param {number} opts.napsDone    Bereits gemachte Nickerchen heute
 * @param {string|number} opts.napSetting  'auto' oder feste Anzahl
 * @param {Date|null} opts.firstNapStart  Beginn des ersten Nickerchens heute -
 *        daran erkennt die App, ob der Tag ein oder zwei Nickerchen hat
 * @param {Date|null} opts.planned  Zeit aus dem Tagesplan; weicht sie von der
 *        reinen Rechnung ab (Abendfenster), wird das als Schritt ausgewiesen
 *        und gilt als Ergebnis - Karte und Plan zeigen so nie zwei Zeiten.
 * @returns {{steps: Array, target: Date, window: object, isNight: boolean, windowMinutes: number}}
 */
/** Gemessene Schwankung des passenden Wachfensters, falls gelernt wurde. */
function spreadFor(profile, isNight) {
  if (!profile || !profile.active || !profile.values) return null;
  const wert = isNight ? profile.values.lastWindowSpread : profile.values.firstWindowSpread;
  return wert == null ? null : wert;
}

export function explainNextSleep({
  band,
  baseBand,
  profile,
  ageLabel,
  lastWake,
  napsDone = 0,
  napSetting = 'auto',
  firstNapStart = null,
  planned = null,
  isNight: isNightOverride = null,
  pressure = null
}) {
  const totalWindows = Math.max(1, band.naps + 1);
  const isNight = isNightOverride == null ? napsDone >= band.naps : isNightOverride;
  // Vor der Nacht gilt immer das letzte (längste) Wachfenster des Tages -
  // auch wenn ein Nickerchen ausgefallen ist.
  const index = isNight ? totalWindows - 1 : Math.min(napsDone, totalWindows - 1);
  const windowMinutes = wakeWindowFor(band, index, totalWindows);
  const pressureMinutes = pressure ? pressure.minutes : 0;
  const computed = addMinutes(lastWake, Math.max(30, windowMinutes + pressureMinutes));
  const skippedNap = isNight && napsDone < band.naps;

  const steps = [
    { label: 'Alter', value: ageLabel, note: `Altersband ${baseBand.label}` },
    {
      label: 'Richtwert für das Alter',
      value: `${fmtDuration(baseBand.wakeWindowMin)} – ${fmtDuration(baseBand.wakeWindowMax)}`,
      note: `${baseBand.naps} Nickerchen pro Tag`
    }
  ];

  if (band.napCountAdjusted) {
    steps.push({
      label: `Heute ${band.naps} ${band.naps === 1 ? 'Nickerchen' : 'Nickerchen'}`,
      value: `${fmtDuration(band.wakeWindowMin)} – ${fmtDuration(band.wakeWindowMax)}`,
      note:
        napSetting !== 'auto'
          ? 'von dir festgelegt, Wachfenster neu abgeleitet'
          : firstNapStart
            ? `am Beginn des ersten Nickerchens (${fmtTime(firstNapStart)}) erkannt`
            : 'aus deinen Daten erkannt, Wachfenster neu abgeleitet'
    });
  } else if (band.personalized && profile && profile.active) {
    steps.push({
      label: 'Aus deinem Protokoll gelernt',
      value: `${fmtDuration(band.wakeWindowMin)} – ${fmtDuration(band.wakeWindowMax)}`,
      note: `${Math.round(profile.confidence * 100)} % persönlich, ${
        profile.samples.windows
      } Wachfenster ausgewertet`
    });
  }

  const calibration = profile && profile.calibration ? profile.calibration.nap.minutes : 0;
  if (calibration) {
    steps.push({
      label: 'Aus deinen Bewertungen',
      value: `${calibration > 0 ? '+' : ''}${calibration} Min`,
      note:
        calibration > 0
          ? 'war beim Hinlegen oft noch nicht müde genug'
          : 'es gab Übermüdungszeichen'
    });
  }

  steps.push({
    label: isNight ? 'Letztes Wachfenster vor der Nacht' : `Wachfenster Nummer ${index + 1}`,
    value: fmtDuration(windowMinutes),
    note: `${index + 1}. von ${totalWindows} an diesem Tag`
  });

  if (pressure && pressure.minutes) {
    const teile = [];
    if (pressure.deficit) {
      teile.push(
        pressure.deficit > 0
          ? `${fmtDuration(pressure.deficit)} weniger Tagschlaf als üblich`
          : `${fmtDuration(-pressure.deficit)} mehr Tagschlaf als üblich`
      );
    }
    if (pressure.nightDeficit > 0) {
      teile.push(`${fmtDuration(pressure.nightDeficit)} kürzere Nacht (nächtliches Wachsein zählt mit)`);
    } else if (pressure.nightDeficit < 0) {
      teile.push(`${fmtDuration(-pressure.nightDeficit)} längere Nacht als üblich`);
    }
    steps.push({
      label: pressure.nightDeficit && !pressure.deficit ? 'Die letzte Nacht' : 'Schlaf bisher',
      value: `${pressure.minutes > 0 ? '+' : ''}${pressure.minutes} Min`,
      note: `${teile.join(', ')}${pressure.minutes < 0 ? ' - der Schlafdruck ist höher' : ''}`
    });
  }

  steps.push({
    label: napsDone === 0 ? 'Aufgewacht' : 'Wach seit dem letzten Schlaf',
    value: fmtTime(lastWake),
    note: null
  });

  // Der Plan hält die Bettzeit im altersüblichen Abendfenster. Weicht er von
  // der reinen Rechnung ab, steht das als eigener Schritt da.
  let target = computed;
  let clamped = false;
  if (planned && Math.abs(minutesBetween(computed, planned)) > 5) {
    const later = planned > computed;
    steps.push({
      label: 'Abendfenster des Alters',
      value: fmtTime(planned),
      note: skippedNap
        ? `ohne Nickerchen ergäbe die Rechnung ${fmtTime(computed)} - so früh geht niemand ins Bett`
        : later
          ? pressureMinutes < 0
            ? `Rechnung ergibt ${fmtTime(computed)}; üblich wäre frühestens ${
                band.bedtimeEarliest
              } Uhr, wegen des Schlafdefizits heute etwas früher`
            : `Rechnung ergibt ${fmtTime(computed)}, frühestens ${band.bedtimeEarliest} Uhr`
          : `Rechnung ergibt ${fmtTime(computed)}, spätestens ${band.bedtimeLatest} Uhr`
    });
    target = planned;
    clamped = true;
  }

  return {
    steps,
    target,
    computed,
    clamped,
    skippedNap,
    window: sleepWindow(target, windowMinutes, spreadFor(profile, isNight)),
    isNight,
    windowMinutes,
    index,
    totalWindows
  };
}

/** Kurzform für eine Zeile: "06:30 + 4 Std 37 Min Wachfenster". */
export function shortFormula(lastWake, windowMinutes) {
  return `${fmtTime(lastWake)} + ${fmtDuration(windowMinutes)} Wachfenster`;
}

/**
 * Bogenwinkel für die 24-Stunden-Uhr: Mitternacht oben, im Uhrzeigersinn.
 * Gibt Grad zurück (0-360), abgeschnitten auf den dargestellten Tag.
 */
export function clockArc(start, end, dayStart) {
  const dayEnd = addMinutes(dayStart, 24 * 60);
  const from = start < dayStart ? dayStart : start;
  const to = end > dayEnd ? dayEnd : end;
  if (to <= from) return null;
  const degPerMinute = 360 / (24 * 60);
  return {
    from: minutesBetween(dayStart, from) * degPerMinute,
    to: minutesBetween(dayStart, to) * degPerMinute
  };
}

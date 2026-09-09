/**
 * Vergleich mit Gleichaltrigen.
 *
 * Grundlage sind die veröffentlichten Normwerte aus data.js (NIGHT_NORMS).
 * Es wird ausschließlich mit belegten Ankeraltern verglichen - fehlt für ein
 * Alter ein Wert, sagt die Funktion das ausdrücklich, statt zu interpolieren.
 *
 * Reine Funktionen, keine Speicher- oder DOM-Zugriffe.
 */
import { NIGHT_NORMS } from './data.js';
import { DAY, classifyWaking, minutesBetween } from './schedule.js';

const DAYS_PER_MONTH = 30.44;

/** Nächstgelegener belegter Vergleichswert zum Alter in Tagen. */
export function nearestWakingNorm(ageDays) {
  const months = ageDays / DAYS_PER_MONTH;
  let best = null;
  for (const norm of NIGHT_NORMS.wakings) {
    const distance = Math.abs(norm.months - months);
    if (!best || distance < best.distance) best = { ...norm, distance };
  }
  if (!best) return null;
  return { ...best, exact: best.distance <= 1, ageMonths: Math.round(months) };
}

/**
 * Eigener Schnitt der letzten Nächte.
 * Gezählt werden nur Nächte, für die eine Angabe erfasst wurde.
 */
export function averageWakings(sleeps, { nights = 14, now = new Date() } = {}) {
  const from = new Date(now.getTime() - nights * DAY);
  const counted = sleeps
    .filter((s) => s.type === 'night' && s.start >= from)
    .map((s) => wakingCount(s))
    .filter((n) => n != null);
  if (!counted.length) return { nights: 0, mean: null };
  const sum = counted.reduce((total, n) => total + n, 0);
  return { nights: counted.length, mean: sum / counted.length };
}

/**
 * Wie oft war das Kind in dieser Nacht wach?
 * Erfasste Wachphasen zählen; nur wenn keine vorliegen, gilt die Angabe aus
 * der Bewertung. Sonst müsste man dasselbe zweimal pflegen.
 */
export function wakingCount(sleep) {
  const gaps = sleep.interruptions || [];
  if (gaps.length) return gaps.length;
  if (sleep.wakings != null && sleep.wakings !== '') return Number(sleep.wakings);
  return null;
}

/**
 * Einordnung des eigenen Schnitts gegenüber dem Normwert.
 * @returns {null|{mean:number, norm:object, status:'weniger'|'typisch'|'mehr', text:string}}
 */
export function compareWakings(ageDays, average) {
  if (!average || average.mean == null) return null;
  const norm = nearestWakingNorm(ageDays);
  if (!norm) return null;
  const diff = average.mean - norm.mean;
  const status = diff < -0.6 ? 'weniger' : diff > 0.6 ? 'mehr' : 'typisch';
  const bezug = norm.exact
    ? `mit ${norm.months} Monaten`
    : `bei ${norm.months} Monaten (nächstgelegener belegter Wert)`;
  const text =
    status === 'typisch'
      ? `Das entspricht dem Durchschnitt von ${norm.mean.toString().replace('.', ',')} ${bezug}.`
      : status === 'weniger'
        ? `Das ist weniger als der Durchschnitt von ${norm.mean
            .toString()
            .replace('.', ',')} ${bezug}.`
        : `Das ist mehr als der Durchschnitt von ${norm.mean
            .toString()
            .replace('.', ',')} ${bezug}.`;
  return { mean: average.mean, nights: average.nights, norm, status, text };
}

/** Hinweise der Studienautoren, die zum Alter des Kindes passen (± 2 Monate). */
export function clinicHintsFor(ageDays) {
  const months = ageDays / DAYS_PER_MONTH;
  return NIGHT_NORMS.clinicHints.filter((h) => Math.abs(h.months - months) <= 2);
}

/**
 * Nächtliches Wachliegen der letzten Nächte - aus den erfassten Wachphasen,
 * nicht aus Bewertungen. Zeigt, ob es die Regel oder die Ausnahme ist.
 *
 * @param {object[]} sleeps  Einträge mit Date-Objekten
 * @param {object}   opts
 * @returns {{naechte:number, mitWachphasen:number, minutenGesamt:number,
 *            minutenSchnitt:number, laengste:object|null, anteil:number,
 *            haeufigsteStunde:number|null}}
 */
export function nightWakingReport(sleeps, { nights = 14, now = new Date() } = {}) {
  const from = new Date(now.getTime() - nights * DAY);
  const naechte = sleeps.filter(
    (s) => s.type === 'night' && s.end && s.start >= from && Array.isArray(s.interruptions)
  );
  let minutenGesamt = 0;
  let mitWachphasen = 0;
  let laengste = null;
  const stunden = new Map();
  // Wo in der Nacht die Wachphasen liegen - das trennt "war noch nicht müde"
  // von "die Nacht war fast vorbei".
  const phasen = {
    frueh: { anzahl: 0, minuten: 0 },
    mitte: { anzahl: 0, minuten: 0 },
    spaet: { anzahl: 0, minuten: 0 }
  };
  for (const nacht of naechte) {
    let inDieserNacht = 0;
    for (const gap of nacht.interruptions) {
      if (!gap.end) continue;
      const dauer = Math.round((gap.end - gap.start) / 60000);
      if (dauer <= 0) continue;
      inDieserNacht += dauer;
      const stunde = gap.start.getHours();
      stunden.set(stunde, (stunden.get(stunde) || 0) + 1);
      const lage = classifyWaking(nacht.start, nacht.end, gap);
      phasen[lage].anzahl += 1;
      phasen[lage].minuten += dauer;
      if (!laengste || dauer > laengste.minuten) {
        laengste = { minuten: dauer, start: gap.start, nacht: nacht.start, lage };
      }
    }
    if (inDieserNacht > 0) mitWachphasen++;
    minutenGesamt += inDieserNacht;
  }
  // Der Schwerpunkt ist die Gruppe mit den meisten wach verbrachten Minuten -
  // und nur dann eine Aussage wert, wenn sie deutlich vorne liegt.
  const sortiert = Object.entries(phasen).sort((a, b) => b[1].minuten - a[1].minuten);
  const schwerpunkt =
    sortiert[0][1].minuten > 0 && sortiert[0][1].minuten >= 1.5 * sortiert[1][1].minuten
      ? sortiert[0][0]
      : null;
  let haeufigsteStunde = null;
  let beste = 0;
  for (const [stunde, anzahl] of stunden) {
    if (anzahl > beste) {
      beste = anzahl;
      haeufigsteStunde = stunde;
    }
  }
  return {
    naechte: naechte.length,
    mitWachphasen,
    minutenGesamt,
    minutenSchnitt: naechte.length ? Math.round(minutenGesamt / naechte.length) : 0,
    laengste,
    anteil: naechte.length ? mitWachphasen / naechte.length : 0,
    haeufigsteStunde,
    phasen,
    schwerpunkt
  };
}

/**
 * Was unterscheidet ruhige von unruhigen Nächten? Vergleicht für jede Nacht
 * den Überhang (Zeit im Bett minus verbleibender Schlafbedarf) mit der
 * tatsächlich wach verbrachten Zeit.
 *
 * Das ist eine Beobachtung an den eigenen Daten, kein Beweis: Es kann immer
 * etwas anderes dahinterstecken (Zähne, Infekt, Entwicklungsschub).
 *
 * @param {object[]} sleeps  Einträge mit Date-Objekten
 * @param {number}   need24h gelernter Tagesbedarf in Minuten
 * @returns {null|{naechte:Array, ruhig:object, unruhig:object, zusammenhang:number}}
 */
export function nightPatterns(sleeps, need24h, { nights = 21, now = new Date() } = {}) {
  if (!need24h) return null;
  const from = new Date(now.getTime() - nights * DAY);
  const key = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const naps = sleeps.filter((s) => s.type === 'nap' && s.end && s.start >= from);
  const liste = [];
  for (const nacht of sleeps) {
    if (nacht.type !== 'night' || !nacht.end || nacht.start < from) continue;
    const tagschlaf = naps
      .filter((n) => key(n.start) === key(nacht.start))
      .reduce((sum, n) => sum + minutesBetween(n.start, n.end), 0);
    const wach = (nacht.interruptions || []).reduce(
      (sum, g) => sum + (g.end ? minutesBetween(g.start, g.end) : 0),
      0
    );
    const imBett = minutesBetween(nacht.start, nacht.end);
    liste.push({
      tag: new Date(nacht.start),
      tagschlaf: Math.round(tagschlaf),
      bettzeit: nacht.start,
      imBett: Math.round(imBett),
      wach: Math.round(wach),
      ueberhang: Math.round(imBett - (need24h - tagschlaf))
    });
  }
  if (liste.length < 5) return null;
  const ruhig = liste.filter((n) => n.wach === 0);
  const unruhig = liste.filter((n) => n.wach > 0);
  if (!ruhig.length || !unruhig.length) return null;

  const median = (werte) => {
    const s = [...werte].sort((a, b) => a - b);
    return Math.round(s[Math.floor(s.length / 2)]);
  };
  const fasse = (gruppe) => ({
    naechte: gruppe.length,
    tagschlaf: median(gruppe.map((n) => n.tagschlaf)),
    ueberhang: median(gruppe.map((n) => n.ueberhang)),
    bettzeit: median(gruppe.map((n) => n.bettzeit.getHours() * 60 + n.bettzeit.getMinutes()))
  });

  // Pearson zwischen Überhang und Wachzeit - grobe Richtungsangabe.
  const n = liste.length;
  const mx = liste.reduce((s, x) => s + x.ueberhang, 0) / n;
  const my = liste.reduce((s, x) => s + x.wach, 0) / n;
  const sx = Math.sqrt(liste.reduce((s, x) => s + (x.ueberhang - mx) ** 2, 0) / n);
  const sy = Math.sqrt(liste.reduce((s, x) => s + (x.wach - my) ** 2, 0) / n);
  const zusammenhang =
    sx > 0 && sy > 0
      ? liste.reduce((s, x) => s + (x.ueberhang - mx) * (x.wach - my), 0) / (n * sx * sy)
      : 0;

  return { naechte: liste, ruhig: fasse(ruhig), unruhig: fasse(unruhig), zusammenhang };
}

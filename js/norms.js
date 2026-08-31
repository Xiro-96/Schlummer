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
import { DAY } from './schedule.js';

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
  for (const nacht of naechte) {
    let inDieserNacht = 0;
    for (const gap of nacht.interruptions) {
      if (!gap.end) continue;
      const dauer = Math.round((gap.end - gap.start) / 60000);
      if (dauer <= 0) continue;
      inDieserNacht += dauer;
      const stunde = gap.start.getHours();
      stunden.set(stunde, (stunden.get(stunde) || 0) + 1);
      if (!laengste || dauer > laengste.minuten) {
        laengste = { minuten: dauer, start: gap.start, nacht: nacht.start };
      }
    }
    if (inDieserNacht > 0) mitWachphasen++;
    minutenGesamt += inDieserNacht;
  }
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
    haeufigsteStunde
  };
}

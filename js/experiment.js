/**
 * Experimente: eine Änderung eine Woche lang durchziehen und danach ehrlich
 * nachrechnen, ob die Nächte besser geworden sind.
 *
 * Der Grund dafür ist, dass alles andere in dieser App Beobachtung ist.
 * Beobachtung kann Ursache und Wirkung verwechseln: Ein später Morgen kann
 * die Folge einer schlechten Nacht sein statt ihr Auslöser. Wer die Zeiten
 * dagegen absichtlich setzt und vorher sagt, was er erwartet, kann das
 * trennen.
 *
 * Die Auswertung ist bewusst vorsichtig. Sieben Nächte gegen sieben Nächte
 * sind wenig; ein Unterschied von zwei Nächten kann reiner Zufall sein.
 * Deshalb steht neben jedem Ergebnis, wie oft derselbe Unterschied bei
 * reinem Zufall herauskäme (exakter Test nach Fisher), und bei zu dünner
 * Datenlage sagt die Auswertung das, statt eine Zahl zu behaupten.
 *
 * Reine Funktionen, keine Speicher- oder DOM-Zugriffe.
 */
import { DAY, minutesBetween } from './schedule.js';

/** Eine Wachphase ab dieser Länge gilt als die, um die es geht. */
export const LANGE_PHASE = 60;
/** So lange läuft ein Experiment normalerweise. */
export const STANDARD_TAGE = 7;
/** So weit darf ein Tag von der Vorgabe abweichen und gilt noch als gehalten. */
export const TOLERANZ = 30;

function tagKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function minutenImTag(date) {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Nächte mit ihrem Tag davor, als Rohmaterial für beide Phasen.
 *
 * Eine Nacht gehört zu dem Tag, an dessen Abend sie beginnt - zusammen mit
 * den Nickerchen dieses Tages. So steht beieinander, was zusammen wirkt.
 */
export function naechteMitTag(sleeps, { sickDays = [] } = {}) {
  const krank = new Set(sickDays);
  const naps = sleeps.filter((s) => s.type === 'nap' && s.end);
  const rows = [];
  for (const nacht of sleeps) {
    if (nacht.type !== 'night' || !nacht.end) continue;
    const imBett = minutesBetween(nacht.start, nacht.end);
    // Offensichtliche Fehleinträge draußen lassen.
    if (imBett < 4 * 60 || imBett > 16 * 60) continue;
    const key = tagKey(nacht.start);
    if (krank.has(key) || krank.has(tagKey(nacht.end))) continue;
    const gaps = (nacht.interruptions || []).filter((g) => g.end);
    const wach = gaps.reduce((summe, g) => summe + minutesBetween(g.start, g.end), 0);
    const tagschlaf = naps
      .filter((n) => tagKey(n.start) === key)
      .reduce((summe, n) => summe + minutesBetween(n.start, n.end), 0);
    rows.push({
      key,
      datum: nacht.start,
      bettMinute: minutenImTag(nacht.start),
      aufMinute: minutenImTag(nacht.end),
      imBett,
      wach,
      tagschlaf,
      angebot: imBett + tagschlaf,
      geschlafen: imBett - wach + tagschlaf,
      lang: gaps.some((g) => minutesBetween(g.start, g.end) >= LANGE_PHASE)
    });
  }
  return rows.sort((a, b) => a.datum - b.datum);
}

/** Wurde die Vorgabe an diesem Tag eingehalten? */
export function tagGehalten(row, ziel, toleranz = TOLERANZ) {
  if (!row || !ziel) return null;
  const punkte = [];
  if (ziel.bettMinute != null) {
    punkte.push(Math.abs(row.bettMinute - ziel.bettMinute) <= toleranz);
  }
  if (ziel.aufMinute != null) {
    punkte.push(Math.abs(row.aufMinute - ziel.aufMinute) <= toleranz);
  }
  if (ziel.tagschlaf != null) {
    punkte.push(row.tagschlaf <= ziel.tagschlaf + toleranz);
  }
  if (!punkte.length) return null;
  return punkte.every(Boolean);
}

const median = (werte) => {
  if (!werte.length) return null;
  const s = [...werte].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** Kennzahlen einer Phase. */
export function phaseStats(rows) {
  return {
    naechte: rows.length,
    lang: rows.filter((r) => r.lang).length,
    unruhig: rows.filter((r) => r.wach >= 20).length,
    wachMedian: median(rows.map((r) => r.wach)),
    wachSumme: rows.reduce((summe, r) => summe + r.wach, 0),
    angebotMedian: median(rows.map((r) => r.angebot)),
    geschlafenMedian: median(rows.map((r) => r.geschlafen)),
    tagschlafMedian: median(rows.map((r) => r.tagschlaf)),
    bettMedian: median(rows.map((r) => r.bettMinute)),
    aufMedian: median(rows.map((r) => r.aufMinute))
  };
}

function logFakultaet(n) {
  let summe = 0;
  for (let i = 2; i <= n; i++) summe += Math.log(i);
  return summe;
}

function hypergeometrisch(a, b, c, d) {
  const n = a + b + c + d;
  return Math.exp(
    logFakultaet(a + b) +
      logFakultaet(c + d) +
      logFakultaet(a + c) +
      logFakultaet(b + d) -
      logFakultaet(n) -
      logFakultaet(a) -
      logFakultaet(b) -
      logFakultaet(c) -
      logFakultaet(d)
  );
}

/**
 * Exakter Test nach Fisher, zweiseitig.
 *
 * Für die Vierfeldertafel "lange Wachphase ja/nein" mal "vorher/nachher".
 * Bei sieben Nächten je Phase ist jede andere Rechnung eine Näherung, die
 * genau dort danebenliegt, wo es darauf ankommt.
 *
 * @returns {number} Wahrscheinlichkeit, diesen Unterschied oder einen
 *   deutlicheren rein zufällig zu sehen (0..1)
 */
export function fisherExact(a, b, c, d) {
  if ([a, b, c, d].some((x) => !Number.isInteger(x) || x < 0)) return 1;
  const beobachtet = hypergeometrisch(a, b, c, d);
  const zeile1 = a + b;
  const spalte1 = a + c;
  const n = a + b + c + d;
  if (!n) return 1;
  let summe = 0;
  const von = Math.max(0, spalte1 - (n - zeile1));
  const bis = Math.min(zeile1, spalte1);
  for (let i = von; i <= bis; i++) {
    const p = hypergeometrisch(i, zeile1 - i, spalte1 - i, n - zeile1 - spalte1 + i);
    // Das 1e-9 fängt Rundungsfehler ab, sonst fällt der beobachtete Fall
    // selbst manchmal aus der eigenen Summe heraus.
    if (p <= beobachtet * (1 + 1e-9)) summe += p;
  }
  return Math.min(1, summe);
}

/**
 * Die Auswertung eines Experiments: Vergleichszeitraum gegen Experiment.
 *
 * @param {object[]} sleeps  Einträge mit Date-Objekten
 * @param {object}   exp     {start, tage, ziel}
 * @param {object}   [opts]  now, sickDays, vergleichTage
 * @returns {object} Kennzahlen beider Phasen plus Einordnung
 */
export function experimentReport(sleeps, exp, { now = new Date(), sickDays = [], vergleichTage = null } = {}) {
  if (!exp || !exp.start) return null;
  const start = new Date(exp.start);
  const tage = exp.tage || STANDARD_TAGE;
  const ende = new Date(start.getTime() + tage * DAY);
  const bis = exp.ende ? new Date(exp.ende) : ende;
  const vergleich = vergleichTage || tage * 2;
  const vorherVon = new Date(start.getTime() - vergleich * DAY);

  const alle = naechteMitTag(sleeps, { sickDays });
  const vorher = alle.filter((r) => r.datum >= vorherVon && r.datum < start);
  const waehrend = alle.filter((r) => r.datum >= start && r.datum < bis && r.datum <= now);

  const gehalten = waehrend
    .map((r) => tagGehalten(r, exp.ziel))
    .filter((x) => x !== null);

  const a = waehrend.filter((r) => r.lang).length;
  const b = waehrend.length - a;
  const c = vorher.filter((r) => r.lang).length;
  const d = vorher.length - c;
  const genug = waehrend.length >= 4 && vorher.length >= 4;

  const vergangene = Math.max(0, Math.floor((Math.min(now, bis) - start) / DAY));
  return {
    start,
    bis,
    tage,
    laeuft: !exp.ende && now < ende,
    tagNummer: Math.min(tage, vergangene + 1),
    vorher: phaseStats(vorher),
    waehrend: phaseStats(waehrend),
    gehalten: { tage: gehalten.filter(Boolean).length, von: gehalten.length },
    genug,
    // Wie oft käme dieser Unterschied bei reinem Zufall heraus?
    zufall: genug ? fisherExact(a, b, c, d) : null,
    ziel: exp.ziel || null,
    name: exp.name || ''
  };
}

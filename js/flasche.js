/**
 * Abendflasche, Nachtflasche, volle Windel - und was davon mit den langen
 * Wachphasen zusammenhängt.
 *
 * Hintergrund: Bei einem Kind, das abends knapp 300 ml bekommt, nachts eine
 * sehr volle Windel hat und dann eine Flasche, stehen drei Erklärungen
 * nebeneinander - die Blase, der Durst und die Gewohnheit. Welche davon
 * zutrifft, lässt sich nicht erschließen, sondern nur beobachten: zwei
 * Angaben pro Wachphase und die Abendmenge, zwei Wochen lang.
 *
 * Die Auswertung sagt ausdrücklich, wenn die Daten nicht reichen. Bei zwei
 * Wochen geht es um gut ein Dutzend Nächte; das trägt eine Richtung, aber
 * selten einen Beweis. Deshalb steht neben jedem Vergleich, wie oft er bei
 * reinem Zufall so ausfiele.
 *
 * Reine Funktionen, keine Speicher- oder DOM-Zugriffe.
 */
import { DAY, minutesBetween } from './schedule.js';
import { fisherExact, LANGE_PHASE } from './experiment.js';

/** So viele beantwortete Nächte braucht eine Aussage mindestens. */
export const MIN_NAECHTE = 5;

function median(werte) {
  if (!werte.length) return null;
  const s = [...werte].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * Die Nächte eines Zeitraums mit allem, was zu Flasche und Windel erfasst ist.
 *
 * @param {object[]} sleeps Einträge mit Date-Objekten
 * @param {object}   [opts] days, now, sickDays
 */
export function flaschenNaechte(sleeps, { days = 21, now = new Date(), sickDays = [] } = {}) {
  const von = new Date(now.getTime() - days * DAY);
  const krank = new Set(sickDays);
  const tagKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const rows = [];
  for (const nacht of sleeps) {
    if (nacht.type !== 'night' || !nacht.end) continue;
    if (nacht.start < von || nacht.start > now) continue;
    const imBett = minutesBetween(nacht.start, nacht.end);
    if (imBett < 4 * 60 || imBett > 16 * 60) continue;
    if (krank.has(tagKey(nacht.start)) || krank.has(tagKey(nacht.end))) continue;
    const gaps = (nacht.interruptions || []).filter((g) => g.end);
    const wach = gaps.reduce((summe, g) => summe + minutesBetween(g.start, g.end), 0);
    rows.push({
      datum: nacht.start,
      abendMl: Number.isFinite(nacht.flascheMl) ? nacht.flascheMl : null,
      // Dreiwertig je Nacht: true, wenn in mindestens einer Phase angegeben;
      // false, wenn mindestens eine Phase ausdrücklich verneint wurde;
      // null, wenn zu dieser Nacht nichts beantwortet ist.
      flasche: zusammen(gaps.map((g) => g.flasche)),
      windel: zusammen(gaps.map((g) => g.windel)),
      wach,
      phasen: gaps.length,
      lang: gaps.some((g) => minutesBetween(g.start, g.end) >= LANGE_PHASE),
      laengste: gaps.length
        ? Math.max(...gaps.map((g) => minutesBetween(g.start, g.end)))
        : 0
    });
  }
  return rows.sort((a, b) => a.datum - b.datum);
}

function zusammen(werte) {
  if (werte.some((w) => w === true)) return true;
  if (werte.some((w) => w === false)) return false;
  return null;
}

/** Zwei Gruppen gegeneinander, mit Zufallswahrscheinlichkeit. */
function vergleich(mit, ohne) {
  if (mit.length < MIN_NAECHTE || ohne.length < MIN_NAECHTE) {
    return { genug: false, mit: beschreibe(mit), ohne: beschreibe(ohne), zufall: null };
  }
  const a = mit.filter((r) => r.lang).length;
  const b = mit.length - a;
  const c = ohne.filter((r) => r.lang).length;
  const d = ohne.length - c;
  return {
    genug: true,
    mit: beschreibe(mit),
    ohne: beschreibe(ohne),
    zufall: fisherExact(a, b, c, d)
  };
}

function beschreibe(rows) {
  return {
    naechte: rows.length,
    lang: rows.filter((r) => r.lang).length,
    wachMedian: median(rows.map((r) => r.wach)),
    laengsteMedian: median(rows.map((r) => r.laengste))
  };
}

/**
 * Was die erfassten Nächte über Flasche und Windel sagen.
 *
 * @returns {null|object} null, wenn zu dieser Frage noch gar nichts erfasst ist
 */
export function flaschenReport(sleeps, opts = {}) {
  const rows = flaschenNaechte(sleeps, opts);
  const beantwortet = rows.filter((r) => r.flasche !== null || r.windel !== null);
  const mitMenge = rows.filter((r) => r.abendMl != null);
  if (!beantwortet.length && !mitMenge.length) return null;

  const mitFlasche = rows.filter((r) => r.flasche === true);
  const ohneFlasche = rows.filter((r) => r.flasche === false);
  const volleWindel = rows.filter((r) => r.windel === true);
  const trocken = rows.filter((r) => r.windel === false);

  // Die Abendmenge gegen die Wachzeit: an der Grenze geteilt, die beide
  // Gruppen groß genug lässt - der Median der erfassten Mengen.
  let menge = null;
  if (mitMenge.length >= 2 * MIN_NAECHTE) {
    const grenze = median(mitMenge.map((r) => r.abendMl));
    const viel = mitMenge.filter((r) => r.abendMl >= grenze);
    const wenig = mitMenge.filter((r) => r.abendMl < grenze);
    if (viel.length >= MIN_NAECHTE && wenig.length >= MIN_NAECHTE) {
      menge = { grenze, ...vergleich(viel, wenig) };
    }
  }

  return {
    naechte: rows.length,
    beantwortet: beantwortet.length,
    mitMenge: mitMenge.length,
    mengeMedian: mitMenge.length ? median(mitMenge.map((r) => r.abendMl)) : null,
    flasche: vergleich(mitFlasche, ohneFlasche),
    windel: vergleich(volleWindel, trocken),
    menge
  };
}

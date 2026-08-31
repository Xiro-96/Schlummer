/**
 * Füttern und Wickeln.
 *
 * Bewusst getrennt vom Schlaf-Lernen: Diese Daten dienen dem Überblick im
 * Alltag ("wann war die letzte Mahlzeit?") und der Statistik, sie fließen
 * nicht in den Schlafplan ein.
 *
 * Reine Funktionen, keine Speicher- oder DOM-Zugriffe.
 */
import { DAY, minutesBetween } from './schedule.js';

/** Was erfasst werden kann - Reihenfolge bestimmt die Anzeige. */
export const EVENT_TYPES = {
  feed: {
    label: 'Fütterung',
    emoji: '🍼',
    kinds: [
      { id: 'breast', emoji: '🤱', label: 'Stillen', hint: 'Seite und Dauer optional' },
      { id: 'bottle', emoji: '🍼', label: 'Flasche', hint: 'Menge in ml' },
      { id: 'solid', emoji: '🥣', label: 'Beikost', hint: 'Brei, Fingerfood' }
    ]
  },
  diaper: {
    label: 'Wickeln',
    emoji: '🧷',
    kinds: [
      { id: 'wet', emoji: '💧', label: 'Nass', hint: 'nur Urin' },
      { id: 'dirty', emoji: '💩', label: 'Stuhl', hint: 'nur Stuhl' },
      { id: 'both', emoji: '💧💩', label: 'Beides', hint: 'nass und Stuhl' }
    ]
  }
};

export const SIDES = [
  { id: 'left', label: 'Links' },
  { id: 'right', label: 'Rechts' },
  { id: 'both', label: 'Beide' }
];

/** Menschenlesbare Bezeichnung eines Eintrags, z. B. "Flasche 120 ml". */
export function describeEvent(event) {
  const type = EVENT_TYPES[event.type];
  if (!type) return '';
  const kind = type.kinds.find((k) => k.id === event.kind);
  const label = kind ? kind.label : type.label;
  if (event.type === 'feed') {
    if (event.kind === 'bottle' && event.amountMl) return `${label} ${event.amountMl} ml`;
    if (event.kind === 'breast') {
      const side = SIDES.find((s) => s.id === event.side);
      const parts = [label];
      if (side) parts.push(side.label.toLowerCase());
      if (event.minutes) parts.push(`${event.minutes} Min`);
      return parts.join(' ');
    }
  }
  return label;
}

/** Einträge eines Kalendertages, aufsteigend sortiert. */
export function eventsForDay(events, day = new Date()) {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const to = new Date(from.getTime() + DAY);
  return events
    .filter((e) => e.at >= from && e.at < to)
    .sort((a, b) => a.at - b.at);
}

/** Jüngster Eintrag eines Typs (oder null). */
export function lastEvent(events, type) {
  return (
    events
      .filter((e) => e.type === type)
      .sort((a, b) => a.at - b.at)
      .pop() || null
  );
}

/**
 * Tageszusammenfassung.
 * @returns {{feeds:number, breast:number, bottle:number, solid:number,
 *            totalMl:number, diapers:number, wet:number, dirty:number,
 *            longestFeedGapMin:number|null}}
 */
export function summarizeDay(events, day = new Date()) {
  const list = eventsForDay(events, day);
  const feeds = list.filter((e) => e.type === 'feed');
  const diapers = list.filter((e) => e.type === 'diaper');

  let longestFeedGapMin = null;
  for (let i = 1; i < feeds.length; i++) {
    const gap = minutesBetween(feeds[i - 1].at, feeds[i].at);
    if (longestFeedGapMin == null || gap > longestFeedGapMin) longestFeedGapMin = gap;
  }

  const count = (type, kind) => type.filter((e) => e.kind === kind).length;
  return {
    feeds: feeds.length,
    breast: count(feeds, 'breast'),
    bottle: count(feeds, 'bottle'),
    solid: count(feeds, 'solid'),
    totalMl: feeds.reduce((sum, e) => sum + (Number(e.amountMl) || 0), 0),
    diapers: diapers.length,
    // "Beides" zählt für nass und für Stuhl.
    wet: diapers.filter((e) => e.kind === 'wet' || e.kind === 'both').length,
    dirty: diapers.filter((e) => e.kind === 'dirty' || e.kind === 'both').length,
    longestFeedGapMin
  };
}

/**
 * Schlaf und Alltagseinträge in einer gemeinsamen Liste, neueste zuerst.
 * Schlaf wird über seinen Beginn einsortiert.
 */
export function mergeTimeline(sleeps, events) {
  const items = [
    ...sleeps.map((s) => ({ kind: 'sleep', at: s.start, data: s })),
    ...events.map((e) => ({ kind: 'event', at: e.at, data: e }))
  ];
  return items.sort((a, b) => b.at - a.at);
}

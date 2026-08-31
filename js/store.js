/**
 * Persistenz + App-Zustand. Alles bleibt lokal im Browser (localStorage),
 * es geht kein Byte an einen Server.
 */
import { DAY, timeOnDay, minutesBetween } from './schedule.js';

const KEY = 'schlummer.state.v1';

const DEFAULT_STATE = {
  version: 1,
  child: { name: '', birthDate: '', dueDate: '' },
  settings: {
    morningWake: '07:00',
    soundTimerMin: 45,
    soundVolume: 0.6,
    lastSound: 'white',
    learning: true,
    napCount: 'auto',
    ratePrompt: true,
    reminders: false,
    onboarded: false,
    lastBackupAt: null
  },
  sleeps: [],
  events: [],
  notes: []
};

let state = null;
const listeners = new Set();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? { ...clone(DEFAULT_STATE), ...JSON.parse(raw) } : clone(DEFAULT_STATE);
    state.settings = { ...DEFAULT_STATE.settings, ...(state.settings || {}) };
    state.child = { ...DEFAULT_STATE.child, ...(state.child || {}) };
    state.sleeps = Array.isArray(state.sleeps) ? state.sleeps : [];
    state.events = Array.isArray(state.events) ? state.events : [];
    state.notes = Array.isArray(state.notes) ? state.notes : [];
  } catch (err) {
    console.warn('Gespeicherte Daten unlesbar, starte neu.', err);
    state = clone(DEFAULT_STATE);
  }
  return state;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Speichern fehlgeschlagen (privater Modus?)', err);
  }
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return load();
}

export function update(mutator) {
  mutator(load());
  save();
}

/* ------------------------------------------------------------------ Kind */

export function hasChild() {
  return Boolean(load().child.birthDate);
}

export function birthDate() {
  const raw = load().child.birthDate;
  return raw ? new Date(`${raw}T00:00:00`) : null;
}

export function dueDate() {
  const raw = load().child.dueDate;
  return raw ? new Date(`${raw}T00:00:00`) : null;
}

/* ---------------------------------------------------------------- Schlaf */

function toDate(value) {
  return value ? new Date(value) : null;
}

/** Alle Einträge als Objekte mit echten Dates, aufsteigend sortiert. */
export function allSleeps() {
  return load()
    .sleeps.map((s) => ({
      ...s,
      start: toDate(s.start),
      end: toDate(s.end),
      interruptions: (s.interruptions || []).map((i) => ({
        start: toDate(i.start),
        end: toDate(i.end)
      }))
    }))
    .sort((a, b) => a.start - b.start);
}

/**
 * Nettoschlaf eines Eintrags: Dauer abzüglich nächtlicher Wachphasen.
 * @param {object} sleep  Eintrag mit Date-Objekten
 * @param {Date}   now    für noch laufende Einträge
 */
export function netSleepMinutes(sleep, now = new Date()) {
  const end = sleep.end || now;
  let minutes = minutesBetween(sleep.start, end);
  for (const gap of sleep.interruptions || []) {
    const gapEnd = gap.end || now;
    if (gapEnd > gap.start) minutes -= minutesBetween(gap.start, gapEnd);
  }
  return Math.max(0, minutes);
}

/** Die gerade offene nächtliche Wachphase, falls es eine gibt. */
export function openInterruption() {
  const running = runningSleep();
  if (!running || !running.interruptions) return null;
  const index = running.interruptions.findIndex((i) => !i.end);
  return index === -1 ? null : { sleep: running, index, gap: running.interruptions[index] };
}

/** Nächtliches Aufwachen beginnen (das Kind ist wach, die Nacht läuft weiter). */
export function startNightWaking(at = new Date()) {
  const running = runningSleep();
  if (!running) return null;
  update((s) => {
    const entry = s.sleeps.find((x) => x.id === running.id);
    if (!entry) return;
    entry.interruptions = entry.interruptions || [];
    if (entry.interruptions.some((i) => !i.end)) return;
    entry.interruptions.push({ start: at.toISOString(), end: null });
  });
  return running.id;
}

/** Nächtliches Aufwachen beenden - das Kind schläft wieder. */
export function endNightWaking(at = new Date()) {
  update((s) => {
    for (const entry of s.sleeps) {
      const gap = (entry.interruptions || []).find((i) => !i.end);
      if (gap) {
        gap.end = at.toISOString();
        return;
      }
    }
  });
}

export function updateInterruption(sleepId, index, patch) {
  update((s) => {
    const entry = s.sleeps.find((x) => x.id === sleepId);
    const gap = entry && entry.interruptions ? entry.interruptions[index] : null;
    if (!gap) return;
    if (patch.start) gap.start = patch.start.toISOString();
    if ('end' in patch) gap.end = patch.end ? patch.end.toISOString() : null;
  });
}

export function addInterruption(sleepId, start, end) {
  update((s) => {
    const entry = s.sleeps.find((x) => x.id === sleepId);
    if (!entry) return;
    entry.interruptions = entry.interruptions || [];
    entry.interruptions.push({ start: start.toISOString(), end: end ? end.toISOString() : null });
    entry.interruptions.sort((a, b) => new Date(a.start) - new Date(b.start));
  });
}

export function deleteInterruption(sleepId, index) {
  update((s) => {
    const entry = s.sleeps.find((x) => x.id === sleepId);
    if (entry && entry.interruptions) entry.interruptions.splice(index, 1);
  });
}

export function runningSleep() {
  return allSleeps().find((s) => !s.end) || null;
}

export function startSleep(type = 'nap', at = new Date()) {
  const entry = {
    id: `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    type,
    start: at.toISOString(),
    end: null,
    note: '',
    settle: null,
    mood: null,
    wakings: null,
    // Nächtliches Aufwachen: Zeitspannen innerhalb dieser Nacht
    interruptions: []
  };
  update((s) => {
    s.sleeps.forEach((x) => {
      if (!x.end) x.end = at.toISOString();
    });
    s.sleeps.push(entry);
  });
  return entry.id;
}

/**
 * Beendet den laufenden Schlaf. Fehlstarts unter einer Minute werden
 * verworfen statt als 0-Minuten-Eintrag im Protokoll zu landen.
 * @returns {string|null} id des beendeten Eintrags (zum Bewerten) oder null
 */
export function stopSleep(at = new Date()) {
  let stopped = null;
  update((s) => {
    for (let i = s.sleeps.length - 1; i >= 0; i--) {
      if (s.sleeps[i].end) continue;
      const started = new Date(s.sleeps[i].start);
      const minutes = (at - started) / 60000;
      if (minutes < 0) {
        // Startzeit liegt in der Zukunft (verstellte Uhr, Zeitumstellung):
        // Eintrag behalten statt ihn stillschweigend zu verlieren.
        s.sleeps[i].end = new Date(started.getTime() + 60 * 1000).toISOString();
        stopped = s.sleeps[i].id;
      } else if (minutes < 1) {
        s.sleeps.splice(i, 1);
      } else {
        s.sleeps[i].end = at.toISOString();
        stopped = s.sleeps[i].id;
      }
      break;
    }
  });
  return stopped;
}

/**
 * Macht einen versehentlich beendeten Schlaf wieder zum laufenden.
 * Ein anderer laufender Schlaf wird dabei geschlossen, damit nie zwei
 * gleichzeitig laufen.
 */
export function resumeSleep(id) {
  update((s) => {
    const entry = s.sleeps.find((x) => x.id === id);
    if (!entry) return;
    const now = new Date().toISOString();
    s.sleeps.forEach((x) => {
      if (x.id !== id && !x.end) x.end = now;
    });
    entry.end = null;
  });
}

/** Bewertung eines Schlafs: wie das Einschlafen lief, wie das Aufwachen war. */
export function rateSleep(id, { settle, mood, wakings }) {
  update((s) => {
    const entry = s.sleeps.find((x) => x.id === id);
    if (!entry) return;
    if (settle !== undefined) entry.settle = settle;
    if (mood !== undefined) entry.mood = mood;
    if (wakings !== undefined) entry.wakings = wakings;
  });
}

/** @returns {string} id des neuen Eintrags */
export function addSleep({ start, end, type = 'nap', note = '', settle = null, mood = null }) {
  const id = `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  update((s) => {
    s.sleeps.push({
      id,
      type,
      start: start.toISOString(),
      end: end ? end.toISOString() : null,
      note,
      settle,
      mood,
      wakings: null,
      interruptions: []
    });
  });
  return id;
}

export function updateSleep(id, patch) {
  update((s) => {
    const entry = s.sleeps.find((x) => x.id === id);
    if (!entry) return;
    if (patch.start) entry.start = patch.start.toISOString();
    if ('end' in patch) entry.end = patch.end ? patch.end.toISOString() : null;
    if ('note' in patch) entry.note = patch.note;
    if ('settle' in patch) entry.settle = patch.settle;
    if ('mood' in patch) entry.mood = patch.mood;
    if ('wakings' in patch) entry.wakings = patch.wakings;
    if (patch.type) entry.type = patch.type;
  });
}

export function deleteSleep(id) {
  update((s) => {
    s.sleeps = s.sleeps.filter((x) => x.id !== id);
  });
}

/** Tagschlaf-Einträge eines Kalendertages (nach Startzeit). */
export function napsForDay(day = new Date()) {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const to = new Date(from.getTime() + DAY);
  return allSleeps().filter((s) => s.type === 'nap' && s.start >= from && s.start < to);
}

/**
 * Aufwachzeit am Morgen: Ende der Nacht, die an diesem Tag am Morgen endete.
 *
 * Das Zeitfenster ist wichtig: Wird abends eine Nacht beendet und neu
 * gestartet (weil das Kind kurz wach war), darf 19:49 nicht plötzlich als
 * "aufgewacht am Morgen" gelten.
 */
export function morningWakeFor(day = new Date()) {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const morningStart = new Date(from.getTime() + 2 * 60 * 60 * 1000);
  const morningEnd = new Date(from.getTime() + 12 * 60 * 60 * 1000);
  const night = allSleeps()
    .filter((s) => s.type === 'night' && s.end && s.end >= morningStart && s.end < morningEnd)
    .pop();
  if (night) return night.end;
  return timeOnDay(day, load().settings.morningWake);
}

/**
 * Einträge, mit denen der Tagesplan rechnet: die Nickerchen des Tages plus
 * die Nacht dieses Abends (laufend oder bereits beendet).
 */
export function sleepsForPlan(day = new Date()) {
  const morning = morningWakeFor(day);
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const to = new Date(from.getTime() + DAY);
  const naps = napsForDay(day);
  const nights = allSleeps().filter(
    (s) =>
      s.type === 'night' &&
      // Eine laufende Nacht gehört immer dazu: Solange sie läuft, hat der
      // neue Tag noch nicht begonnen.
      (!s.end || (s.start >= morning && s.start < to))
  );
  return [...naps, ...nights].sort((a, b) => a.start - b.start);
}

/** Letzter bekannter Wachzeitpunkt (Ende des jüngsten beendeten Schlafs). */
export function lastWakeUp(day = new Date()) {
  const finished = allSleeps().filter((s) => s.end && s.end <= new Date());
  const last = finished[finished.length - 1];
  const morning = morningWakeFor(day);
  if (last && last.end > morning) return last.end;
  return morning;
}

/* ------------------------------------------------- Füttern und Wickeln */

/** Alle Alltagseinträge mit echten Dates, aufsteigend sortiert. */
export function allEvents() {
  return load()
    .events.map((e) => ({ ...e, at: toDate(e.at) }))
    .sort((a, b) => a.at - b.at);
}

export function addEvent({ type, kind, at = new Date(), side = null, amountMl = null, minutes = null, note = '' }) {
  const id = `e${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  update((s) => {
    s.events.push({ id, type, kind, at: at.toISOString(), side, amountMl, minutes, note });
  });
  return id;
}

export function updateEvent(id, patch) {
  update((s) => {
    const entry = s.events.find((x) => x.id === id);
    if (!entry) return;
    if (patch.at) entry.at = patch.at.toISOString();
    for (const key of ['type', 'kind', 'side', 'amountMl', 'minutes', 'note']) {
      if (key in patch) entry[key] = patch[key];
    }
  });
}

export function deleteEvent(id) {
  update((s) => {
    s.events = s.events.filter((x) => x.id !== id);
  });
}

/* -------------------------------------------------------------- Statistik */

/** Schlafminuten pro Kalendertag der letzten n Tage (älteste zuerst). */
export function dailyStats(days = 7, now = new Date()) {
  const out = [];
  const sleeps = allSleeps().filter((s) => s.end);
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const from = day;
    const to = new Date(day.getTime() + DAY);
    let nap = 0;
    let night = 0;
    let naps = 0;
    for (const s of sleeps) {
      // Ueberlappung des Schlafs mit dem Tagesfenster (Nacht zählt anteilig).
      const start = s.start > from ? s.start : from;
      const end = s.end < to ? s.end : to;
      let minutes = minutesBetween(start, end);
      // Nächtliche Wachphasen zählen nicht als Schlaf.
      for (const gap of s.interruptions || []) {
        if (!gap.end) continue;
        const gapStart = gap.start > start ? gap.start : start;
        const gapEnd = gap.end < end ? gap.end : end;
        if (gapEnd > gapStart) minutes -= minutesBetween(gapStart, gapEnd);
      }
      if (minutes <= 0) continue;
      if (s.type === 'night') night += minutes;
      else {
        nap += minutes;
        if (s.start >= from && s.start < to) naps += 1;
      }
    }
    out.push({ day, nap, night, total: nap + night, naps });
  }
  return out;
}

/* --------------------------------------------------------------- Notizen */

/**
 * Notizen aus dem Alltagstest ("Plan lag daneben", "Ton brach ab").
 * Sie landen im Export und liefern damit den Kontext zu den Zahlen.
 */
export function allNotes() {
  return load()
    .notes.map((n) => ({ ...n, at: toDate(n.at) }))
    .sort((a, b) => b.at - a.at);
}

export function addNote(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  const id = `n${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  update((s) => {
    s.notes.push({ id, at: new Date().toISOString(), text: trimmed });
  });
  return id;
}

export function deleteNote(id) {
  update((s) => {
    s.notes = s.notes.filter((n) => n.id !== id);
  });
}

/** Merkt sich, wann zuletzt gesichert wurde. */
export function markBackup() {
  update((s) => {
    s.settings.lastBackupAt = new Date().toISOString();
  });
}

/* ---------------------------------------------------------- Import/Export */

export function exportJSON() {
  return JSON.stringify(load(), null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.sleeps)) {
    throw new Error('Datei passt nicht zum Schlummer-Format.');
  }
  state = { ...clone(DEFAULT_STATE), ...parsed };
  state.events = Array.isArray(parsed.events) ? parsed.events : [];
  state.notes = Array.isArray(parsed.notes) ? parsed.notes : [];
  state.settings = { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) };
  state.child = { ...DEFAULT_STATE.child, ...(parsed.child || {}) };
  save();
}

export function resetAll() {
  state = clone(DEFAULT_STATE);
  save();
}

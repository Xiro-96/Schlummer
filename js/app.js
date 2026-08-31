/**
 * Schlummer - Oberfläche, Navigation und Zeitsteuerung.
 */
import { AGE_BANDS, NIGHT_NORMS, RATING, SOURCES, TIRED_SIGNS } from './data.js';
import {
  ageInDays,
  addMinutes,
  bandForAge,
  buildPlan,
  awakeMinutesIn,
  buildDayReview,
  findConflicts,
  findMissingNights,
  fmtCountdown,
  daysSince,
  fmtCompact,
  fmtDuration,
  fmtShort,
  fmtTime,
  formatAge,
  minutesBetween,
  nightEndFor,
  timeOnDay,
  wakeStatus
} from './schedule.js';
import {
  bandForNapCount,
  expectedNapCount,
  learnProfile,
  napTransitionReport,
  napTrend,
  napTransitionHint,
  personalizedBand,
  sleepPressure,
  toClock
} from './learning.js';
import {
  averageWakings,
  clinicHintsFor,
  compareWakings,
  nightWakingReport,
  wakingCount
} from './norms.js';
import { clockArc, explainNextSleep, shortFormula } from './explain.js';
import * as store from './store.js';
import {
  EVENT_TYPES,
  SIDES,
  describeEvent,
  eventsForDay,
  lastEvent,
  mergeTimeline,
  summarizeDay
} from './tracking.js';
import { SOUNDS, soundById } from './sounds.js';
import * as audio from './audio.js';

const view = document.getElementById('view');
const topbar = document.getElementById('topbar');
const tabbar = document.getElementById('tabbar');
const nowplayingEl = document.getElementById('nowplaying');
const dialog = document.getElementById('dialog');

const TABS = [
  { id: 'heute', label: 'Heute', icon: '🌙' },
  { id: 'plan', label: 'Plan', icon: '🗓️' },
  { id: 'sounds', label: 'Geräusche', icon: '🔊' },
  { id: 'statistik', label: 'Statistik', icon: '📊' },
  { id: 'mehr', label: 'Mehr', icon: '⚙️' }
];

let route = 'heute';
// Welcher Tag im Rückblick angesehen wird (null = heute, live).
let reviewDay = null;
let stripOpen = false;
let stripWeek = null;
/** Welche Ausklapp-Bereiche gerade offen sind (überlebt das Neuzeichnen). */
const expanded = new Set();
let reminderTimer = null;

/* ------------------------------------------------------------- Werkzeuge */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);

/**
 * Kurzmeldung, optional mit einer Aktion ("Rückgängig"). Die bleibt dann
 * länger stehen, damit man sie im Halbschlaf noch trifft.
 */
function toast(message, action = null) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      el.remove();
      action.run();
    });
    el.appendChild(btn);
  }
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), action ? 9000 : 2600);
}

/** "07:30" aus einem Date - unabhängig von Locale-Eigenheiten. */
function hhmm(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localInput(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/**
 * Aktueller Kontext: Alter, Altersband, gelerntes Profil, Plan, Wachstatus.
 * Gerechnet wird immer mit dem persönlichen Band - ohne eigene Daten ist das
 * exakt das Altersband.
 */
function context(now = new Date()) {
  const birth = store.birthDate();
  const days = birth ? ageInDays(birth, store.dueDate(), now) : 0;
  const baseBand = bandForAge(days);
  const profile = store.getState().settings.learning
    ? learnProfile(store.allSleeps(), baseBand, now)
    : { active: false, confidence: 0, samples: { windows: 0, naps: 0, days: 0, napDays: 0 }, values: {} };
  const morningWake = store.morningWakeFor(now);
  const sleeps = store.sleepsForPlan(now);
  const running = store.runningSleep();
  const activeNaps =
    running && !sleeps.some((s) => s.id === running.id) ? [...sleeps, running] : sleeps;
  const napsDone = activeNaps.filter((s) => s.end && s.type !== 'night').length;
  const napsToday = napsDone + (running && running.type !== 'night' ? 1 : 0);
  const tagesNaps = activeNaps
    .filter((s) => s.type !== 'night')
    .sort((a, b) => a.start - b.start);

  // Welche Form hat dieser Tag? Feste Vorgabe der Eltern schlägt alles. Sonst
  // verrät der Beginn des ersten Nickerchens die Form: früh los heißt meist,
  // dass noch eines folgt, spät los, dass eines reicht. Und mehr Nickerchen,
  // als gedacht, sind ohnehin Tatsache.
  const wish = store.getState().settings.napCount;
  const wunsch = wish === 'auto' ? null : Number(wish);
  let tagesform = wunsch;
  if (tagesform == null && tagesNaps.length) {
    const geschaetzt = expectedNapCount(profile, tagesNaps[0].start);
    if (geschaetzt != null) tagesform = geschaetzt;
  }
  if (tagesform != null && tagesform < napsToday) tagesform = napsToday;
  if (tagesform == null && napsToday > baseBand.naps) tagesform = napsToday;

  let band = personalizedBand(baseBand, profile, tagesform);
  if (tagesform != null && tagesform !== band.naps) band = bandForNapCount(band, tagesform);

  // Aufgelaufener Schlaf des Tages: kurze Nickerchen erhöhen den Schlafdruck
  // und ziehen die weiteren Zeiten nach vorn.
  const sleptSoFar = activeNaps
    .filter((s) => s.end && s.type !== 'night')
    .reduce((sum, s) => sum + minutesBetween(s.start, s.end), 0);
  // Die Nacht, die in diesen Morgen geführt hat: ihre Wachphasen zählen mit.
  const lastNight = store
    .allSleeps()
    .filter((s) => s.type === 'night' && s.end && s.end.toDateString() === now.toDateString())
    .pop();
  const nightMinutes = lastNight ? store.netSleepMinutes(lastNight, now) : 0;
  const pressure = sleepPressure(band, napsDone, sleptSoFar, nightMinutes);
  const plan = buildPlan({
    band,
    morningWake,
    sleeps: activeNaps,
    now,
    pressureMinutes: pressure.minutes
  });
  const status = wakeStatus({
    band,
    lastWakeUp: store.lastWakeUp(now),
    sleeps: running ? [running] : [],
    now
  });
  const nextSleep =
    plan.blocks.find((b) => b.type !== 'wake' && !b.actual && b.end > now) || null;

  // Wie stark schwankt dieses Kind wirklich? Ist die Schwankung groß, wäre
  // eine Minutenangabe genauer als die Wirklichkeit - dann zeigt die App das
  // Fenster. Erst wenn der Schlaf läuft, wird aus dem Fenster eine Zeit.
  const streuung = profile.active
    ? nextSleep && nextSleep.type === 'night'
      ? profile.values.lastWindowSpread
      : profile.values.firstWindowSpread
    : null;
  const gemischt = profile.active && (profile.values.napCountMix || 0) >= 0.2;
  let napWindow = null;
  // Morgens ist die Tagesform noch offen. Wechseln sich Tage mit einem und
  // zwei Nickerchen ab, liegen die beiden Vorhersagen weit auseinander - dann
  // ist die Spanne die ehrliche Antwort, nicht eine der beiden Minuten.
  if (gemischt && wunsch == null && napsToday === 0 && !status.sleeping && nextSleep) {
    const varianten = Object.keys(profile.byNapCount || {})
      .map(Number)
      .filter((n) => n > 0 && profile.byNapCount[n].days >= 1.5)
      .map((n) => {
        let b = personalizedBand(baseBand, profile, n);
        if (n !== baseBand.naps) b = bandForNapCount(b, n);
        const p = buildPlan({ band: b, morningWake, sleeps: activeNaps, now });
        const nap = p.blocks.find((x) => x.type === 'nap' && !x.actual);
        return nap ? nap.start : null;
      })
      .filter(Boolean);
    if (varianten.length >= 2) {
      const von = new Date(Math.min(...varianten));
      const bis = new Date(Math.max(...varianten));
      const breite = minutesBetween(von, bis);
      if (breite >= 25 && breite <= 3 * 60) {
        napWindow = { von, bis, gemischt: true, streuung: Math.round(breite / 2), formen: true };
      }
    }
  }
  if (!napWindow && nextSleep && !status.sleeping && streuung != null && streuung >= 20) {
    const halb = Math.min(45, Math.round(streuung));
    let von = addMinutes(nextSleep.start, -halb);
    let bis = addMinutes(nextSleep.start, halb);
    if (nextSleep.type === 'night') {
      // Nie ein Fenster zeigen, das über die Bettzeiten hinausgeht, die die
      // App selbst nie empfehlen würde.
      const frueh = timeOnDay(morningWake, band.bedtimeEarliest);
      const spaet = timeOnDay(morningWake, band.bedtimeLatest);
      if (von < frueh) von = frueh;
      if (bis > spaet) bis = spaet;
    }
    if (minutesBetween(von, bis) >= 20) {
      napWindow = { von, bis, gemischt, streuung: Math.round(streuung) };
    }
  }

  // "früh los = zwei, spät los = eines" in den gelernten Zeiten des Kindes.
  let formZeiten = null;
  if (profile.active && profile.byNapCount) {
    const formen = Object.entries(profile.byNapCount)
      .filter(([, f]) => f.firstNapStart != null && f.days >= 1.5)
      .map(([anzahl, f]) => ({ anzahl: Number(anzahl), start: f.firstNapStart }))
      .sort((a, b) => a.start - b.start);
    if (formen.length === 2) {
      // Die Grenze liegt in der Mitte zwischen den beiden üblichen Startzeiten.
      const grenze = Math.round((formen[0].start + formen[1].start) / 2);
      formZeiten = `erstes Nickerchen vor ${toClock(grenze)} meist ${formen[0].anzahl}, danach ${formen[1].anzahl}`;
    }
  }

  return {
    formZeiten,
    napWindow,
    now,
    days,
    band,
    baseBand,
    nextSleep,
    profile,
    transition: napTransitionHint(baseBand, profile),
    pressure,
    morningWake,
    tagesform,
    sleeps: activeNaps,
    running,
    lastNight,
    nightMinutes,
    plan,
    status
  };
}

/* --------------------------------------------------------------- Bausteine */

function ring({ progress, big, label, sub, over }) {
  const r = 104;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress || 0));
  return `
    <div class="ring ${over ? 'over' : ''}">
      <svg viewBox="0 0 236 236" aria-hidden="true">
        <circle class="track" cx="118" cy="118" r="${r}"></circle>
        <circle class="value" cx="118" cy="118" r="${r}"
          stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - p)).toFixed(1)}"></circle>
      </svg>
      <div class="inner">
        <div class="label">${esc(label)}</div>
        <div class="big">${esc(big)}</div>
        <div class="sub">${sub}</div>
      </div>
    </div>`;
}

/**
 * Was passiert, wenn man einen Block antippt: Erfasstes wird bearbeitet,
 * Geplantes als Vorlage eingetragen. Gleich für Liste und Bogen.
 */
function blockAction(block) {
  if (block.actual && block.id) {
    return `data-action="edit-sleep" data-id="${esc(block.id)}"`;
  }
  if (block.type !== 'wake' && !block.actual) {
    return `data-action="add-sleep-at"
      data-start="${block.start.toISOString()}" data-end="${block.end.toISOString()}"
      data-type="${block.type}"${block.continuation ? ' data-running="1"' : ''}`;
  }
  return '';
}

function blockRow(block, now) {
  const label =
    block.type === 'nap'
      ? `Nickerchen ${block.index || ''}`.trim()
      : block.type === 'night'
        ? block.continuation || block.continued
          ? 'Nacht geht weiter'
          : 'Nachtschlaf'
        : block.atNight
          ? 'Nachts wach'
          : block.evening
            ? 'Abendwachfenster'
            : 'Wachfenster';
  const tags = [];
  // Wachfenster ergeben sich aus den Schlafzeiten - sie brauchen kein Schild.
  if (block.running) tags.push('<span class="tag live">läuft</span>');
  else if (block.type === 'wake') tags.push('');
  else if (block.actual) tags.push('<span class="tag">erfasst</span>');
  else if (!block.actual) tags.push('<span class="tag">geplant</span>');
  const duration = fmtDuration(minutesBetween(block.start, block.end));
  const dotClass = block.type === 'wake' ? 'wake' : block.type;

  // Erfasste Schläfchen lassen sich direkt hier korrigieren, geplante als
  // Vorlage übernehmen - beides der häufigste Handgriff im Alltag.
  const tap = blockAction(block);
  const action = tap
    ? `class="tappable" role="button" tabindex="0" ${tap}
       aria-label="${esc(label)} ${block.actual ? 'bearbeiten' : 'eintragen'}"`
    : '';

  return `
    <li ${action}>
      <span class="time">${fmtTime(block.start)}${
        block.type === 'wake' ? '' : `<br>${fmtTime(block.end)}`
      }</span>
      <span class="what">
        <span class="dot ${dotClass}"></span>
        <strong>${esc(label)}</strong>
        <span class="muted">${duration}</span>
        ${tags.join('')}
        ${action ? '<span class="edit-hint" aria-hidden="true">✎</span>' : ''}
      </span>
    </li>`;
}

/* ------------------------------------------------------------------ Views */

/* --------------------------------------------------------- Tagesbogen */

const ARC = { cx: 150, cy: 150, r: 118, from: -150, sweep: 300 };

/** Punkt auf dem Bogen für einen Anteil 0..1 des Wachtages. */
function arcPoint(fraction, radius = ARC.r) {
  const angle = ((ARC.from + fraction * ARC.sweep) * Math.PI) / 180;
  return {
    x: ARC.cx + Math.sin(angle) * radius,
    y: ARC.cy - Math.cos(angle) * radius
  };
}

/** SVG-Pfad für ein Bogenstück zwischen zwei Anteilen. */
function arcPath(fromFraction, toFraction, radius = ARC.r) {
  const a = arcPoint(fromFraction, radius);
  const b = arcPoint(toFraction, radius);
  const large = (toFraction - fromFraction) * ARC.sweep > 180 ? 1 : 0;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${radius} ${radius} 0 ${large} 1 ${b.x.toFixed(
    1
  )} ${b.y.toFixed(1)}`;
}

/**
 * Was in der Mitte des Bogens steht: laufender Schlaf, nächtliches Wachsein
 * oder der Countdown zum nächsten Schlaf. Läuft im Sekundentakt weiter.
 */
function arcCenter(ctx) {
  const { morningWake, now, status, band, nextSleep } = ctx;
  if (status.nightWaking) {
    return {
      head: 'Nachts wach seit',
      big: fmtCompact(status.minutes),
      sub: `seit ${fmtTime(status.since)}`
    };
  }
  if (status.sleeping) {
    const ende = status.night
      ? nightEndFor(status.since, morningWake, band, awakeMinutesIn(ctx.running, now))
      : addMinutes(status.since, band.napLengthMin);
    return {
      head: status.night ? 'Nacht läuft seit' : 'Schläft seit',
      big: fmtCompact(status.minutes),
      sub: `wach etwa ${fmtTime(ende)}`
    };
  }
  if (nextSleep && nextSleep.continuation) {
    // Die Nacht läuft noch, das Kind ist nur gerade wach: kein Countdown,
    // sondern die errechnete Aufstehzeit.
    return {
      head: 'Nacht geht weiter bis',
      big: fmtTime(nextSleep.end),
      sub: `noch ${fmtDuration(minutesBetween(now, nextSleep.end))} Nachtschlaf`
    };
  }
  if (nextSleep) {
    // Immer auf die Zeit, die die App empfiehlt - das Fenster steht daneben.
    // Zählte der Countdown auf den frühen Rand, stünde dort "überfällig",
    // während die empfohlene Zeit noch bevorsteht.
    const fenster = ctx.napWindow;
    const minutes = minutesBetween(now, nextSleep.start);
    const was = nextSleep.type === 'night' ? 'Ab ins Bett' : `Nickerchen ${nextSleep.index || 1}`;
    return {
      head: minutes > 0 ? `${was} in` : `${was} überfällig seit`,
      big: fmtCompact(Math.abs(minutes)),
      sub: fenster
        ? `Um ${fmtTime(nextSleep.start)} · Fenster ${
            fenster.von < nextSleep.start ? `ab ${fmtTime(fenster.von)}` : `bis ${fmtTime(fenster.bis)}`
          }`
        : `Um ${fmtTime(nextSleep.start)}`
    };
  }
  return {
    head: 'Kein Schlaf mehr geplant',
    big: fmtTime(now),
    sub: 'Trage Schlaf nach, wenn doch noch etwas kommt'
  };
}

/**
 * Der Tag als Bogen: links unten das Aufstehen, rechts unten die Bettzeit,
 * dazwischen die Nickerchen an ihrer Position. Auf einen Blick sichtbar,
 * wo im Tag man gerade steht.
 */
function dayArc(ctx) {
  const { plan, morningWake, now } = ctx;
  return arcFigure({
    from: morningWake,
    to: plan.bedtime,
    naps: plan.blocks.filter((b) => b.type === 'nap'),
    now,
    center: arcCenter(ctx),
    over: ringState(ctx).over,
    bedBlock: plan.blocks.find((b) => b.type === 'night') || null
  });
}

/**
 * Der Bogen selbst: Aufstehen links unten, Bettzeit rechts unten, Nickerchen
 * dazwischen. Wird für den heutigen Tag und für den Rückblick benutzt.
 */
function arcFigure({
  from,
  to,
  naps = [],
  now = null,
  center,
  over = false,
  day = null,
  bedBlock = null
}) {
  const morningWake = from;
  const bedtime = to;
  const span = Math.max(60, minutesBetween(morningWake, bedtime));
  const at = (date) => Math.max(0, Math.min(1, minutesBetween(morningWake, date) / span));
  const elapsed = now ? at(now) : 0;

  // Jedes Symbol im Bogen ist ein Knopf: antippen und die Zeit korrigieren.
  const marker = (fraction, emoji, cls, tap = '', label = '') => {
    const p = arcPoint(fraction);
    const x = p.x.toFixed(1);
    const y = p.y.toFixed(1);
    return `<g class="marker ${cls} ${tap ? 'tap' : ''}" ${tap}
      ${tap ? `role="button" tabindex="0" aria-label="${esc(label)}"` : ''}>
      ${tap ? `<circle class="hit" cx="${x}" cy="${y}" r="26"></circle>` : ''}
      <circle cx="${x}" cy="${y}" r="17"></circle>
      <text x="${x}" y="${(p.y + 6).toFixed(1)}">${emoji}</text>
    </g>`;
  };
  // Zwei Zeilen statt einer langen: sonst ragen die Zeiten aus dem Bild.
  const label = (fraction, lines, cls) => {
    const rows = [].concat(lines);
    const p = arcPoint(fraction, ARC.r + 26);
    const anchor = p.x < ARC.cx - 12 ? 'end' : p.x > ARC.cx + 12 ? 'start' : 'middle';
    const top = p.y + 4 - (rows.length - 1) * 7;
    return `<text class="arc-label ${cls}" x="${p.x.toFixed(1)}" y="${top.toFixed(
      1
    )}" text-anchor="${anchor}">${rows
      .map((row, i) => `<tspan x="${p.x.toFixed(1)}" dy="${i === 0 ? 0 : 14}">${row}</tspan>`)
      .join('')}</text>`;
  };

  const { head, big, sub } = center;

  return `
    <div class="dayarc">
      <svg viewBox="-36 -6 372 300" role="img"
        aria-label="Tagesbogen von ${fmtTime(morningWake)} bis ${fmtTime(bedtime)}">
        <path class="arc-track" d="${arcPath(0, 1)}"></path>
        ${elapsed > 0.005 ? `<path class="arc-done" d="${arcPath(0, elapsed)}"></path>` : ''}
        ${naps
          .map((n) => {
            const von = at(n.start);
            const bis = at(n.end);
            if (bis <= von) return '';
            const tap = blockAction(n);
            return `<path class="arc-nap ${n.actual ? 'actual' : 'planned'} ${
              tap ? 'tap' : ''
            }" ${tap} d="${arcPath(von, bis)}"></path>`;
          })
          .join('')}
        ${marker(
          0,
          '🌅',
          'wake',
          `data-action="edit-morning"${day ? ` data-date="${day.toISOString()}"` : ''}`,
          `Aufstehzeit ${fmtTime(morningWake)} ändern`
        )}
        ${label(0, fmtTime(morningWake), 'wake')}
        ${marker(
          1,
          '🌙',
          'bed',
          bedBlock ? blockAction(bedBlock) : '',
          `Bettzeit ${fmtTime(bedtime)} ${bedBlock && bedBlock.actual ? 'bearbeiten' : 'eintragen'}`
        )}
        ${label(1, fmtTime(bedtime), 'bed')}
        ${naps
          .map((n) => {
            const mid = (at(n.start) + at(n.end)) / 2;
            return (
              marker(
                mid,
                n.running ? '😴' : '💤',
                n.actual ? 'nap actual' : 'nap planned',
                blockAction(n),
                `Nickerchen ${fmtTime(n.start)} bis ${fmtTime(n.end)} ${
                  n.actual ? 'bearbeiten' : 'eintragen'
                }`
              ) + label(mid, [fmtTime(n.start), fmtTime(n.end)], 'nap')
            );
          })
          .join('')}
        ${
          now && elapsed > 0 && elapsed < 1
            ? `<circle class="arc-now" cx="${arcPoint(elapsed).x.toFixed(1)}" cy="${arcPoint(
                elapsed
              ).y.toFixed(1)}" r="5"></circle>`
            : ''
        }
      </svg>
      <div class="arc-center ${over ? 'over' : ''}">
        <div class="head">${esc(head)}</div>
        <div class="big">${esc(big)}</div>
        <div class="sub">${esc(sub)}</div>
      </div>
    </div>
    <p class="arc-hint">Tippe im Bogen auf ein Symbol, um die Zeit zu ändern.</p>`;
}

/**
 * Was im Ring steht. Liegt der Wachbeginn sehr lange zurück, ist meist nur
 * nichts erfasst worden - dann zeigt der Ring die Wachzeit statt einer
 * sinnlos hochzählenden Überziehung.
 */
function ringState(ctx) {
  const { band, status, now, morningWake } = ctx;
  if (status.nightWaking) {
    return {
      stale: false,
      over: status.minutes > 60,
      progress: Math.min(status.progress, 1),
      label: 'nachts wach seit',
      big: fmtCountdown(now - status.since),
      sub: `${fmtTime(status.since)} &middot; Nacht läuft seit ${fmtTime(status.nightStart)}`
    };
  }
  const nightExpected = status.sleeping && status.night
    ? nightEndFor(status.since, morningWake, band, awakeMinutesIn(ctx.running, now))
    : null;
  // Der Ring zählt auf denselben Zeitpunkt herunter, den die Karte nennt.
  const next = ctx.nextSleep;
  const target = !status.sleeping && next ? next.start : status.windowEnd;
  const stale = !status.sleeping && status.progress > 2;
  const over = !status.sleeping && target && now > target;
  return {
    stale,
    over,
    progress: Math.min(status.progress, 1),
    label: status.sleeping
      ? status.night
        ? 'Nacht läuft seit'
        : 'schläft seit'
      : stale
        ? 'wach seit'
        : over
          ? 'fällig seit'
          : next && next.type === 'night'
            ? 'bis zur Nacht'
            : 'bis zum Nickerchen',
    big: stale
      ? fmtDuration(status.minutes)
      : fmtCountdown(status.sleeping ? now - status.since : target - now),
    sub: status.sleeping
      ? nightExpected
        ? `seit ${fmtTime(status.since)} &middot; wach um ${fmtTime(nightExpected)}`
        : `seit ${fmtTime(status.since)} &middot; typisch ${fmtDuration(band.napLengthMin)}`
      : stale
        ? `seit ${fmtTime(status.since)} &middot; noch kein Schlaf erfasst`
        : `wach seit ${fmtTime(status.since)} (${fmtDuration(status.minutes)})`
  };
}

/**
 * Ergänzung zum Tagesbogen: Der Bogen zeigt WANN, diese Karte das WARUM und
 * die Korrekturmöglichkeiten für den laufenden Schlaf.
 */
function sleepDetailCard(ctx) {
  const { band, baseBand, profile, status, now, days, sleeps } = ctx;
  if (status.nightWaking) {
    const running = ctx.running;
    const index = (running.interruptions || []).findIndex((i) => !i.end);
    return `<div class="card next-sleep">
      <div class="card-head"><h2>Nachts wach</h2><span class="tag live">Nacht läuft</span></div>
      <div class="next-time">
        <div class="window">${fmtTime(status.since)}</div>
        <div class="muted">aufgewacht &middot; seit <strong>${fmtDuration(status.minutes)}</strong></div>
      </div>
      <div class="row tight nudge">
        ${[-15, -5, -1, 1, 5]
          .map(
            (m) => `<button class="chip" data-action="shift-waking"
              data-id="${esc(running.id)}" data-index="${index}" data-field="start"
              data-min="${m}">${m > 0 ? '+' : ''}${m}</button>`
          )
          .join('')}
        <button class="chip" data-action="edit-sleep" data-id="${esc(running.id)}">Genau</button>
      </div>
      <p class="hint">
        Eingeschlafen war sie um ${fmtTime(running.start)}. Sobald sie weiterschläft,
        „Schläft wieder“ tippen - die Zeit lässt sich danach genauso korrigieren.
      </p>
    </div>`;
  }

  if (status.sleeping) {
    const running = ctx.running;
    const isNight = Boolean(running && running.type === 'night');
    // Nachts zählt die Aufstehzeit, tagsüber die übliche Nickerchenlänge.
    const wachMin = isNight ? awakeMinutesIn(running, now) : 0;
    const expectedEnd = isNight
      ? nightEndFor(status.since, ctx.morningWake, band, wachMin)
      : addMinutes(status.since, band.napLengthMin);
    // Getippt wird meist später als eingeschlafen - die Startzeit muss sich
    // deshalb sofort und ohne Umweg korrigieren lassen.
    return `<div class="card next-sleep">
      <div class="card-head">
        <h2>${running && running.type === 'night' ? 'Nacht läuft' : 'Schläft gerade'}</h2>
        <span class="tag live">läuft</span>
      </div>
      <div class="next-time">
        <div class="window">${fmtTime(status.since)}</div>
        <div class="muted">eingeschlafen &middot; seit <strong>${fmtDuration(status.minutes)}</strong></div>
      </div>
      ${
        running
          ? `<div class="row tight nudge">
              ${[-15, -5, -1, 1, 5]
                .map(
                  (m) => `<button class="chip" data-action="shift-start"
                    data-id="${esc(running.id)}" data-min="${m}">${m > 0 ? '+' : ''}${m}</button>`
                )
                .join('')}
              <button class="chip" data-action="edit-sleep" data-id="${esc(running.id)}">Genau</button>
            </div>`
          : ''
      }
      ${
        isNight && running && (running.interruptions || []).length
          ? `<ul class="list compare">${running.interruptions
              .map(
                (gap, i) => `<li>
                  <span class="grow">Nachts wach</span>
                  <small class="muted">${fmtTime(gap.start)}${
                    gap.end ? `-${fmtTime(gap.end)} &middot; ${fmtDuration(minutesBetween(gap.start, gap.end))}` : ''
                  }</small>
                  <button class="chip" data-action="edit-waking"
                    data-id="${esc(running.id)}" data-index="${i}">✎</button>
                </li>`
              )
              .join('')}</ul>`
          : ''
      }
      ${
        isNight && running
          ? `<div class="row tight">
              <button class="chip" data-action="new-waking" data-id="${esc(running.id)}">
                + Nachts wach nachtragen
              </button>
            </div>`
          : ''
      }
      <p class="hint">
        ${
          isNight
            ? `Errechnete Aufstehzeit <strong>${fmtTime(expectedEnd)}</strong>
               (${fmtDuration(minutesBetween(status.since, expectedEnd) - wachMin)} Nachtschlaf${
                 wachMin ? `, ${fmtDuration(wachMin)} davon wach` : ''
               }).`
            : `Voraussichtlich wach um <strong>${fmtTime(expectedEnd)}</strong>,
               typisch sind ${fmtDuration(band.napLengthMin)}.`
        }
        Stimmt die Startzeit nicht, schieb sie mit den Knöpfen zurecht.
      </p>
    </div>`;
  }

  const napsDone = sleeps.filter((s) => s.end).length;
  // Immer der Block, den auch der Tagesplan und der Ring zeigen.
  const next = ctx.nextSleep;
  if (!next) {
    return `<div class="card next-sleep">
      <div class="card-head"><h2>Kein Schlaf mehr geplant</h2></div>
      <p class="hint">Für heute steht nichts mehr an. Trage Schlaf nach, wenn doch noch etwas kommt.</p>
    </div>`;
  }
  if (next.continuation) {
    // Die Nacht ist erfasst, endete aber vor der errechneten Aufstehzeit.
    // Meist schläft das Kind längst weiter und nur der Eintrag stimmt nicht.
    const nacht = ctx.plan.blocks.filter((b) => b.type === 'night' && b.actual).pop();
    return `<div class="card next-sleep">
      <div class="card-head">
        <h2>Nacht geht weiter</h2>
        <small class="muted">bis ${fmtTime(next.end)}</small>
      </div>
      <p class="hint">
        Der Nachtschlaf ist bis ${fmtTime(nacht ? nacht.end : now)} erfasst. Schläft dein Kind
        seitdem durch, war das Ende ein Fehltipp &ndash; dann läuft die Nacht einfach weiter.
        Ist es wieder eingeschlafen, tippe oben auf <strong>Schläft wieder</strong>.
      </p>
      ${
        nacht
          ? `<div class="row tight">
              <button class="primary" data-action="resume" data-id="${esc(nacht.id)}">Sie schläft noch</button>
              <button class="chip" data-action="edit-sleep" data-id="${esc(nacht.id)}">Zeiten bearbeiten</button>
            </div>`
          : ''
      }
    </div>`;
  }
  const explain = explainNextSleep({
    band,
    baseBand,
    profile,
    ageLabel: formatAge(days),
    lastWake: status.since,
    napsDone,
    napSetting: store.getState().settings.napCount,
    firstNapStart: sleeps.filter((x) => x.type !== 'night').sort((a, b) => a.start - b.start)[0]
      ? sleeps.filter((x) => x.type !== 'night').sort((a, b) => a.start - b.start)[0].start
      : null,
    planned: next.start,
    isNight: next.type === 'night',
    pressure: ctx.pressure
  });
  const open = expanded.has('why');

  return `<div class="card next-sleep">
    ${
      ctx.napWindow
        ? `<p class="hint" style="margin-top:0">
            ${
              ctx.napWindow.formen
                ? `Ob heute ein oder zwei Nickerchen kommen, steht noch nicht fest - beides
                   ist bei deinem Kind üblich. Deshalb oben das Fenster
                   <strong>${fmtTime(ctx.napWindow.von)}&ndash;${fmtTime(ctx.napWindow.bis)}</strong>:
                   der frühe Rand gilt für einen Zwei-Nickerchen-Tag, der späte für einen mit
                   einem. Sobald sie eingeschlafen ist, weiß die App, welcher Tag es wird.`
                : `Deine Zeiten schwanken von Tag zu Tag um etwa
                   <strong>${fmtDuration(ctx.napWindow.streuung)}</strong>. Deshalb steht oben das
                   Fenster <strong>${fmtTime(ctx.napWindow.von)}&ndash;${fmtTime(ctx.napWindow.bis)}</strong>
                   statt einer Minute. Die Rechnung unten zeigt die Mitte.`
            }
          </p>`
        : ''
    }
    <p class="formula">${
      explain.clamped
        ? `${esc(shortFormula(status.since, explain.windowMinutes))} = ${fmtTime(explain.computed)}
           &rarr; <strong>${fmtTime(explain.target)}</strong> (Abendfenster)`
        : `${esc(shortFormula(status.since, explain.windowMinutes))}
           = <strong>${fmtTime(explain.target)}</strong>`
    }</p>
    <div class="spread">
      <button class="chip" data-action="toggle" data-key="why" aria-expanded="${open}">
        ${open ? 'Rechenweg ausblenden' : 'Wie kommt diese Zeit zustande?'}
      </button>
      <small class="muted">Fenster ${
        ctx.napWindow
          ? `${fmtTime(ctx.napWindow.von)}–${fmtTime(ctx.napWindow.bis)}`
          : `${fmtTime(explain.window.start)}–${fmtTime(explain.window.end)}`
      }</small>
    </div>
    ${
      open
        ? `<ol class="steps">
            ${explain.steps
              .map(
                (s) => `<li>
                  <span class="grow"><strong>${esc(s.label)}</strong>
                    ${s.note ? `<small class="muted">${esc(s.note)}</small>` : ''}</span>
                  <span class="val">${esc(s.value)}</span>
                </li>`
              )
              .join('')}
            <li class="result">
              <span class="grow"><strong>Empfohlene Schlafenszeit</strong>
                <small class="muted">Fenster ± ${explain.window.spread} Min</small></span>
              <span class="val">${fmtTime(explain.target)}</span>
            </li>
          </ol>`
        : ''
    }
  </div>`;
}

/**
 * Die vergangene Nacht auf einen Blick - und der Knopf, um nachträglich eine
 * Wachphase einzutragen. Das passiert meist erst am Morgen danach.
 */
function lastNightCard(ctx) {
  const { lastNight, nightMinutes, now, status } = ctx;
  if (!lastNight || status.sleeping || status.nightWaking) return '';
  const gaps = lastNight.interruptions || [];
  const wach = awakeMinutesIn(lastNight, now);
  return `
    <div class="card">
      <div class="card-head">
        <h2>Letzte Nacht</h2>
        <small class="muted">${fmtTime(lastNight.start)}&ndash;${fmtTime(lastNight.end)}</small>
      </div>
      <p class="hint">
        <strong>${fmtDuration(nightMinutes)}</strong> Schlaf${
          wach ? `, ${fmtDuration(wach)} wach in ${gaps.length} Phase${gaps.length === 1 ? '' : 'n'}` : ' &middot; durchgeschlafen'
        }
      </p>
      ${
        gaps.length
          ? `<ul class="list compare">${gaps
              .map(
                (gap, i) => `<li>
                  <span class="grow">Nachts wach</span>
                  <small class="muted">${fmtTime(gap.start)}${
                    gap.end
                      ? `-${fmtTime(gap.end)} &middot; ${fmtDuration(minutesBetween(gap.start, gap.end))}`
                      : ''
                  }</small>
                  <button class="chip" data-action="edit-waking"
                    data-id="${esc(lastNight.id)}" data-index="${i}">✎</button>
                </li>`
              )
              .join('')}</ul>`
          : ''
      }
      <div class="row tight">
        <button class="chip" data-action="new-waking" data-id="${esc(lastNight.id)}">
          + Nachts wach nachtragen
        </button>
        <button class="chip" data-action="edit-sleep" data-id="${esc(lastNight.id)}">Nachtzeiten</button>
      </div>
    </div>`;
}

/* ------------------------------------------------------------- Tagesauswahl */

const WEEKDAYS = ['M', 'D', 'M', 'D', 'F', 'S', 'S'];

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/** Montag der Woche, in der dieser Tag liegt. */
function mondayOf(date) {
  const day = startOfDay(date);
  const offset = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - offset);
  return day;
}

/**
 * Streifen mit den Tagen einer Woche. Zugeklappt steht nur das Datum da;
 * aufgeklappt (Tippen oder von oben nach unten ziehen) lässt sich jeder Tag
 * antippen und man sieht, wie er gelaufen ist.
 */
function dayStrip() {
  const heute = new Date();
  const gewaehlt = reviewDay || heute;
  const montag = mondayOf(stripWeek || gewaehlt);
  const tage = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(montag);
    d.setDate(d.getDate() + i);
    return d;
  });
  const sleeps = store.allSleeps();
  const hatDaten = (d) =>
    sleeps.some((s) => sameDay(s.start, d) || (s.end && sameDay(s.end, d)));

  const titel = sameDay(gewaehlt, heute)
    ? 'Heute'
    : new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' }).format(
        gewaehlt
      );
  const untertitel = store.birthDate()
    ? formatAge(ageInDays(store.birthDate(), store.dueDate(), gewaehlt))
    : new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'long' }).format(gewaehlt);

  return `
    <div class="daystrip ${stripOpen ? 'open' : ''}">
      <button class="strip-head" data-action="toggle-strip"
        aria-expanded="${stripOpen}">
        <span class="grow"><strong>${esc(titel)}</strong>
          <small class="muted">${esc(untertitel)}</small></span>
        <span class="chev" aria-hidden="true">${stripOpen ? '▲' : '▼'}</span>
      </button>
      ${
        stripOpen
          ? `<div class="strip-body">
              <div class="strip-nav">
                <button class="chip" data-action="strip-week" data-delta="-1"
                  aria-label="Woche zurück">‹</button>
                <small class="muted">${esc(
                  new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(
                    tage[0]
                  )
                )} &ndash; ${esc(
                  new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(
                    tage[6]
                  )
                )}</small>
                <button class="chip" data-action="strip-week" data-delta="1"
                  ${startOfDay(tage[6]) >= startOfDay(heute) ? 'disabled' : ''}
                  aria-label="Woche vor">›</button>
              </div>
              <div class="strip-days">
                ${tage
                  .map((d, i) => {
                    const zukunft = startOfDay(d) > startOfDay(heute);
                    const aktiv = sameDay(d, gewaehlt);
                    return `<button class="day ${aktiv ? 'sel' : ''} ${
                      sameDay(d, heute) ? 'today' : ''
                    }" data-action="pick-day" data-date="${d.toISOString()}"
                      ${zukunft ? 'disabled' : ''}
                      aria-current="${aktiv ? 'date' : 'false'}">
                      <small>${WEEKDAYS[i]}</small>
                      <span>${d.getDate()}</span>
                      <i class="dot ${hatDaten(d) && !zukunft ? 'on' : ''}"></i>
                    </button>`;
                  })
                  .join('')}
              </div>
              <div class="row tight" style="margin-top:10px">
                ${
                  reviewDay
                    ? '<button class="chip" data-action="pick-day" data-date="today">Heute</button>'
                    : ''
                }
                ${
                  // Gestern ist der häufigste Blick zurück - montags läge es
                  // sonst in der Vorwoche und bräuchte erst einen Blätterschritt.
                  (() => {
                    const g = new Date(heute);
                    g.setDate(g.getDate() - 1);
                    return sameDay(g, gewaehlt)
                      ? ''
                      : `<button class="chip" data-action="pick-day" data-date="${g.toISOString()}">Gestern</button>`;
                  })()
                }
              </div>
              ${
                reviewDay
                  ? ''
                  : '<p class="hint">Tippe auf einen Tag, um zu sehen, wie er gelaufen ist.</p>'
              }
            </div>`
          : ''
      }
    </div>`;
}

/**
 * Rückblick auf einen vergangenen Tag: derselbe Bogen wie heute, nur mit den
 * tatsächlichen Zeiten - aufgestanden, Nickerchen, ins Bett.
 */
function viewTag(day) {
  const review = buildDayReview({
    sleeps: store.allSleeps(),
    day,
    morningWake: store.morningWakeFor(day)
  });
  const days = store.birthDate() ? ageInDays(store.birthDate(), store.dueDate(), day) : 0;
  const heute = new Date();
  const bis = review.bedtime || addMinutes(review.morningWake, 13 * 60);
  const langerTag = new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long'
  }).format(day);

  const center = review.hasData
    ? {
        head: 'Geschlafen',
        big: review.totalMinutes ? fmtCompact(review.totalMinutes) : '–',
        sub: `${review.naps.length} Nickerchen${
          review.bedtime ? ` · Bett ${fmtTime(review.bedtime)}` : ''
        }`
      }
    : { head: 'Nichts erfasst', big: '–', sub: 'Für diesen Tag gibt es keine Einträge' };

  return `
    ${dayStrip()}

    ${arcFigure({
      from: review.morningWake,
      to: bis,
      naps: review.blocks.filter((b) => b.type === 'nap'),
      now: sameDay(day, heute) ? heute : null,
      center,
      day,
      bedBlock: review.blocks.find((b) => b.type === 'night') || null
    })}

    <div class="card">
      <div class="card-head">
        <h2>${esc(langerTag)}</h2>
        <small class="muted">${esc(formatAge(days))}</small>
      </div>
      ${
        review.hasData
          ? `<div class="kpis">
              <div class="kpi"><div class="v">${fmtShort(review.nightBeforeMinutes)}</div>
                <div class="k">Nacht davor</div></div>
              <div class="kpi"><div class="v">${fmtShort(review.napMinutes)}</div>
                <div class="k">Tagschlaf</div></div>
              <div class="kpi"><div class="v">${review.naps.length}</div>
                <div class="k">Nickerchen</div></div>
            </div>
            <ul class="timeline">
              <li>
                <span class="time">${fmtTime(review.morningWake)}</span>
                <span class="what"><span class="dot wake"></span>
                  <strong>Aufgestanden</strong>
                  ${
                    review.nightBefore
                      ? `<span class="muted">Nacht ab ${fmtTime(review.nightBefore.start)}</span>`
                      : ''
                  }
                </span>
              </li>
              ${review.blocks.map((b) => blockRow(b, heute)).join('')}
            </ul>
            ${
              review.wakings
                ? `<p class="hint">In der Nacht davor war dein Kind
                    <strong>${fmtDuration(review.wakings)}</strong> wach.</p>`
                : ''
            }`
          : `<p class="hint">An diesem Tag wurde nichts erfasst. Du kannst Schlaf
              nachträglich eintragen - er zählt dann auch für die gelernten Werte mit.</p>`
      }
      <div class="row" style="margin-top:12px">
        <button data-action="add-sleep-on" data-date="${day.toISOString()}">Schlaf nachtragen</button>
      </div>
    </div>

    ${tagEreignisse(day)}`;
}

/** Füttern und Wickeln des gewählten Tages. */
function tagEreignisse(day) {
  const events = store.allEvents().filter((e) => sameDay(e.at, day));
  if (!events.length) return '';
  const summe = summarizeDay(store.allEvents(), day);
  return `
    <div class="card">
      <div class="card-head">
        <h2>Füttern &amp; Wickeln</h2>
        <small class="muted">${summe.feeds} Mahlzeiten &middot; ${summe.diapers} Wickeln</small>
      </div>
      <ul class="list compare">
        ${events
          .slice()
          .reverse()
          .slice(0, 12)
          .map(
            (e) => `<li>
              <span class="grow">${esc(describeEvent(e))}</span>
              <small class="muted">${fmtTime(e.at)}</small>
            </li>`
          )
          .join('')}
      </ul>
    </div>`;
}

function viewHeute() {
  const ctx = context();
  const { band, status, now, sleeps } = ctx;
  const ring0 = ringState(ctx);
  const { over, stale } = ring0;
  const quickSound = soundById(store.getState().settings.lastSound);
  const events = store.allEvents();
  const feed = lastEvent(events, 'feed');
  const diaper = lastEvent(events, 'diaper');
  const ago = (event) => {
    const minutes = minutesBetween(event.at, now);
    return minutes < 5 ? 'gerade eben' : `vor ${fmtDuration(minutes)}`;
  };
  const unrated = store
    .allSleeps()
    .filter((s) => s.end && s.end > addMinutes(now, -12 * 60))
    .pop();

  return `
    ${dayStrip()}

    ${dayArc(ctx)}

    <div class="row" style="justify-content:center;margin-bottom:6px">
      ${
        status.nightWaking
          ? `<button class="primary" data-action="back-to-sleep">Schläft wieder</button>
             <button class="ghost" data-action="wake">Tag beginnt</button>`
          : status.sleeping
            ? `${
                ctx.running && ctx.running.type === 'night'
                  ? '<button class="ghost" data-action="night-waking">Kurz wach</button>'
                  : ''
              }
               <button class="primary" data-action="wake">Aufgewacht</button>`
            : ctx.nextSleep && ctx.nextSleep.continuation
              ? `<button class="primary" data-action="start-night">Schläft wieder</button>
                 <button class="ghost" data-action="start-nap">Nickerchen startet</button>`
              : `<button class="primary" data-action="start-nap">Nickerchen startet</button>
                 <button class="ghost" data-action="start-night">Nacht startet</button>`
      }
    </div>

    ${sleepDetailCard(ctx)}

    ${
      unrated && !(unrated.settle && unrated.mood) && !status.sleeping && !status.nightWaking
        ? `<div class="card tight spread">
            <div>
              <div><strong>Wie lief ${unrated.type === 'night' ? 'die Nacht' : 'das Nickerchen'}?</strong></div>
              <small class="muted">${fmtTime(unrated.start)}-${fmtTime(unrated.end)} &middot; macht den Plan genauer</small>
            </div>
            <button class="primary" data-action="rate-sleep" data-id="${esc(unrated.id)}">Bewerten</button>
          </div>`
        : ''
    }

    ${lastNightCard(ctx)}

    <div class="card">
      <div class="card-head"><h2>Füttern &amp; Wickeln</h2>
        <small class="muted">${summarizeDay(events, now).feeds} Mahlzeiten heute</small>
      </div>
      <div class="row tight">
        <button data-action="log-feed" data-kind="breast">🤱 Stillen</button>
        <button data-action="log-feed" data-kind="bottle">🍼 Flasche</button>
        <button data-action="log-feed" data-kind="solid">🥣 Beikost</button>
        <button data-action="log-diaper">🧷 Wickeln</button>
      </div>
      <p class="hint" style="margin-top:10px">
        Letzte Mahlzeit: <strong>${feed ? `${esc(describeEvent(feed))}, ${ago(feed)}` : 'noch nichts erfasst'}</strong><br />
        Zuletzt gewickelt: <strong>${diaper ? `${esc(describeEvent(diaper))}, ${ago(diaper)}` : 'noch nichts erfasst'}</strong>
      </p>
    </div>

    <div class="card tight spread">
      <div>
        <div><strong>${esc(quickSound.emoji)} ${esc(quickSound.name)}</strong></div>
        <small class="muted">Einschlafgeräusch</small>
      </div>
      <button data-action="quick-sound" data-id="${esc(quickSound.id)}">
        ${audio.isPlaying() ? 'Stopp' : 'Abspielen'}
      </button>
    </div>

    <div class="card tight">
      <button class="chip" data-action="toggle" data-key="tired"
        aria-expanded="${expanded.has('tired')}">Müdigkeitszeichen</button>
      ${
        expanded.has('tired')
          ? `<div class="hint" style="margin-top:10px">
              <ul>${TIRED_SIGNS.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
            </div>`
          : ''
      }
    </div>`;
}

/** Vergleichszeile "Altersband -> persönlich". */
function learnRow(label, base, learned, weight) {
  const changed = Math.abs(base - learned) >= 3;
  return `<li>
      <span class="grow">${esc(label)}</span>
      <small class="muted">${fmtDuration(base)}</small>
      <span aria-hidden="true" class="muted">→</span>
      <strong>${changed ? fmtDuration(learned) : '<span class="muted">unverändert</span>'}</strong>
      ${weight != null ? `<small class="muted">${Math.round(weight * 100)}%</small>` : ''}
    </li>`;
}

/** Karte "Was Schlummer gelernt hat". */
function learningCard(ctx) {
  const { profile, baseBand, band, transition } = ctx;
  const on = store.getState().settings.learning;

  if (!on) {
    return `<div class="card">
      <div class="card-head"><h2>Persönliche Anpassung</h2><span class="tag">aus</span></div>
      <p class="hint">
        Der Plan rechnet nur mit den Altersrichtwerten. Unter „Mehr“ kannst du das
        Lernen aus den eigenen Daten wieder einschalten.
      </p>
    </div>`;
  }

  if (!profile.active) {
    return `<div class="card">
      <div class="card-head"><h2>Persönliche Anpassung</h2><span class="tag">sammelt Daten</span></div>
      <p class="hint">
        Noch keine eigenen Werte. Protokolliere Nickerchen und Nächte - ab etwa drei
        erfassten Tagen weicht der Plan spürbar vom reinen Altersschnitt ab und folgt
        dem Rhythmus deines Kindes.
      </p>
    </div>`;
  }

  const pct = Math.round(profile.confidence * 100);
  return `<div class="card">
      <div class="card-head">
        <h2>Was Schlummer gelernt hat</h2>
        <span class="tag live">${pct}% persönlich</span>
      </div>
      <div class="meter" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <ul class="list compare">
        ${learnRow('Erstes Wachfenster', baseBand.wakeWindowMin, band.wakeWindowMin, profile.values.firstWindow.weight)}
        ${learnRow('Letztes Wachfenster', baseBand.wakeWindowMax, band.wakeWindowMax, profile.values.lastWindow.weight)}
        ${learnRow('Nickerchenlänge', baseBand.napLengthMin, band.napLengthMin, profile.values.napLength.weight)}
        <li>
          <span class="grow">Nickerchen pro Tag</span>
          <small class="muted">${baseBand.naps}</small>
          <span aria-hidden="true" class="muted">→</span>
          <strong>${band.naps}</strong>
        </li>
      </ul>
      <ul class="list compare">
        ${
          profile.values.morning != null
            ? `<li><span class="grow">Übliches Aufwachen</span><strong>${toClock(
                profile.values.morning
              )}</strong></li>`
            : ''
        }
        ${
          profile.values.bedtime != null
            ? `<li><span class="grow">Übliche Bettzeit</span><strong>${toClock(
                profile.values.bedtime
              )}</strong></li>`
            : ''
        }
      </ul>
      ${
        profile.calibration && profile.calibration.nap.samples
          ? `<p class="hint" style="margin-top:10px">
              <strong>Aus deinen Bewertungen:</strong> Wachfenster
              ${profile.calibration.nap.minutes >= 0 ? '+' : ''}${
                profile.calibration.nap.minutes
              } Min${
                profile.calibration.evening.minutes
                  ? `, abends zusätzlich ${
                      profile.calibration.evening.minutes >= 0 ? '+' : ''
                    }${profile.calibration.evening.minutes} Min`
                  : ''
              } (${profile.calibration.nap.samples} bewertete Schläfchen).
              ${
                profile.calibration.nap.minutes > 3
                  ? 'Dein Kind war beim Hinlegen oft noch nicht müde genug.'
                  : profile.calibration.nap.minutes < -3
                    ? 'Es gab Übermüdungszeichen - der Plan legt jetzt etwas früher hin.'
                    : 'Die Wachfenster passen so, wie sie sind.'
              }
            </p>`
          : `<p class="hint" style="margin-top:10px">
              Noch keine Bewertungen. Tippe nach dem Aufwachen auf „Bewerten“ - daraus
              lernt Schlummer, ob die Wachfenster zu kurz oder zu lang sind.
            </p>`
      }
      <p class="hint" style="margin-top:10px">
        Gelernt aus ${profile.samples.windows} Wachfenstern und ${profile.samples.naps}
        Nickerchen der letzten ${profile.samples.days} Tage. Jüngere Tage zählen mehr,
        einzelne Ausreißer (Autofahrt, Krankheit) werden gedämpft.
      </p>
      ${
        transition && !napTransitionReport(store.allSleeps(), baseBand, ctx.now)?.laeuft
          ? `<p class="hint" style="margin-top:8px"><strong>Nap-Übergang:</strong> ${esc(
              transition.text
            )}</p>`
          : ''
      }
    </div>`;
}

/**
 * 24-Stunden-Uhr: der ganze Tag als Ring, Mitternacht oben. Erfasster Schlaf
 * kräftig, geplanter blass, dazu ein Zeiger für "jetzt". Auf einen Blick
 * sichtbar, wann das Kind schlafen soll.
 */
function dayClock(ctx) {
  const { plan, now } = ctx;
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const r = 78;
  const circumference = 2 * Math.PI * r;

  const arcs = plan.blocks
    .filter((b) => b.type !== 'wake')
    .map((b) => ({ block: b, arc: clockArc(b.start, b.end, dayStart) }))
    .filter((x) => x.arc);

  // Auch die vergangene Nacht gehört zum Bild.
  const lastNight = store
    .allSleeps()
    .filter((s) => s.type === 'night' && s.end && s.end > dayStart && s.start < now);
  for (const night of lastNight) {
    const arc = clockArc(night.start, night.end, dayStart);
    if (arc) arcs.unshift({ block: { type: 'night', actual: true }, arc });
  }

  const segment = ({ block, arc }, i) => {
    const length = ((arc.to - arc.from) / 360) * circumference;
    const offset = (arc.from / 360) * circumference;
    const color =
      block.type === 'night' ? 'var(--night)' : block.running ? 'var(--accent)' : 'var(--nap)';
    return `<circle class="seg" cx="110" cy="110" r="${r}"
      stroke="${color}" stroke-opacity="${block.actual ? 0.95 : 0.4}"
      stroke-dasharray="${length.toFixed(1)} ${(circumference - length).toFixed(1)}"
      stroke-dashoffset="${(-offset).toFixed(1)}"
      ${block.actual ? '' : 'stroke-linecap="butt"'} key="${i}"></circle>`;
  };

  const nowAngle = (minutesBetween(dayStart, now) / (24 * 60)) * 360;
  // Stundenmarken außerhalb des Rings, damit sie die Mitte frei lassen.
  const ticks = [0, 6, 12, 18]
    .map((h) => {
      const angle = ((h / 24) * 360 - 90) * (Math.PI / 180);
      const x = 110 + Math.cos(angle) * (r + 20);
      const y = 110 + Math.sin(angle) * (r + 20);
      return `<text x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}" class="tick">${
        h === 0 ? '0' : h
      }</text>`;
    })
    .join('');

  // Schläft das Kind gerade, zählt die Aufstehzeit - sonst der nächste Schlaf.
  const laufend = plan.blocks.find((b) => b.running);
  const nextNap = plan.blocks.find((b) => b.type !== 'wake' && !b.actual && b.start > now);
  const center = laufend
    ? { label: laufend.type === 'night' ? 'wach um' : 'wach etwa', time: fmtTime(laufend.end) }
    : nextNap
      ? { label: 'nächster Schlaf', time: fmtTime(nextNap.start) }
      : null;
  return `
    <div class="clock">
      <svg viewBox="0 0 220 220" role="img" aria-label="Tagesübersicht als 24-Stunden-Uhr">
        <circle class="ring-bg" cx="110" cy="110" r="${r}"></circle>
        <g transform="rotate(-90 110 110)">
          ${arcs.map(segment).join('')}
          <line class="nowhand" x1="${110 + r - 13}" y1="110" x2="${110 + r + 13}" y2="110"
            transform="rotate(${nowAngle.toFixed(1)} 110 110)"></line>
        </g>
        ${ticks}
        <text x="110" y="103" class="clock-main">${fmtTime(now)}</text>
        ${
          center
            ? `<text x="110" y="121" class="clock-sub">${esc(center.label)}</text>
               <text x="110" y="137" class="clock-next">${center.time}</text>`
            : '<text x="110" y="124" class="clock-sub">nichts mehr geplant</text>'
        }
      </svg>
      <div class="legend clock-legend">
        <span><span class="dot nap"></span> Nickerchen</span>
        <span><span class="dot night"></span> Nacht</span>
        <span class="muted">blass = geplant</span>
      </div>
    </div>`;
}

function viewPlan() {
  const ctx = context();
  const { band, plan, morningWake, now, days } = ctx;
  const personal = band.personalized;
  return `
    <div class="card">
      <div class="card-head">
        <h2>Tagesplan</h2>
        <small class="muted">${new Intl.DateTimeFormat('de-DE', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit'
        }).format(now)}</small>
      </div>
      ${dayClock(ctx)}
      <label class="field">
        Aufgewacht am Morgen
        <input type="time" id="morning" value="${hhmm(morningWake)}" />
      </label>
      <ul class="timeline">
        ${plan.blocks.map((b) => blockRow(b, now)).join('')}
      </ul>
      <div class="row" style="margin-top:12px">
        <button data-action="add-sleep">Schlaf nachtragen</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Werte im Plan</h2>
        <small class="muted">${esc(formatAge(days))} &middot; ${esc(band.label)}${
          personal ? ' &middot; persönlich' : ''
        }</small>
      </div>
      <div class="kpis">
        <div class="kpi">
          <div class="v">${fmtDuration(band.wakeWindowMin)}-${fmtDuration(band.wakeWindowMax)}</div>
          <div class="k">Wachfenster</div>
        </div>
        <div class="kpi">
          <div class="v">${band.naps}</div>
          <div class="k">Nickerchen</div>
        </div>
        <div class="kpi">
          <div class="v">${fmtDuration(band.dayTimeSleepMin + band.nightSleepMin)}</div>
          <div class="k">Schlaf gesamt</div>
        </div>
      </div>
      <div class="card-head" style="margin-top:14px"><h2 style="font-size:.95rem">Nickerchen pro Tag</h2></div>
      <div class="row tight">
        ${['auto', 0, 1, 2, 3, 4]
          .map(
            (value) => `<button class="chip" data-action="set-naps" data-value="${value}"
              aria-pressed="${String(store.getState().settings.napCount) === String(value)}">${
                value === 'auto' ? 'Automatisch' : value
              }</button>`
          )
          .join('')}
      </div>
      ${
        // Feste Vorgabe, die zur Wirklichkeit nicht passt, ist die häufigste
        // Ursache für Zeiten, die "irgendwie nicht stimmen".
        store.getState().settings.napCount !== 'auto' &&
        ctx.profile.active &&
        (ctx.profile.values.napCountMix || 0) >= 0.25
          ? `<p class="hint" style="margin-top:8px">
              <strong>Passt das noch?</strong> Du hast ${esc(
                String(store.getState().settings.napCount)
              )} Nickerchen fest eingestellt, aber etwa
              ${Math.round((ctx.profile.values.napCountMix || 0) * 100)} % der letzten Tage liefen
              anders. „Automatisch“ erkennt am Beginn des ersten Nickerchens, welche Form
              der Tag hat${
                ctx.profile.byNapCount && ctx.formZeiten
                  ? ` &ndash; bei deinem Kind: ${esc(ctx.formZeiten)}`
                  : ''
              }.
            </p>
            <div class="row tight" style="margin:-4px 0 8px">
              <button class="chip" data-action="set-naps" data-value="auto">Auf „Automatisch“ stellen</button>
            </div>`
          : ''
      }
      <p class="hint" style="margin-top:8px">
        ${
          band.napCountAdjusted
            ? `Fest auf <strong>${band.naps} ${
                band.naps === 1 ? 'Nickerchen' : 'Nickerchen'
              }</strong> gestellt. Die Wachfenster sind daraus neu gerechnet: Wachzeit des Tages
              geteilt auf ${band.naps + 1} Fenster, das letzte vor der Nacht am längsten.`
            : `„Automatisch“ nutzt den Altersrichtwert und das, was Schlummer aus deinem
              Protokoll gelernt hat. Macht dein Kind dauerhaft weniger Nickerchen, stell es
              hier fest ein - der Plan rechnet die Wachfenster dann passend um.`
        }
      </p>
      <p class="hint" style="margin-top:12px">${esc(band.note)}</p>
      <p class="hint">
        Empfohlen für dieses Alter: <strong>${ctx.baseBand.guideline.min}-${
          ctx.baseBand.guideline.max
        } Std</strong> Schlaf je 24 Stunden
        (${esc(ctx.baseBand.guideline.source)}) &middot;
        <button class="chip" data-action="go" data-route="quellen">Quellen</button>
      </p>
    </div>

    ${uebergangKarte(ctx)}

    ${learningCard(ctx)}

    <div class="card">
      <div class="card-head"><h2>Alle Altersstufen</h2></div>
      <ul class="list">
        ${AGE_BANDS.map(
          (b) => `<li>
            <span class="grow">${esc(b.label)}</span>
            <small class="muted">${fmtDuration(b.wakeWindowMin)}-${fmtDuration(
              b.wakeWindowMax
            )} &middot; ${b.naps} Naps</small>
          </li>`
        ).join('')}
      </ul>
    </div>`;
}

function viewSounds() {
  const settings = store.getState().settings;
  const active = audio.currentSoundId();
  const playing = audio.isPlaying();
  const timers = [0, 15, 30, 45, 60, 90];
  return `
    <div class="card">
      <div class="card-head"><h2>Einschlafgeräusche</h2></div>
      <div class="sound-grid">
        ${SOUNDS.map(
          (s) => `<button class="sound" data-action="sound" data-id="${esc(s.id)}"
            aria-pressed="${playing && active === s.id}">
            <span class="emoji">${s.emoji}</span>
            <span>${esc(s.name)}</span>
          </button>`
        ).join('')}
      </div>
      <p class="hint" style="margin-top:10px" id="sound-hint">
        ${
          active
            ? esc(soundById(active).hint)
            : 'Alle Klänge werden live im Browser erzeugt - kein Download, kein Datenverbrauch.'
        }
      </p>
    </div>

    <div class="card">
      <div class="card-head"><h2>Lautstärke</h2><small class="muted">${Math.round(
        settings.soundVolume * 100
      )}%</small></div>
      <input type="range" id="volume" min="0" max="100" value="${Math.round(
        settings.soundVolume * 100
      )}" />
      <p class="hint">
        Hugh et al. (Pediatrics 2014) maßen bei allen 14 getesteten Einschlafgeräten auf
        voller Lautstärke über 50 dB(A) in 30 cm Abstand - dem Grenzwert, den die AAP für
        Neugeborenenstationen nennt. Also: leise stellen, mindestens 2 m Abstand zum Bett,
        und nicht die ganze Nacht laufen lassen.
      </p>
    </div>

    <div class="card">
      <div class="card-head"><h2>Einschlaf-Timer</h2></div>
      <div class="row tight">
        ${timers
          .map(
            (m) => `<button class="chip" data-action="timer" data-min="${m}"
              aria-pressed="${settings.soundTimerMin === m}">${m === 0 ? 'Endlos' : `${m} Min`}</button>`
          )
          .join('')}
      </div>
      <p class="hint" style="margin-top:10px">
        Der Ton wird am Ende über eine Minute leiser, statt abrupt zu stoppen.
        Manche Kinder wachen sonst genau davon auf.
      </p>
    </div>`;
}

/* --------------------------------------------------- Trend und Übergang */

/**
 * Kleine Verlaufsgrafik: ein Punkt je Tag, verbunden zu einer Linie.
 * Eine Größe pro Grafik - Beginn und Länge haben verschiedene Maßstäbe und
 * gehören deshalb in zwei Bilder, nicht auf zwei Achsen.
 *
 * @param {object[]} punkte  { tag, wert } je Tag, aufsteigend
 * @param {object}   opts    label, format(wert), min, max, schritt
 */
function sparkline(punkte, { label, format, min, max, schritt = 60 }) {
  if (punkte.length < 2) return '';
  const W = 320;
  const H = 96;
  const links = 46;
  const oben = 12;
  const unten = 22;
  const spanne = Math.max(1, max - min);
  const x = (i) => links + (i * (W - links - 10)) / Math.max(1, punkte.length - 1);
  const y = (wert) => oben + (1 - (wert - min) / spanne) * (H - oben - unten);

  const linien = [];
  for (let wert = Math.ceil(min / schritt) * schritt; wert <= max; wert += schritt) {
    linien.push(`<line class="tr-grid" x1="${links}" y1="${y(wert).toFixed(1)}" x2="${W - 6}" y2="${y(
      wert
    ).toFixed(1)}"></line>
      <text class="tr-achse" x="${links - 6}" y="${(y(wert) + 3.5).toFixed(1)}">${esc(
        format(wert)
      )}</text>`);
  }

  const pfad = punkte
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.wert).toFixed(1)}`)
    .join(' ');

  return `
    <figure class="trend">
      <figcaption>${esc(label)}
        <span class="tr-spanne">${esc(format(punkte[0].wert))} &rarr; <strong>${esc(
          format(punkte[punkte.length - 1].wert)
        )}</strong></span>
      </figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}: ${esc(
        format(punkte[0].wert)
      )} am ${fmtShort2(punkte[0].tag)} bis ${esc(format(punkte[punkte.length - 1].wert))} am ${fmtShort2(
        punkte[punkte.length - 1].tag
      )}">
        ${linien.join('')}
        <path class="tr-linie" d="${pfad}"></path>
        ${punkte
          .map(
            (p, i) => `<g>
              <circle class="tr-punkt" cx="${x(i).toFixed(1)}" cy="${y(p.wert).toFixed(1)}" r="4">
                <title>${fmtShort2(p.tag)}: ${esc(format(p.wert))}</title>
              </circle>
            </g>`
          )
          .join('')}
        ${punkte
          .map((p, i) =>
            i % 2 === 0
              ? `<text class="tr-tag" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${p.tag.getDate()}.</text>`
              : ''
          )
          .join('')}
      </svg>
    </figure>`;
}

/** "10:28" aus Minuten seit Mitternacht. */
function uhrzeit(minuten) {
  const m = Math.max(0, Math.round(minuten));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Der Nap-Übergang mit den eigenen Zahlen: Er ist keine Störung, sondern eine
 * Phase - und man sieht ihr beim Wandern zu.
 */
function uebergangKarte(ctx) {
  const bericht = napTransitionReport(store.allSleeps(), ctx.baseBand, ctx.now);
  if (!bericht || !bericht.laeuft) return '';
  const { frueher, zuletzt, verschiebung, laengerUm } = bericht;
  const zeile = (was, a, b, formatiere) =>
    `<li>
      <span class="grow">${esc(was)}</span>
      <small class="muted">${esc(formatiere(a))} &rarr;</small>
      <strong>${esc(formatiere(b))}</strong>
    </li>`;

  return `
    <div class="card">
      <div class="card-head">
        <h2>Übergang auf ein Nickerchen</h2>
        <small class="muted">${bericht.tage} Tage</small>
      </div>
      <p class="hint">
        An <strong>${zuletzt.einzelne} von ${zuletzt.tage}</strong> der letzten Tage hat dein Kind
        nur ein Nickerchen gemacht, das Altersband sieht noch ${bericht.von} vor. Typisch für diese
        Phase: das Nickerchen wandert nach hinten und wird länger, und die Tage wechseln sich
        eine Weile ab.
      </p>
      <ul class="list compare">
        ${zeile('Erstes Nickerchen beginnt', frueher.start, zuletzt.start, uhrzeit)}
        ${zeile('Tagschlaf insgesamt', frueher.laenge, zuletzt.laenge, fmtDuration)}
        ${zeile(
          'Tage mit einem Nickerchen',
          frueher.anteilEinzeln,
          zuletzt.anteilEinzeln,
          (v) => `${Math.round(v * 100)} %`
        )}
      </ul>
      <p class="hint">
        ${
          verschiebung > 15
            ? `Das erste Nickerchen liegt inzwischen <strong>${fmtDuration(
                verschiebung
              )}</strong> später${
                laengerUm > 10 ? `, und der Tagschlaf ist ${fmtDuration(laengerUm)} länger` : ''
              }.
               Der Plan rechnet damit bereits.`
            : 'Der Plan rechnet mit der Form, die der Tag tatsächlich hat.'
        }
        An Tagen mit nur einem Nickerchen wird der Abend lang - dann hilft eine etwas frühere
        Bettzeit, damit die Übermüdung nicht in die Nacht rutscht.
      </p>
    </div>`;
}

/** Verlauf der letzten zwei Wochen: Beginn und Menge des Tagschlafs. */
function trendKarte() {
  const punkte = napTrend(store.allSleeps(), { days: 14 });
  if (punkte.length < 4) return '';
  const starts = punkte.map((p) => ({ tag: p.tag, wert: p.start }));
  const laengen = punkte.map((p) => ({ tag: p.tag, wert: p.laenge }));
  const runter = (w, s) => Math.floor(w / s) * s;
  const rauf = (w, s) => Math.ceil(w / s) * s;
  const sMin = runter(Math.min(...starts.map((p) => p.wert)) - 20, 60);
  const sMax = rauf(Math.max(...starts.map((p) => p.wert)) + 20, 60);
  const lMax = rauf(Math.max(...laengen.map((p) => p.wert)) + 15, 60);

  return `
    <div class="card">
      <div class="card-head">
        <h2>Verlauf</h2>
        <small class="muted">letzte ${punkte.length} Tage mit Nickerchen</small>
      </div>
      ${sparkline(starts, {
        label: 'Beginn des ersten Nickerchens',
        format: uhrzeit,
        min: sMin,
        max: sMax,
        schritt: 60
      })}
      ${sparkline(laengen, {
        label: 'Tagschlaf insgesamt',
        format: (m) => fmtShort(m),
        min: 0,
        max: lMax,
        schritt: 60
      })}
      <p class="hint">
        Ein Punkt je Tag. Wandert der Beginn nach hinten und wächst die Dauer, ist das
        der Übergang auf weniger Nickerchen.
      </p>
    </div>`;
}

/** Nächtliches Wachliegen: wie oft, wie lang, wann - und was hilft. */
function nachtKarte() {
  const bericht = nightWakingReport(store.allSleeps(), { nights: 14 });
  if (!bericht.naechte) return '';
  const offen = expanded.has('nachthilfe');
  return `
    <div class="card">
      <div class="card-head">
        <h2>Wachphasen</h2>
        <small class="muted">${bericht.naechte} erfasste Nächte</small>
      </div>
      <div class="kpis">
        <div class="kpi">
          <div class="v">${bericht.mitWachphasen}/${bericht.naechte}</div>
          <div class="k">Nächte mit Wachphase</div>
        </div>
        <div class="kpi">
          <div class="v">${fmtShort(bericht.minutenSchnitt)}</div>
          <div class="k">Ø wach pro Nacht</div>
        </div>
        <div class="kpi">
          <div class="v">${
            bericht.haeufigsteStunde == null ? '–' : `${bericht.haeufigsteStunde} Uhr`
          }</div>
          <div class="k">meist wach gegen</div>
        </div>
      </div>
      ${
        bericht.laengste
          ? `<p class="hint">Die längste Wachphase dauerte
              <strong>${fmtDuration(bericht.laengste.minuten)}</strong>, in der Nacht vom
              ${fmtShort2(bericht.laengste.nacht)} ab ${fmtTime(bericht.laengste.start)}.</p>`
          : '<p class="hint">In den erfassten Nächten ist keine Wachphase eingetragen.</p>'
      }
      <button class="chip" data-action="toggle" data-key="nachthilfe" aria-expanded="${offen}">
        ${offen ? 'Weniger' : 'Was in dieser Phase hilft'}
      </button>
      ${
        offen
          ? `<div class="hint" style="margin-top:10px">
              <ul>
                <li><strong>Gleiche Bedingungen wie beim Einschlafen.</strong> Wacht ein Kind so
                  auf, wie es eingeschlafen ist, findet es leichter allein zurück in den Schlaf.</li>
                <li><strong>Kurz abwarten.</strong> Viele Wachphasen enden von selbst; sofortiges
                  Eingreifen unterbricht das eigene Wiedereinschlafen.</li>
                <li><strong>Übermüdung vermeiden.</strong> Ein zu langer Abend führt häufiger zu
                  unruhigen Nächten als ein zu früher - dafür sind die Wachfenster da.</li>
                <li><strong>Feste Abendroutine.</strong> Gleiche Reihenfolge, gleiche Zeiten,
                  ruhiges Licht.</li>
                <li><strong>Trage die Wachphasen ein.</strong> Sie zählen vom Nachtschlaf ab und
                  verschieben die Zeiten des nächsten Tages.</li>
              </ul>
              <p>
                Das sind Praxisempfehlungen aus der Elternberatung, keine Garantie - Kinder sind
                verschieden. Halten die Nächte über Wochen an, ist das ein guter Punkt für die
                nächste Vorsorgeuntersuchung.
              </p>
            </div>`
          : ''
      }
    </div>`;
}

function viewStatistik() {
  const stats = store.dailyStats(7);
  const max = Math.max(16 * 60, ...stats.map((s) => s.total));
  const withData = stats.filter((s) => s.total > 0);
  // Der laufende Tag ist noch unvollständig und würde den Schnitt drücken.
  const complete = stats.slice(0, -1).filter((s) => s.total > 0);
  const basis = complete.length ? complete : withData;
  const avg = basis.length ? basis.reduce((sum, s) => sum + s.total, 0) / basis.length : 0;
  const avgNaps = basis.length ? basis.reduce((sum, s) => sum + s.naps, 0) / basis.length : 0;
  const today = stats[stats.length - 1];
  const since = addMinutes(new Date(), -60 * 48);
  const timeline = mergeTimeline(
    store.allSleeps().filter((s) => s.start > since),
    store.allEvents().filter((e) => e.at > since)
  );

  return `
    <div class="card">
      <div class="card-head"><h2>Letzte 7 Tage</h2></div>
      <div class="kpis">
        <div class="kpi"><div class="v">${fmtShort(today.total)}</div><div class="k">heute</div></div>
        <div class="kpi"><div class="v">${fmtShort(avg)}</div><div class="k">Ø pro Tag</div></div>
        <div class="kpi"><div class="v">${avgNaps.toFixed(1)}</div><div class="k">Ø Nickerchen</div></div>
      </div>
      <div class="bars">
        ${stats
          .map(
            (s) => `<div class="col">
              <div class="seg nap" style="height:${(s.nap / max) * 100}%" title="Tagschlaf ${fmtDuration(
                s.nap
              )}"></div>
              <div class="seg night" style="height:${(s.night / max) * 100}%" title="Nacht ${fmtDuration(
                s.night
              )}"></div>
            </div>`
          )
          .join('')}
      </div>
      <div class="row" style="justify-content:space-between">
        ${stats
          .map(
            (s) =>
              `<div class="lbl" style="flex:1">${new Intl.DateTimeFormat('de-DE', {
                weekday: 'short'
              }).format(s.day)}</div>`
          )
          .join('')}
      </div>
      <div class="legend" style="margin-top:8px">
        <span><span class="dot nap"></span> Tagschlaf</span>
        <span><span class="dot night"></span> Nacht</span>
      </div>
    </div>

    ${trendKarte()}

    ${nachtKarte()}

    ${(() => {
      const days = store.birthDate() ? ageInDays(store.birthDate(), store.dueDate()) : 0;
      const avg = averageWakings(store.allSleeps());
      const comparison = compareWakings(days, avg);
      const hints = clinicHintsFor(days);
      if (!comparison && !hints.length) return '';
      return `<div class="card">
        <div class="card-head"><h2>Nachts wach</h2>
          <small class="muted">${comparison ? `${comparison.nights} bewertete Nächte` : 'noch keine Angaben'}</small>
        </div>
        ${
          comparison
            ? `<div class="kpis">
                <div class="kpi"><div class="v">${comparison.mean.toFixed(1).replace('.', ',')}</div><div class="k">dein Kind</div></div>
                <div class="kpi"><div class="v">${String(comparison.norm.mean).replace('.', ',')}</div><div class="k">Durchschnitt ${comparison.norm.months} Mon.</div></div>
                <div class="kpi"><div class="v">${
                  comparison.status === 'typisch' ? 'typisch' : comparison.status
                }</div><div class="k">Einordnung</div></div>
              </div>
              <p class="hint" style="margin-top:10px">${esc(comparison.text)}</p>`
            : `<p class="hint">
                Bewerte eine Nacht (Stern im Protokoll oder nach dem Aufwachen) und gib an,
                wie oft dein Kind wach war - dann vergleicht Schlummer das mit
                veröffentlichten Werten Gleichaltriger.
              </p>`
        }
        ${
          hints.length
            ? `<div class="hint" style="margin-top:10px">
                <strong>Die Studienautoren empfehlen, das in der Vorsorge anzusprechen:</strong>
                <ul>${hints.map((h) => `<li>${esc(h.text)}</li>`).join('')}</ul>
              </div>`
            : ''
        }
        <p class="hint">Vergleichswerte: ${esc(NIGHT_NORMS.source)} &middot;
          <button class="chip" data-action="go" data-route="quellen">Quellen</button>
        </p>
      </div>`;
    })()}

    ${(() => {
      const events = store.allEvents();
      const s = summarizeDay(events, new Date());
      if (!s.feeds && !s.diapers) return '';
      return `<div class="card">
        <div class="card-head"><h2>Füttern &amp; Wickeln heute</h2></div>
        <div class="kpis">
          <div class="kpi"><div class="v">${s.feeds}</div><div class="k">Mahlzeiten</div></div>
          <div class="kpi"><div class="v">${s.totalMl ? `${s.totalMl} ml` : '–'}</div><div class="k">Flasche gesamt</div></div>
          <div class="kpi"><div class="v">${s.diapers}</div><div class="k">Windeln</div></div>
        </div>
        <p class="hint" style="margin-top:10px">
          ${s.breast} × Stillen &middot; ${s.bottle} × Flasche &middot; ${s.solid} × Beikost &middot;
          ${s.wet} × nass, ${s.dirty} × Stuhl${
            s.longestFeedGapMin
              ? ` &middot; längste Pause zwischen zwei Mahlzeiten: ${fmtDuration(s.longestFeedGapMin)}`
              : ''
          }
        </p>
      </div>`;
    })()}

    <div class="card">
      <div class="card-head">
        <h2>Protokoll</h2>
        <button class="chip" data-action="add-sleep">+ Schlaf</button>
      </div>
      <ul class="list">
        ${
          timeline.length
            ? timeline
                .map((item) =>
                  item.kind === 'sleep'
                    ? (() => {
                        const s = item.data;
                        return `<li>
                          <span class="dot ${s.type}"></span>
                          <span class="grow">
                            <div><strong>${s.type === 'night' ? 'Nacht' : 'Nickerchen'}</strong>
                              <small class="muted">${new Intl.DateTimeFormat('de-DE', {
                                weekday: 'short'
                              }).format(s.start)}</small></div>
                            <small class="muted">${fmtTime(s.start)}${
                              s.end
                                ? `-${fmtTime(s.end)} &middot; ${fmtDuration(
                                    minutesBetween(s.start, s.end)
                                  )}`
                                : ' - läuft'
                            }${
                              s.type === 'night' && s.wakings != null
                                ? ` &middot; ${s.wakings}× wach`
                                : ''
                            }</small>
                          </span>
                          <button class="chip" data-action="rate-sleep" data-id="${esc(s.id)}"
                            title="Bewerten">${s.settle && s.mood ? '★' : '☆'}</button>
                          <button class="chip" data-action="edit-sleep" data-id="${esc(s.id)}">Bearb.</button>
                        </li>`;
                      })()
                    : (() => {
                        const e = item.data;
                        return `<li>
                          <span class="emoji">${EVENT_TYPES[e.type].emoji}</span>
                          <span class="grow">
                            <div><strong>${esc(describeEvent(e))}</strong>
                              <small class="muted">${new Intl.DateTimeFormat('de-DE', {
                                weekday: 'short'
                              }).format(e.at)}</small></div>
                            <small class="muted">${fmtTime(e.at)}</small>
                          </span>
                          <button class="chip" data-action="edit-event" data-id="${esc(e.id)}">Bearb.</button>
                        </li>`;
                      })()
                )
                .join('')
            : '<li class="muted">Noch keine Einträge. Starte auf „Heute“ ein Nickerchen.</li>'
        }
      </ul>
    </div>`;
}

/**
 * Zeigt Einträge, die so nicht stimmen können - Doppel, Überschneidungen,
 * unmögliche Längen. Sie entstehen durch Fehltipps und verfälschen alles,
 * was die App daraus lernt. Gelöscht wird nur, was du selbst antippst.
 */
function pruefKarte() {
  const konflikte = findConflicts(store.allSleeps(), new Date());
  const luecken = findMissingNights(store.allSleeps(), new Date());
  if (!konflikte.length && !luecken.length) return '';
  const wort = { doppelt: 'Doppelt', ueberlappt: 'Überschneidung', 'zu-lang': 'Zu lang', 'zu-kurz': 'Zu kurz', zukunft: 'Zukunft' };
  return `
    <div class="card">
      <div class="card-head">
        <h2>Einträge prüfen</h2>
        <small class="muted">${konflikte.length + luecken.length} offen</small>
      </div>
      <p class="hint">
        ${
          luecken.length
            ? `An ${luecken.length} ${
                luecken.length === 1 ? 'Abend' : 'Abenden'
              } fehlt die Nacht - solche Tage zählen beim Lernen kaum mit. `
            : ''
        }${
          konflikte.length
            ? 'Die anderen Einträge können so nicht stimmen und ziehen die errechneten Zeiten schief. Tippe einen an, um ihn zu korrigieren, oder wirf ihn weg.'
            : 'Trag sie nach, dann rechnet der Plan mit vollständigen Tagen.'
        }
      </p>
      ${
        luecken.length
          ? `<ul class="list compare">
              ${luecken
                .map(
                  (tag) => `<li>
                    <span class="grow"><strong>Nacht fehlt</strong>
                      <small class="muted">${fmtShort2(tag)} &middot; kein Nachtschlaf erfasst</small>
                    </span>
                    <button class="chip" data-action="add-night-on"
                      data-date="${tag.toISOString()}">Nachtragen</button>
                  </li>`
                )
                .join('')}
            </ul>`
          : ''
      }
      <ul class="list compare">
        ${konflikte
          .map(
            (k) => `<li>
              <span class="grow">
                <strong>${esc(wort[k.grund] || 'Auffällig')}</strong>
                <small class="muted">${fmtShort2(k.sleep.start)} ${fmtTime(k.sleep.start)}&ndash;${
                  k.sleep.end ? fmtTime(k.sleep.end) : 'läuft'
                } &middot; ${esc(k.text)}</small>
              </span>
              <button class="chip" data-action="edit-sleep" data-id="${esc(k.id)}">Ändern</button>
              <button class="chip danger" data-action="drop-sleep" data-id="${esc(k.id)}">Weg</button>
            </li>`
          )
          .join('')}
      </ul>
    </div>`;
}

/** "Do 20.08." - kurzes Datum für Listen. */
function fmtShort2(date) {
  return new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(date);
}

function viewMehr() {
  const s = store.getState();
  return `
    ${installCard()}

    ${pruefKarte()}

    <div class="card">
      <div class="card-head"><h2>Kind</h2></div>
      <label class="field">Name
        <input type="text" id="child-name" value="${esc(s.child.name)}" placeholder="z. B. Mia" />
      </label>
      <label class="field">Geburtsdatum
        <input type="date" id="child-birth" value="${esc(s.child.birthDate)}" />
      </label>
      <label class="field">Errechneter Termin (nur bei Frühgeburt)
        <input type="date" id="child-due" value="${esc(s.child.dueDate)}" />
      </label>
      <label class="field">Uebliche Aufwachzeit
        <input type="time" id="default-morning" value="${esc(s.settings.morningWake)}" />
      </label>
      <button class="primary block" data-action="save-child">Speichern</button>
    </div>

    <div class="card">
      <div class="card-head"><h2>Persönlicher Plan</h2></div>
      <label class="spread">
        <span>Aus den eigenen Daten lernen</span>
        <input type="checkbox" id="learning" ${s.settings.learning ? 'checked' : ''} />
      </label>
      <label class="spread" style="margin-top:12px">
        <span>Nach dem Aufwachen nach Bewertung fragen</span>
        <input type="checkbox" id="rate-prompt" ${s.settings.ratePrompt ? 'checked' : ''} />
      </label>
      <p class="hint" style="margin-top:8px">
        Ist das Lernen aus, rechnet Schlummer ausschließlich mit den Altersrichtwerten.
        Angeschaltet fließen die letzten drei Wochen deines Protokolls ein - je mehr
        Einträge, desto stärker. Die Bewertungen („schnell eingeschlafen?“, „ausgeschlafen
        aufgewacht?“) verraten zusätzlich, ob die Wachfenster zu kurz oder zu lang sind.
        Ohne Nachfrage lässt sich jederzeit über den Stern im Protokoll bewerten.
      </p>
    </div>

    <div class="card">
      <div class="card-head"><h2>Erinnerung</h2></div>
      <label class="spread">
        <span>Hinweis, wenn das Wachfenster endet</span>
        <input type="checkbox" id="reminders" ${s.settings.reminders ? 'checked' : ''} />
      </label>
      <p class="hint" style="margin-top:8px">
        ${
          !('Notification' in window)
            ? '<strong>Dieser Browser kann keine Benachrichtigungen anzeigen.</strong>'
            : Notification.permission === 'granted'
              ? 'Benachrichtigungen sind erlaubt. Die Erinnerung kommt 15 Minuten vor der Zeit, die auf der Startseite steht.'
              : Notification.permission === 'denied'
                ? '<strong>Benachrichtigungen sind für diese Seite blockiert.</strong> Das lässt sich nur in den Browser-Einstellungen wieder erlauben (Schloss-Symbol in der Adresszeile).'
                : 'Noch nicht erlaubt - ohne Erlaubnis kommt keine Erinnerung.'
        }
        Sie funktioniert nur, solange Schlummer geöffnet ist bzw. im Hintergrund läuft.
      </p>
      ${
        'Notification' in window && Notification.permission === 'default'
          ? `<button class="chip" data-action="ask-notify">Benachrichtigungen erlauben</button>`
          : ''
      }
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Daten</h2>
        <small class="muted">${
          (() => {
            const age = daysSince(s.settings.lastBackupAt);
            if (age == null) return 'noch nie gesichert';
            return age === 0 ? 'heute gesichert' : `zuletzt vor ${age} ${age === 1 ? 'Tag' : 'Tagen'}`;
          })()
        }</small>
      </div>
      ${
        (() => {
          const age = daysSince(s.settings.lastBackupAt);
          return age == null || age >= 3
            ? `<p class="hint" style="margin-bottom:10px"><strong>Sicherung fällig.</strong>
                „Exportieren“ legt eine JSON-Datei ab, „Kopieren“ dasselbe in die
                Zwischenablage - reicht schon, sie sich selbst zu schicken.</p>`
            : '';
        })()
      }
      <div class="row">
        <button data-action="export">Exportieren</button>
        <button data-action="copy">Kopieren</button>
        <button data-action="import">Importieren</button>
        <button class="danger" data-action="reset">Alles löschen</button>
      </div>
      <p class="hint" style="margin-top:10px">
        Speicher: <strong>${
          storageState.persisted === true
            ? 'dauerhaft'
            : storageState.persisted === false
              ? 'nicht dauerhaft'
              : 'unbekannt'
        }</strong>
        ${
          storageState.persisted === false
            ? ` &middot; <button class="chip" data-action="persist">Dauerhaft speichern</button>`
            : ''
        }
      </p>
      <p class="hint">
        ${
          isStandalone()
            ? 'Als installierte App bleiben die Daten erhalten, bis du sie selbst löschst.'
            : isIOS()
              ? 'Nicht installiert: Safari räumt den Speicher normaler Tabs nach etwa einer Woche ohne Nutzung auf. Für einen Test über mehrere Tage die App oben installieren.'
              : 'Nicht installiert: Chrome behält die Daten zwar deutlich länger als Safari, löscht sie aber bei Speicherknappheit. Für einen Test über mehrere Tage die App oben installieren.'
        }
      </p>
      <p class="hint" style="margin-top:10px">
        Alle Daten liegen ausschließlich auf diesem Gerät (localStorage). Es gibt kein
        Konto, keinen Server und kein Tracking. Für den Wechsel auf ein anderes Gerät
        die JSON-Datei exportieren und dort importieren - „Kopieren“ legt dieselben
        Daten in die Zwischenablage, falls Downloads blockiert sind.
      </p>
    </div>

    <div class="card">
      <div class="card-head"><h2>Notizen zum Test</h2>
        <small class="muted">${store.allNotes().length} gespeichert</small>
      </div>
      <label class="field">Was ist dir aufgefallen?
        <textarea id="note-text" rows="2" placeholder="z. B. Plan lag 30 Min daneben, Ton brach beim Sperren ab"></textarea>
      </label>
      <button data-action="add-note">Notiz speichern</button>
      <ul class="list" style="margin-top:10px">
        ${store
          .allNotes()
          .slice(0, 8)
          .map(
            (n) => `<li>
              <span class="grow">
                <div>${esc(n.text)}</div>
                <small class="muted">${new Intl.DateTimeFormat('de-DE', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit'
                }).format(n.at)}</small>
              </span>
              <button class="chip" data-action="delete-note" data-id="${esc(n.id)}">×</button>
            </li>`
          )
          .join('')}
      </ul>
      <p class="hint" style="margin-top:8px">
        Die Notizen liegen mit im Export - so kommt der Kontext zu den Zahlen mit,
        wenn du die Datei zurückschickst.
      </p>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Woher die Zahlen kommen</h2>
        <button class="chip" data-action="go" data-route="quellen">Ansehen</button>
      </div>
      <p class="hint">
        Gesamtschlafmengen und Nickerchen-Übergänge stammen aus Leitlinien und Studien,
        die Wachfenster sind Praxiswerte ohne Studienbeleg. Welche Zahl woher kommt,
        steht auf der Quellenseite.
      </p>
    </div>

    <div class="card">
      <div class="card-head"><h2>Gut zu wissen</h2></div>
      <p class="hint">
        Schlummer gibt Orientierung und ersetzt keine ärztliche Beratung. Bei Sorgen um
        Schlaf, Atmung oder Gedeihen deines Kindes wende dich an Kinderarztpraxis oder
        Hebamme.
      </p>
      <p class="hint">
        Sichere Schlafumgebung (kindergesundheit-info.de der BZgA): Rückenlage, Schlafsack
        statt Decke, fester Untergrund, eigenes Babybett im Elternschlafzimmer, keine
        Kissen, Decken oder Nestchen, rauchfrei, Zimmertemperatur nicht über 18 °C.
      </p>
      <p class="hint">Version 3.2 &middot; Offline nutzbar &middot; Quelloffen</p>
    </div>`;
}

function viewQuellen() {
  return `
    <div class="card">
      <div class="card-head"><h2>Woher die Zahlen kommen</h2>
        <button class="chip" data-action="go" data-route="mehr">Zurück</button>
      </div>
      <p class="hint">
        Schlummer mischt drei Sorten von Wissen. Sie sind unterschiedlich gut belegt -
        deshalb steht hier, welche Zahl woher stammt.
      </p>
    </div>

    ${SOURCES.map(
      (s) => `<div class="card">
        <div class="card-head">
          <h2 style="font-size:.98rem">${esc(s.topic)}</h2>
          <span class="tag ${s.strength.startsWith('Praxis') ? 'warn' : ''}">${esc(s.strength)}</span>
        </div>
        <p class="hint">${esc(s.text)}</p>
        ${
          s.url
            ? `<p class="hint"><a href="${esc(s.url)}" target="_blank" rel="noreferrer noopener">Quelle öffnen</a></p>`
            : ''
        }
      </div>`
    ).join('')}

    <div class="card">
      <div class="card-head"><h2>Und die eigenen Daten?</h2></div>
      <p class="hint">
        Die wichtigste Datenquelle bist am Ende du: Alle Werte oben sind nur der
        Startpunkt. Sobald dein Protokoll ein paar Tage umfasst, rechnet Schlummer mit
        den Wachfenstern, Nickerchenlängen und Zeiten deines Kindes - Studienwerte
        beschreiben Mittelwerte, dein Kind ist ein Einzelfall. Die große Streuung ist
        selbst belegt: Galland et al. fanden bei Säuglingen 9,7 bis 15,9 Stunden
        Gesamtschlaf als normale Spanne.
      </p>
    </div>`;
}

const VIEWS = {
  heute: viewHeute,
  plan: viewPlan,
  sounds: viewSounds,
  statistik: viewStatistik,
  mehr: viewMehr,
  quellen: viewQuellen
};

/* -------------------------------------------------------------- Onboarding */

function viewOnboarding() {
  return `
    <div class="card" style="margin-top:24px">
      <h1>Willkommen bei Schlummer 🌙</h1>
      <p class="hint">
        Schlummer berechnet aus dem Alter deines Kindes passende Wachfenster, schlägt
        Nickerchen- und Bettzeiten vor, protokolliert den Schlaf und spielt
        Einschlafgeräusche ab. Kostenlos, offline, ohne Konto.
      </p>
      <label class="field">Name des Kindes (optional)
        <input type="text" id="ob-name" placeholder="z. B. Mia" />
      </label>
      <label class="field">Geburtsdatum
        <input type="date" id="ob-birth" value="${new Date().toISOString().slice(0, 10)}" />
      </label>
      <label class="field">Errechneter Termin (nur bei Frühgeburt)
        <input type="date" id="ob-due" />
      </label>
      <label class="field">Uebliche Aufwachzeit am Morgen
        <input type="time" id="ob-morning" value="07:00" />
      </label>
      <button class="primary block" data-action="onboard">Los geht's</button>
    </div>`;
}

/* ----------------------------------------------------------------- Render */

function renderTopbar() {
  if (!store.hasChild()) {
    topbar.innerHTML = '<div class="who"><span class="avatar">S</span><span class="name">Schlummer</span></div>';
    return;
  }
  const s = store.getState();
  const days = ageInDays(store.birthDate(), store.dueDate());
  const band = bandForAge(days);
  const name = s.child.name || 'Mein Kind';
  topbar.innerHTML = `
    <div class="who">
      <span class="avatar">${esc(name.slice(0, 1).toUpperCase())}</span>
      <span>
        <div class="name">${esc(name)}</div>
        <small class="muted">${esc(formatAge(days))} &middot; ${esc(band.label)}</small>
      </span>
    </div>
    <button class="chip" data-action="go" data-route="mehr">Profil</button>`;
}

function renderTabbar() {
  tabbar.innerHTML = TABS.map(
    (t) => `<button data-action="go" data-route="${t.id}" ${
      route === t.id ? 'aria-current="page"' : ''
    }><span class="ico">${t.icon}</span>${esc(t.label)}</button>`
  ).join('');
  tabbar.hidden = !store.hasChild();
}

function renderNowPlaying() {
  const id = audio.currentSoundId();
  const active = Boolean(id) && audio.isPlaying();
  document.body.classList.toggle('has-nowplaying', active);
  if (!active) {
    nowplayingEl.innerHTML = '';
    return;
  }
  const sound = soundById(id);
  const end = audio.timerEnd();
  nowplayingEl.innerHTML = `
    <div class="nowplaying">
      <div class="eq" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="meta">
        <div class="title">${sound.emoji} ${esc(sound.name)}</div>
        <small class="muted">${
          end ? `stoppt in ${fmtCountdown(end - Date.now())}` : 'läuft dauerhaft'
        }</small>
      </div>
      <button data-action="stop-sound">Stopp</button>
    </div>`;
}

function render() {
  renderTopbar();
  renderTabbar();
  if (!store.hasChild()) {
    view.innerHTML = viewOnboarding();
  } else {
    view.innerHTML =
      route === 'heute' && reviewDay ? viewTag(reviewDay) : (VIEWS[route] || viewHeute)();
  }
  renderNowPlaying();
}

/** Nur die Werte aktualisieren, die im Sekundentakt laufen. */
function tickLight() {
  if (route === 'heute' && !reviewDay && store.hasChild()) {
    const ctx = context();
    const centerEl = view.querySelector('.arc-center');
    if (centerEl) {
      const state = arcCenter(ctx);
      const set = (sel, text) => {
        const el = centerEl.querySelector(sel);
        if (el && el.textContent !== text) el.textContent = text;
      };
      set('.head', state.head);
      set('.big', state.big);
      set('.sub', state.sub);
      centerEl.classList.toggle('over', ringState(ctx).over);
      // Der Jetzt-Punkt wandert mit.
      const dot = view.querySelector('.arc-now');
      if (dot) {
        const span = Math.max(60, minutesBetween(ctx.morningWake, ctx.plan.bedtime));
        const elapsed = Math.max(0, Math.min(1, minutesBetween(ctx.morningWake, ctx.now) / span));
        const p = arcPoint(elapsed);
        dot.setAttribute('cx', p.x.toFixed(1));
        dot.setAttribute('cy', p.y.toFixed(1));
      }
    }
  }
  const np = nowplayingEl.querySelector('.nowplaying small');
  const end = audio.timerEnd();
  if (np && end) np.textContent = `stoppt in ${fmtCountdown(end - Date.now())}`;
}

/* ----------------------------------------------------------------- Dialoge */

function openSleepDialog(id, defaults = null) {
  const entry = id ? store.allSleeps().find((s) => s.id === id) : null;
  const start = entry ? entry.start : defaults ? defaults.start : addMinutes(new Date(), -60);
  const end = entry && entry.end ? entry.end : defaults ? defaults.end : new Date();
  const type = entry ? entry.type : defaults ? defaults.type : 'nap';
  dialog.innerHTML = `
    <form method="dialog">
      <h2>${entry ? 'Eintrag bearbeiten' : 'Schlaf nachtragen'}</h2>
      <label class="field">Art
        <select id="d-type">
          <option value="nap" ${type === 'nap' ? 'selected' : ''}>Nickerchen</option>
          <option value="night" ${type === 'night' ? 'selected' : ''}>Nacht</option>
        </select>
      </label>
      <label class="field">Beginn
        <input type="datetime-local" id="d-start" value="${localInput(start)}" />
      </label>
      <div class="row tight nudge">
        ${[-15, -5, 5, 15]
          .map(
            (m) => `<button type="button" class="chip" data-action="shift-time"
              data-field="d-start" data-min="${m}">${m > 0 ? '+' : ''}${m} Min</button>`
          )
          .join('')}
      </div>
      <label class="check">
        <input type="checkbox" id="d-running" ${
          (entry && !entry.end) || (!entry && defaults && defaults.running) ? 'checked' : ''
        } />
        <span>Schlaf läuft noch (kein Ende)</span>
      </label>
      <div id="d-end-block">
        <label class="field">Ende
          <input type="datetime-local" id="d-end" value="${localInput(end)}" />
        </label>
        <div class="row tight nudge">
          ${[-15, -5, 5, 15]
            .map(
              (m) => `<button type="button" class="chip" data-action="shift-time"
                data-field="d-end" data-min="${m}">${m > 0 ? '+' : ''}${m} Min</button>`
            )
            .join('')}
          <button type="button" class="chip" data-action="shift-time" data-field="d-end" data-now="1">jetzt</button>
        </div>
      </div>
      <p class="hint" id="d-duration"></p>
      <div class="row" style="justify-content:flex-end">
        ${entry ? '<button class="danger" value="delete">Löschen</button>' : ''}
        <button value="cancel">Abbrechen</button>
        <button class="primary" value="save">Speichern</button>
      </div>
      ${entry && type === 'night' ? interruptionEditor(entry) : ''}
    </form>`;
  dialog.returnValue = '';
  dialog.showModal();
  const runningBox = dialog.querySelector('#d-running');
  const syncRunning = () => {
    const on = runningBox.checked;
    dialog.querySelector('#d-end-block').hidden = on;
    const endEl = dialog.querySelector('#d-end');
    endEl.disabled = on;
    if (!on) {
      // Nach dem Abwählen soll ein sinnvolles Ende dastehen, nicht der alte
      // (womöglich vor dem Beginn liegenden) Wert.
      const startVal = new Date(dialog.querySelector('#d-start').value);
      const endVal = new Date(endEl.value);
      if (Number.isNaN(endVal.getTime()) || endVal <= startVal) {
        const jetzt = new Date();
        endEl.value = localInput(jetzt > startVal ? jetzt : addMinutes(startVal, 30));
      }
    }
    updateDialogDuration();
  };
  runningBox.addEventListener('change', syncRunning);
  syncRunning();
  dialog.addEventListener(
    'close',
    () => {
      const action = dialog.returnValue;
      if (action === 'delete' && entry) {
        store.deleteSleep(entry.id);
        render();
        toast('Eintrag gelöscht');
        return;
      }
      if (action !== 'save') return;
      const type = dialog.querySelector('#d-type').value;
      const laeuft = dialog.querySelector('#d-running').checked;
      const startVal = new Date(dialog.querySelector('#d-start').value);
      const endVal = laeuft ? null : new Date(dialog.querySelector('#d-end').value);
      if (Number.isNaN(startVal.getTime()) || startVal > new Date()) {
        toast('Der Beginn darf nicht in der Zukunft liegen');
        return;
      }
      if (!laeuft && (Number.isNaN(endVal.getTime()) || endVal <= startVal)) {
        toast('Bitte gültigen Zeitraum angeben');
        return;
      }
      // Ein laufender Schlaf ist einmalig: ein anderer wird dabei beendet.
      if (entry) {
        store.updateSleep(entry.id, { start: startVal, end: endVal, type });
        if (laeuft) store.resumeSleep(entry.id);
      } else {
        const id = store.addSleep({ start: startVal, end: endVal, type });
        if (laeuft) store.resumeSleep(id);
      }
      // Ohne dieses render() bliebe der Plan auf dem alten Stand stehen.
      render();
      toast('Gespeichert');
    },
    { once: true }
  );
}

/**
 * Abschnitt für nächtliches Aufwachen im Bearbeiten-Dialog. Die Zeiten wirken
 * sofort - so lässt sich eine Nacht auch am nächsten Morgen noch richtigstellen.
 */
function interruptionEditor(entry) {
  const gaps = entry.interruptions || [];
  return `
    <fieldset class="rate-group" style="margin-top:16px">
      <legend>Nachts wach (${gaps.length})</legend>
      ${
        gaps.length
          ? gaps
              .map(
                (gap, i) => `<div class="gap-row">
                  <label class="field">Wach ab
                    <input type="datetime-local" data-action="set-waking" data-id="${esc(entry.id)}"
                      data-index="${i}" data-field="start" value="${localInput(gap.start)}" />
                  </label>
                  <label class="field">${gap.end ? 'Schläft wieder' : 'Schläft wieder (offen)'}
                    <input type="datetime-local" data-action="set-waking" data-id="${esc(entry.id)}"
                      data-index="${i}" data-field="end" value="${gap.end ? localInput(gap.end) : ''}" />
                  </label>
                  <div class="spread">
                    <small class="muted">${
                      gap.end
                        ? `${fmtDuration(minutesBetween(gap.start, gap.end))} wach`
                        : 'läuft noch'
                    }</small>
                    <button type="button" class="chip danger" data-action="delete-waking"
                      data-id="${esc(entry.id)}" data-index="${i}">Entfernen</button>
                  </div>
                </div>`
              )
              .join('')
          : '<p class="hint">Keine nächtliche Wachphase erfasst.</p>'
      }
      <button type="button" class="chip" data-action="add-waking" data-id="${esc(entry.id)}">
        + Nächtliches Aufwachen
      </button>
    </fieldset>`;
}

/** Zeigt im Bearbeiten-Dialog die resultierende Dauer an. */
function updateDialogDuration() {
  const out = dialog.querySelector('#d-duration');
  const startEl = dialog.querySelector('#d-start');
  const endEl = dialog.querySelector('#d-end');
  if (!out || !startEl || !endEl) return;
  const laeuft = dialog.querySelector('#d-running');
  if (laeuft && laeuft.checked) {
    const seit = new Date(startEl.value);
    out.textContent = Number.isNaN(seit.getTime())
      ? ''
      : `Läuft seit ${fmtDuration(Math.max(0, minutesBetween(seit, new Date())))}`;
    return;
  }
  const start = new Date(startEl.value);
  const end = new Date(endEl.value);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    out.innerHTML = '<strong>Ende liegt vor dem Beginn</strong>';
    return;
  }
  out.textContent = `Dauer: ${fmtDuration(minutesBetween(start, end))}`;
}

/**
 * Bewertungs-Dialog: zwei Fragen, je drei große Flächen. Jede Antwort wird
 * sofort gespeichert - sind beide da, schließt sich der Dialog von selbst.
 */
function openRatingDialog(id) {
  const entry = store.allSleeps().find((s) => s.id === id);
  if (!entry) return;
  const night = entry.type === 'night';
  const minutes = entry.end ? minutesBetween(entry.start, entry.end) : 0;

  const group = (field, config) => `
    <fieldset class="rate-group">
      <legend>${esc(
        field === 'settle' && night ? 'Wie lief das Einschlafen am Abend?' : config.question
      )}</legend>
      ${config.options
        .map(
          (option) => `<button type="button" class="rate-option" data-action="rate"
            data-id="${esc(id)}" data-field="${field}" data-value="${esc(option.id)}"
            aria-pressed="${
              field === 'wakings' && entry.wakings == null && (entry.interruptions || []).length
                ? String(Math.min(4, entry.interruptions.length)) === option.id
                : entry[field] === option.id
            }">
            <span class="emoji">${option.emoji}</span>
            <span class="grow">
              <strong>${esc(option.label)}</strong>
              <small class="muted">${esc(option.hint)}</small>
            </span>
          </button>`
        )
        .join('')}
    </fieldset>`;

  dialog.innerHTML = `
    <div class="rate-sheet">
      <div class="card-head">
        <h2>${night ? 'Wie lief die Nacht?' : 'Wie lief das Nickerchen?'}</h2>
        <small class="muted">${fmtTime(entry.start)}${
          entry.end ? `-${fmtTime(entry.end)} &middot; ${fmtDuration(minutes)}` : ''
        }</small>
      </div>
      ${group('settle', RATING.settle)}
      ${night ? group('wakings', RATING.wakings) : ''}
      ${
        night && (entry.interruptions || []).length
          ? `<p class="hint" style="margin-top:-6px">
              ${entry.interruptions.length} Wachphase${
                entry.interruptions.length === 1 ? '' : 'n'
              } erfasst - schon vorausgewählt.
            </p>`
          : ''
      }
      ${group('mood', RATING.mood)}
      <p class="hint">
        Aus diesen Antworten lernt Schlummer, welches Wachfenster für dein Kind
        wirklich passt - nicht nur, wann es geschlafen hat.
      </p>
      <div class="row" style="justify-content:space-between">
        <button data-action="edit-sleep" data-id="${esc(id)}">Zeiten korrigieren</button>
        <button data-action="close-dialog">${entry.settle || entry.mood ? 'Fertig' : 'Später'}</button>
      </div>
      <button class="ghost block" data-action="resume" data-id="${esc(id)}"
        style="margin-top:10px">Doch nicht aufgewacht - Schlaf läuft weiter</button>
    </div>`;
  if (!dialog.open) dialog.showModal();
}

/**
 * Eigenes Sheet für eine nächtliche Wachphase: von wann bis wann war das
 * Kind wach. Der häufigste Fall ist das Nachtragen am nächsten Morgen -
 * deshalb ein eigener Knopf statt nur der Live-Erfassung.
 */
function openWakingDialog(sleepId, index = null) {
  const sleep = store.allSleeps().find((s) => s.id === sleepId);
  if (!sleep) return;
  const gaps = sleep.interruptions || [];
  const gap = index === null ? null : gaps[index];
  const now = new Date();
  const nachtEnde = sleep.end || now;
  // Vorschlag: bei laufender Nacht die letzte halbe Stunde, sonst die Mitte
  // der Nacht - von dort ist es mit den Knöpfen nicht weit.
  const mitte = addMinutes(sleep.start, Math.round(minutesBetween(sleep.start, nachtEnde) / 2));
  const start = gap ? gap.start : sleep.end ? addMinutes(mitte, -15) : addMinutes(now, -30);
  const end = gap ? gap.end : sleep.end ? addMinutes(mitte, 15) : now;
  const laeuft = Boolean(gap && !gap.end);
  const nudges = (field) =>
    [-15, -5, 5, 15]
      .map(
        (m) => `<button type="button" class="chip" data-action="shift-time"
          data-field="${field}" data-min="${m}">${m > 0 ? '+' : ''}${m} Min</button>`
      )
      .join('');

  dialog.innerHTML = `
    <form method="dialog">
      <h2>${gap ? 'Wachphase bearbeiten' : 'Nachts wach nachtragen'}</h2>
      <p class="hint">
        Nacht ${fmtTime(sleep.start)}&ndash;${sleep.end ? fmtTime(sleep.end) : 'läuft'}.
        Die Wachzeit wird vom Nachtschlaf abgezogen und verschiebt die weiteren Zeiten.
      </p>
      <label class="field">Wach ab
        <input type="datetime-local" id="w-start" value="${localInput(start)}" />
      </label>
      <div class="row tight nudge">${nudges('w-start')}</div>
      ${
        sleep.end
          ? ''
          : `<label class="check">
              <input type="checkbox" id="w-open" ${laeuft ? 'checked' : ''} />
              <span>ist noch wach</span>
            </label>`
      }
      <div id="w-end-block">
        <label class="field">Schläft wieder
          <input type="datetime-local" id="w-end" value="${localInput(end || now)}" />
        </label>
        <div class="row tight nudge">
          ${nudges('w-end')}
          <button type="button" class="chip" data-action="shift-time" data-field="w-end" data-now="1">jetzt</button>
        </div>
      </div>
      <p class="hint" id="w-duration"></p>
      <div class="row" style="justify-content:flex-end">
        ${gap ? '<button class="danger" value="delete">Löschen</button>' : ''}
        <button value="cancel">Abbrechen</button>
        <button class="primary" value="save">Speichern</button>
      </div>
    </form>`;
  dialog.returnValue = '';
  if (!dialog.open) dialog.showModal();
  const openBox = dialog.querySelector('#w-open');
  const sync = () => {
    const offen = Boolean(openBox && openBox.checked);
    dialog.querySelector('#w-end-block').hidden = offen;
    dialog.querySelector('#w-end').disabled = offen;
    updateWakingDuration();
  };
  if (openBox) openBox.addEventListener('change', sync);
  sync();

  dialog.addEventListener(
    'close',
    () => {
      const action = dialog.returnValue;
      if (action === 'delete' && gap) {
        store.deleteInterruption(sleepId, index);
        render();
        toast('Wachphase gelöscht');
        return;
      }
      if (action !== 'save') return;
      const offen = Boolean(openBox && openBox.checked);
      const startVal = new Date(dialog.querySelector('#w-start').value);
      const endVal = offen ? null : new Date(dialog.querySelector('#w-end').value);
      if (Number.isNaN(startVal.getTime())) {
        toast('Bitte eine Uhrzeit angeben');
        return;
      }
      if (!offen && (Number.isNaN(endVal.getTime()) || endVal <= startVal)) {
        toast('Das Ende muss nach dem Beginn liegen');
        return;
      }
      // Eine Wachphase gehört in die Nacht - sonst stimmt die Bilanz nicht.
      const grenze = sleep.end || new Date();
      if (startVal < sleep.start || (endVal && endVal > grenze)) {
        toast(`Nur innerhalb der Nacht (${fmtTime(sleep.start)}-${fmtTime(grenze)})`);
        return;
      }
      if (gap) store.updateInterruption(sleepId, index, { start: startVal, end: endVal });
      else store.addInterruption(sleepId, startVal, endVal);
      render();
      toast(
        offen
          ? 'Wachphase läuft'
          : `${fmtDuration(minutesBetween(startVal, endVal))} wach erfasst`
      );
    },
    { once: true }
  );
}

/** Dauer-Hinweis im Wachphasen-Sheet. */
function updateWakingDuration() {
  const out = dialog.querySelector('#w-duration');
  const startEl = dialog.querySelector('#w-start');
  const endEl = dialog.querySelector('#w-end');
  if (!out || !startEl || !endEl) return;
  const openBox = dialog.querySelector('#w-open');
  if (openBox && openBox.checked) {
    out.textContent = 'Läuft noch';
    return;
  }
  const start = new Date(startEl.value);
  const end = new Date(endEl.value);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    out.innerHTML = '<strong>Ende liegt vor dem Beginn</strong>';
    return;
  }
  out.textContent = `${fmtDuration(minutesBetween(start, end))} wach`;
}

/**
 * Aufstehzeit ändern. Gibt es die Nacht dazu als Eintrag, wandert ihr Ende
 * mit - sonst wird die übliche Aufstehzeit in den Einstellungen angepasst.
 */
function openMorningDialog(day = new Date()) {
  const aktuell = store.morningWakeFor(day);
  const nacht = store
    .allSleeps()
    .filter((s) => s.type === 'night' && s.end && sameDay(s.end, day))
    .pop();
  dialog.innerHTML = `
    <form method="dialog">
      <h2>Aufgestanden</h2>
      <p class="hint">
        ${
          nacht
            ? `Die Nacht ist ab ${fmtTime(nacht.start)} erfasst. Die Aufstehzeit ist ihr Ende.`
            : 'Für diesen Morgen ist keine Nacht erfasst - die Zeit gilt als üblicher Start in den Tag.'
        }
      </p>
      <label class="field">Uhrzeit
        <input type="time" id="m-time" value="${hhmm(aktuell)}" />
      </label>
      <div class="row tight nudge">
        ${[-15, -5, 5, 15]
          .map(
            (m) => `<button type="button" class="chip" data-action="shift-morning"
              data-min="${m}">${m > 0 ? '+' : ''}${m} Min</button>`
          )
          .join('')}
      </div>
      <div class="row" style="justify-content:flex-end">
        <button value="cancel">Abbrechen</button>
        <button class="primary" value="save">Speichern</button>
      </div>
    </form>`;
  dialog.returnValue = '';
  if (!dialog.open) dialog.showModal();
  dialog.addEventListener(
    'close',
    () => {
      if (dialog.returnValue !== 'save') return;
      const value = dialog.querySelector('#m-time').value;
      const [h, m] = value.split(':').map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return toast('Bitte eine Uhrzeit angeben');
      const wann = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
      if (nacht) {
        if (wann <= nacht.start) return toast('Das Aufstehen liegt vor dem Einschlafen');
        store.updateSleep(nacht.id, { end: wann });
      } else {
        store.update((s) => {
          s.settings.morningWake = value;
        });
      }
      render();
      toast(`Aufgestanden ${fmtTime(wann)}`);
    },
    { once: true }
  );
}

/**
 * Sheet für Fütterung und Wickeln. Ein Eintrag entsteht sofort beim Tippen
 * der Schnellzugriffe - hier werden nur noch Details ergänzt oder korrigiert.
 */
function openEventDialog(id) {
  const event = store.allEvents().find((e) => e.id === id);
  if (!event) return;
  const type = EVENT_TYPES[event.type];
  const isBreast = event.type === 'feed' && event.kind === 'breast';
  const isBottle = event.type === 'feed' && event.kind === 'bottle';

  const chips = (field, options, current) =>
    options
      .map(
        (o) => `<button type="button" class="chip" data-action="event-set"
          data-id="${esc(id)}" data-field="${field}" data-value="${esc(o.id ?? o)}"
          aria-pressed="${String(current) === String(o.id ?? o)}">${esc(o.label ?? o)}</button>`
      )
      .join('');

  dialog.innerHTML = `
    <div class="rate-sheet">
      <div class="card-head">
        <h2>${type.emoji} ${esc(type.label)}</h2>
        <small class="muted">${esc(describeEvent(event))}</small>
      </div>

      <fieldset class="rate-group">
        <legend>Art</legend>
        ${type.kinds
          .map(
            (k) => `<button type="button" class="rate-option" data-action="event-set"
              data-id="${esc(id)}" data-field="kind" data-value="${esc(k.id)}"
              aria-pressed="${event.kind === k.id}">
              <span class="emoji">${k.emoji}</span>
              <span class="grow"><strong>${esc(k.label)}</strong>
                <small class="muted">${esc(k.hint)}</small></span>
            </button>`
          )
          .join('')}
      </fieldset>

      ${
        isBreast
          ? `<fieldset class="rate-group">
              <legend>Seite</legend>
              <div class="row tight">${chips('side', SIDES, event.side)}</div>
            </fieldset>
            <fieldset class="rate-group">
              <legend>Dauer</legend>
              <div class="row tight">${chips(
                'minutes',
                [5, 10, 15, 20, 25, 30].map((m) => ({ id: m, label: `${m} Min` })),
                event.minutes
              )}</div>
            </fieldset>`
          : ''
      }

      ${
        isBottle
          ? `<fieldset class="rate-group">
              <legend>Menge</legend>
              <div class="row tight">${chips(
                'amountMl',
                [30, 60, 90, 120, 150, 180, 210, 240].map((m) => ({ id: m, label: `${m} ml` })),
                event.amountMl
              )}</div>
              <label class="field">Andere Menge (ml)
                <input type="number" inputmode="numeric" min="0" max="500" step="10"
                  id="event-ml" value="${event.amountMl ?? ''}" />
              </label>
            </fieldset>`
          : ''
      }

      <label class="field">Zeitpunkt
        <input type="datetime-local" id="event-at" value="${localInput(event.at)}" />
      </label>

      <div class="row" style="justify-content:space-between">
        <button class="danger" data-action="event-delete" data-id="${esc(id)}">Löschen</button>
        <button class="primary" data-action="close-dialog">Fertig</button>
      </div>
    </div>`;
  if (!dialog.open) dialog.showModal();
}

/* -------------------------------------------------------------- Aktionen */

const actions = {
  go(el) {
    route = el.dataset.route;
    // Der Reiter "Heute" führt immer zum heutigen Tag zurück.
    if (route === 'heute') reviewDay = null;
    render();
    view.focus();
  },
  'toggle-strip'() {
    stripOpen = !stripOpen;
    if (!stripOpen) stripWeek = null;
    render();
  },
  'strip-week'(el) {
    const basis = stripWeek || reviewDay || new Date();
    const next = new Date(basis);
    next.setDate(next.getDate() + 7 * Number(el.dataset.delta));
    stripWeek = next;
    render();
  },
  'pick-day'(el) {
    const heute = new Date();
    if (el.dataset.date === 'today') {
      reviewDay = null;
      stripWeek = null;
    } else {
      const gewaehlt = startOfDay(new Date(el.dataset.date));
      reviewDay = sameDay(gewaehlt, heute) ? null : gewaehlt;
      stripWeek = gewaehlt;
    }
    route = 'heute';
    stripOpen = false;
    render();
    window.scrollTo({ top: 0 });
  },
  'add-night-on'(el) {
    // Vorschlag: übliche Bettzeit an jenem Abend bis zur üblichen Aufstehzeit.
    const tag = startOfDay(new Date(el.dataset.date));
    const s = store.getState().settings;
    const [bh, bm] = (store.getState().settings.morningWake || '06:30').split(':').map(Number);
    const ctx = context();
    const bett = new Date(tag);
    const uebliche = ctx.plan && ctx.plan.bedtime ? ctx.plan.bedtime : null;
    bett.setHours(uebliche ? uebliche.getHours() : 19, uebliche ? uebliche.getMinutes() : 0, 0, 0);
    const morgen = new Date(tag);
    morgen.setDate(morgen.getDate() + 1);
    morgen.setHours(bh, bm, 0, 0);
    void s;
    openSleepDialog(null, { start: bett, end: morgen, type: 'night' });
  },
  'add-sleep-on'(el) {
    // Nachtragen für einen vergangenen Tag: Vorschlag mittags an jenem Tag.
    const tag = startOfDay(new Date(el.dataset.date));
    const start = addMinutes(tag, 12 * 60);
    openSleepDialog(null, { start, end: addMinutes(start, 60), type: 'nap' });
  },
  onboard() {
    const birth = document.getElementById('ob-birth').value;
    if (!birth) return toast('Bitte Geburtsdatum angeben');
    store.update((s) => {
      s.child.name = document.getElementById('ob-name').value.trim();
      s.child.birthDate = birth;
      s.child.dueDate = document.getElementById('ob-due').value;
      s.settings.morningWake = document.getElementById('ob-morning').value || '07:00';
      s.settings.onboarded = true;
    });
    route = 'heute';
    render();
    // Direkt nach der Nutzergeste hat die Bitte um dauerhaften Speicher
    // die besten Chancen.
    ensurePersistentStorage(true).then(render);
  },
  'start-nap'() {
    store.startSleep('nap');
    render();
    toast('Nickerchen läuft');
  },
  'night-waking'() {
    const id = store.startNightWaking();
    render();
    if (id) toast('Nachts wach - die Nacht läuft weiter');
  },
  'back-to-sleep'() {
    store.endNightWaking();
    render();
    toast('Schläft wieder');
  },
  'start-night'() {
    store.startSleep('night');
    render();
    toast('Gute Nacht 🌙');
  },
  wake() {
    const stopped = store.stopSleep();
    render();
    if (!stopped) return toast('Zu kurz - nicht ins Protokoll aufgenommen');
    if (store.getState().settings.ratePrompt) openRatingDialog(stopped);
    else
      toast('Aufgewacht erfasst', {
        label: 'Rückgängig',
        run: () => actions.resume({ dataset: { id: stopped } })
      });
  },
  resume(el) {
    store.resumeSleep(el.dataset.id);
    if (dialog.open) dialog.close();
    render();
    toast('Schläft weiter');
  },
  rate(el) {
    const { id, field, value } = el.dataset;
    const entry = store.allSleeps().find((s) => s.id === id);
    // Nochmal dieselbe Antwort tippen hebt die Auswahl wieder auf.
    store.rateSleep(id, { [field]: entry && entry[field] === value ? null : value });
    const updated = store.allSleeps().find((s) => s.id === id);
    openRatingDialog(id);
    render();
    const complete =
      updated && updated.settle && updated.mood && (updated.type !== 'night' || updated.wakings != null);
    if (complete) {
      window.setTimeout(() => {
        if (dialog.open) dialog.close();
        toast('Danke - der Plan lernt mit');
      }, 350);
    }
  },
  'log-feed'(el) {
    const id = store.addEvent({ type: 'feed', kind: el.dataset.kind });
    render();
    openEventDialog(id);
  },
  'log-diaper'() {
    const id = store.addEvent({ type: 'diaper', kind: 'wet' });
    render();
    openEventDialog(id);
  },
  'edit-event'(el) {
    openEventDialog(el.dataset.id);
  },
  'event-set'(el) {
    const { id, field, value } = el.dataset;
    const event = store.allEvents().find((e) => e.id === id);
    const numeric = field === 'amountMl' || field === 'minutes';
    const parsed = numeric ? Number(value) : value;
    // Nochmal dasselbe tippen hebt die Auswahl auf - außer bei der Art.
    const next = field !== 'kind' && event && event[field] === parsed ? null : parsed;
    store.updateEvent(id, { [field]: next });
    openEventDialog(id);
    render();
  },
  'event-delete'(el) {
    store.deleteEvent(el.dataset.id);
    if (dialog.open) dialog.close();
    render();
    toast('Eintrag gelöscht');
  },
  'close-dialog'() {
    if (dialog.open) dialog.close();
  },
  'rate-sleep'(el) {
    openRatingDialog(el.dataset.id);
  },
  async 'quick-sound'(el) {
    if (audio.isPlaying()) {
      audio.stop();
    } else {
      const s = store.getState().settings;
      await audio.play(el.dataset.id, { timerMinutes: s.soundTimerMin || null });
    }
    render();
  },
  async sound(el) {
    const id = el.dataset.id;
    const s = store.getState().settings;
    if (audio.currentSoundId() === id && audio.isPlaying()) {
      audio.stop();
    } else {
      const hint = document.getElementById('sound-hint');
      if (hint) hint.textContent = 'Klang wird erzeugt …';
      await audio.play(id, { timerMinutes: s.soundTimerMin || null });
      store.update((st) => {
        st.settings.lastSound = id;
      });
    }
    render();
  },
  'stop-sound'() {
    audio.stop();
    render();
  },
  timer(el) {
    const min = Number(el.dataset.min);
    store.update((s) => {
      s.settings.soundTimerMin = min;
    });
    if (audio.isPlaying()) audio.setTimer(min || null);
    render();
  },
  toggle(el) {
    const key = el.dataset.key;
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    render();
  },
  'set-naps'(el) {
    const value = el.dataset.value;
    store.update((s) => {
      s.settings.napCount = value === 'auto' ? 'auto' : Number(value);
    });
    render();
    toast(value === 'auto' ? 'Anzahl wird automatisch bestimmt' : `Plan mit ${value} Nickerchen`);
  },
  'add-sleep'() {
    openSleepDialog(null);
  },
  'add-sleep-at'(el) {
    openSleepDialog(null, {
      start: new Date(el.dataset.start),
      end: new Date(el.dataset.end),
      type: el.dataset.type === 'night' ? 'night' : 'nap',
      // Der Rest der Nacht ist kein abgeschlossener Eintrag, sondern läuft.
      running: el.dataset.running === '1'
    });
  },
  'add-waking'(el) {
    const id = el.dataset.id;
    const sleep = store.allSleeps().find((s) => s.id === id);
    if (!sleep) return;
    // Vorschlag: eine Stunde nach dem Einschlafen, eine halbe Stunde lang.
    const start = addMinutes(sleep.start, 60);
    store.addInterruption(id, start, addMinutes(start, 30));
    openSleepDialog(id);
    render();
  },
  'delete-waking'(el) {
    store.deleteInterruption(el.dataset.id, Number(el.dataset.index));
    openSleepDialog(el.dataset.id);
    render();
  },
  'shift-waking'(el) {
    const { id, index, field, min } = el.dataset;
    const sleep = store.allSleeps().find((s) => s.id === id);
    const gap = sleep && sleep.interruptions ? sleep.interruptions[Number(index)] : null;
    if (!gap) return;
    const current = field === 'end' ? gap.end : gap.start;
    if (!current) return;
    const next = addMinutes(current, Number(min));
    if (next < sleep.start) return toast('Vor dem Einschlafen geht nicht');
    if (next > new Date()) return toast('In der Zukunft geht nicht');
    if (field === 'start' && gap.end && next >= gap.end) return toast('Muss vor dem Wiedereinschlafen liegen');
    if (field === 'end' && next <= gap.start) return toast('Muss nach dem Aufwachen liegen');
    store.updateInterruption(id, Number(index), { [field]: next });
    render();
  },
  'shift-start'(el) {
    const id = el.dataset.id;
    const entry = store.allSleeps().find((s) => s.id === id);
    if (!entry) return;
    const next = addMinutes(entry.start, Number(el.dataset.min));
    const now = new Date();
    if (next > addMinutes(now, -1)) return toast('Der Start kann nicht in der Zukunft liegen');
    if (minutesBetween(next, now) > 14 * 60) return toast('So lange schläft niemand am Stück');
    store.updateSleep(id, { start: next });
    render();
  },
  'shift-time'(el) {
    const field = dialog.querySelector(`#${el.dataset.field}`);
    if (!field) return;
    if (el.dataset.now) {
      field.value = localInput(new Date());
    } else {
      const current = new Date(field.value);
      if (Number.isNaN(current.getTime())) return;
      field.value = localInput(addMinutes(current, Number(el.dataset.min)));
    }
    updateDialogDuration();
    updateWakingDuration();
  },
  'edit-sleep'(el) {
    openSleepDialog(el.dataset.id);
  },
  'new-waking'(el) {
    openWakingDialog(el.dataset.id);
  },
  'drop-sleep'(el) {
    const id = el.dataset.id;
    const eintrag = store.allSleeps().find((x) => x.id === id);
    if (!eintrag) return;
    const kopie = { ...eintrag };
    store.deleteSleep(id);
    render();
    toast('Eintrag gelöscht', {
      label: 'Rückgängig',
      run: () => {
        store.addSleep({ start: kopie.start, end: kopie.end, type: kopie.type });
        render();
      }
    });
  },
  'ask-notify'() {
    if (!('Notification' in window)) return;
    Notification.requestPermission().then((antwort) => {
      render();
      toast(antwort === 'granted' ? 'Erinnerungen sind aktiv' : 'Ohne Erlaubnis keine Erinnerung');
    });
  },
  'edit-morning'(el) {
    openMorningDialog(el.dataset.date ? new Date(el.dataset.date) : new Date());
  },
  'shift-morning'(el) {
    const field = dialog.querySelector('#m-time');
    if (!field) return;
    const [h, m] = field.value.split(':').map(Number);
    if (Number.isNaN(h)) return;
    const next = addMinutes(new Date(2000, 0, 1, h, m), Number(el.dataset.min));
    field.value = hhmm(next);
  },
  'edit-waking'(el) {
    openWakingDialog(el.dataset.id, Number(el.dataset.index));
  },
  'save-child'() {
    const birth = document.getElementById('child-birth').value;
    if (!birth) return toast('Bitte Geburtsdatum angeben');
    store.update((s) => {
      s.child.name = document.getElementById('child-name').value.trim();
      s.child.birthDate = birth;
      s.child.dueDate = document.getElementById('child-due').value;
      s.settings.morningWake = document.getElementById('default-morning').value || '07:00';
    });
    toast('Gespeichert');
    render();
  },
  async install() {
    if (!installPrompt) return toast('Der Browser bietet die Installation gerade nicht an');
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    installPrompt = null;
    render();
    if (choice && choice.outcome !== 'accepted') toast('Installation abgebrochen');
  },
  async persist() {
    await ensurePersistentStorage(true);
    render();
    toast(
      storageState.persisted
        ? 'Daten werden dauerhaft gespeichert'
        : 'Der Browser hat abgelehnt - App installieren hilft'
    );
  },
  'add-note'() {
    const field = document.getElementById('note-text');
    if (!field || !store.addNote(field.value)) return toast('Bitte etwas eintippen');
    field.value = '';
    render();
    toast('Notiz gespeichert');
  },
  'delete-note'(el) {
    store.deleteNote(el.dataset.id);
    render();
  },
  export() {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `schlummer-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    store.markBackup();
    render();
  },
  async copy() {
    // Zweiter Weg für Umgebungen, in denen Downloads blockiert sind
    // (eingebettete Viewer) - und praktisch zum Verschicken der Sicherung.
    try {
      await navigator.clipboard.writeText(store.exportJSON());
      store.markBackup();
      render();
      toast('Daten in der Zwischenablage');
    } catch (err) {
      toast('Kopieren nicht erlaubt');
    }
  },
  import() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        store.importJSON(await file.text());
        toast('Daten importiert');
        render();
      } catch (err) {
        toast(err.message || 'Import fehlgeschlagen');
      }
    };
    input.click();
  },
  reset() {
    if (!window.confirm('Wirklich alle Kind- und Schlafdaten auf diesem Gerät löschen?')) return;
    store.resetAll();
    route = 'heute';
    render();
  }
};

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  event.preventDefault();
  audio.unlock();
  fn(el);
});

document.addEventListener('change', (event) => {
  const el = event.target;
  if (el.id === 'volume') {
    const value = Number(el.value) / 100;
    audio.setVolume(value);
    store.update((s) => {
      s.settings.soundVolume = value;
    });
    const out = el.closest('.card').querySelector('.card-head small');
    if (out) out.textContent = `${Math.round(value * 100)}%`;
  }
  if (el.id === 'morning') {
    const [h, m] = el.value.split(':').map(Number);
    if (Number.isNaN(h)) return;
    const now = new Date();
    const wake = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    const night = store
      .allSleeps()
      .filter((s) => s.type === 'night' && s.end && s.end.toDateString() === now.toDateString())
      .pop();
    if (night) store.updateSleep(night.id, { end: wake });
    else
      store.update((s) => {
        s.settings.morningWake = el.value;
      });
    render();
  }
  if (el.id === 'learning') {
    const on = el.checked;
    store.update((s) => {
      s.settings.learning = on;
    });
    toast(on ? 'Plan lernt wieder mit' : 'Nur noch Altersrichtwerte');
    render();
  }
  if (el.dataset && el.dataset.action === 'set-waking') {
    const value = el.value ? new Date(el.value) : null;
    if (el.dataset.field === 'end' && !value) {
      store.updateInterruption(el.dataset.id, Number(el.dataset.index), { end: null });
    } else if (value && !Number.isNaN(value.getTime())) {
      store.updateInterruption(el.dataset.id, Number(el.dataset.index), {
        [el.dataset.field]: value
      });
    }
    render();
    return;
  }
  if (el.id === 'event-ml' || el.id === 'event-at') {
    const id = dialog.querySelector('[data-action="event-delete"]');
    if (!id) return;
    if (el.id === 'event-ml') {
      const value = el.value === '' ? null : Number(el.value);
      store.updateEvent(id.dataset.id, { amountMl: Number.isNaN(value) ? null : value });
    } else {
      const at = new Date(el.value);
      if (!Number.isNaN(at.getTime())) store.updateEvent(id.dataset.id, { at });
    }
    render();
  }
  if (el.id === 'rate-prompt') {
    const on = el.checked;
    store.update((s) => {
      s.settings.ratePrompt = on;
    });
    toast(on ? 'Fragt nach dem Aufwachen' : 'Fragt nicht mehr nach');
  }
  if (el.id === 'reminders') {
    const on = el.checked;
    store.update((s) => {
      s.settings.reminders = on;
    });
    if (on && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(scheduleReminder);
    } else {
      scheduleReminder();
    }
  }
});

/**
 * Von oben nach unten ziehen öffnet die Tagesauswahl. Nur wenn die Seite
 * schon ganz oben steht - sonst würde jede Wischbewegung sie aufklappen.
 */
let pullStart = null;
document.addEventListener(
  'touchstart',
  (event) => {
    pullStart =
      window.scrollY <= 0 && event.touches.length === 1 ? event.touches[0].clientY : null;
  },
  { passive: true }
);
document.addEventListener(
  'touchmove',
  (event) => {
    if (pullStart === null || !store.hasChild() || route !== 'heute') return;
    const delta = event.touches[0].clientY - pullStart;
    if (delta > 60 && !stripOpen) {
      pullStart = null;
      stripOpen = true;
      render();
    } else if (delta < -50 && stripOpen) {
      pullStart = null;
      stripOpen = false;
      render();
    }
  },
  { passive: true }
);
document.addEventListener('touchend', () => {
  pullStart = null;
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'volume') audio.setVolume(Number(event.target.value) / 100);
  if (event.target.id === 'd-start' || event.target.id === 'd-end') updateDialogDuration();
  if (event.target.id === 'w-start' || event.target.id === 'w-end') updateWakingDuration();
});

// Antippbare Zeilen sollen auch per Tastatur bedienbar sein.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const el = event.target.closest && event.target.closest('.tappable[data-action]');
  if (!el) return;
  event.preventDefault();
  el.click();
});

/* -------------------------------------------------------- Installation */

/**
 * Android/Chrome meldet über beforeinstallprompt, dass die App installiert
 * werden kann. Das Ereignis lässt sich aufheben und später an einem eigenen
 * Knopf auslösen - auf iOS gibt es das nicht, dort bleibt nur die Anleitung.
 */
let installPrompt = null;

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true
  );
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  render();
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  render();
  toast('Schlummer ist installiert');
});

/** Karte "App installieren" - Text und Knopf je nach Gerät. */
function installCard() {
  if (isStandalone()) {
    return `<div class="card tight spread">
      <div>
        <div><strong>App ist installiert</strong></div>
        <small class="muted">Daten bleiben erhalten, Ton läuft im Hintergrund</small>
      </div>
      <span class="tag live">✓</span>
    </div>`;
  }
  if (installPrompt) {
    return `<div class="card">
      <div class="card-head"><h2>App installieren</h2><span class="tag">empfohlen</span></div>
      <p class="hint">
        Als installierte App startet Schlummer im Vollbild, läuft offline und der
        Browser räumt die Daten nicht weg. Für einen Test über mehrere Tage ist das
        der sichere Weg.
      </p>
      <button class="primary block" data-action="install">Auf dem Startbildschirm installieren</button>
    </div>`;
  }
  return `<div class="card">
    <div class="card-head"><h2>App installieren</h2><span class="tag">empfohlen</span></div>
    <p class="hint">
      ${
        isIOS()
          ? 'iPhone/iPad: unten auf „Teilen“ tippen, dann „Zum Home-Bildschirm“. Safari räumt den Speicher normaler Tabs nach etwa einer Woche ohne Nutzung auf - installierte Web-Apps sind ausgenommen.'
          : 'Android/Chrome: oben rechts auf die drei Punkte tippen, dann „App installieren“ bzw. „Zum Startbildschirm hinzufügen“. Erscheint der Eintrag nicht, lade die Seite einmal neu.'
      }
    </p>
  </div>`;
}

/* ---------------------------------------------------------- Speicherplatz */

let storageState = { persisted: null, checked: false };

/**
 * Bittet den Browser, die Daten dauerhaft zu behalten. Ohne das räumt
 * besonders iOS Safari den Speicher nicht installierter Seiten nach einer
 * Woche ohne Nutzung auf - mitten im Test wären die Daten weg.
 */
async function ensurePersistentStorage(ask = false) {
  if (!navigator.storage || !navigator.storage.persisted) return;
  try {
    let persisted = await navigator.storage.persisted();
    if (!persisted && ask && navigator.storage.persist) {
      persisted = await navigator.storage.persist();
    }
    storageState = { persisted, checked: true };
  } catch (err) {
    storageState = { persisted: null, checked: true };
  }
}

/* ------------------------------------------------------------ Erinnerung */

function scheduleReminder() {
  if (reminderTimer) window.clearTimeout(reminderTimer);
  reminderTimer = null;
  const s = store.getState();
  if (!s.settings.reminders || !store.hasChild()) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const ctx = context();
  if (ctx.status.sleeping || ctx.status.nightWaking || !ctx.nextSleep) return;
  // Dieselbe Zeit, die auch auf der Startseite steht - nicht das rohe
  // Wachfenster. Sonst erinnert die App an einen anderen Zeitpunkt als den,
  // den sie anzeigt.
  const ziel = ctx.nextSleep.start;
  const fireAt = addMinutes(ziel, -15);
  const delay = fireAt - Date.now();
  if (delay <= 0 || delay > 6 * 60 * 60 * 1000) return;
  reminderTimer = window.setTimeout(() => {
    const name = store.getState().child.name || 'Dein Kind';
    const nacht = ctx.nextSleep.type === 'night';
    new Notification('Schlummer', {
      body: nacht
        ? `In etwa 15 Minuten ist ${name}s Bettzeit (${fmtTime(ziel)}). Zeit zum Runterkommen.`
        : `In etwa 15 Minuten ist ${name} lange genug wach (${fmtTime(ziel)}). Zeit zum Runterkommen.`,
      icon: 'icons/icon-192.png',
      tag: 'schlummer-window'
    });
    scheduleReminder();
  }, delay);
}

/* --------------------------------------------------------------- Bootstrap */

store.subscribe(() => {
  scheduleReminder();
});

audio.onAudioChange(() => {
  renderNowPlaying();
});

store.load();
ensurePersistentStorage().then(render);
audio.setVolume(store.getState().settings.soundVolume);
render();
scheduleReminder();
window.setInterval(tickLight, 1000);
window.setInterval(() => {
  if (route === 'heute' || route === 'plan') render();
}, 60000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

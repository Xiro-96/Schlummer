/**
 * Audio-Engine.
 *
 * Ablauf: Rezept aus sounds.js -> OfflineAudioContext rendert einen kurzen
 * Loop -> nahtloser Crossfade -> WAV-Blob -> <audio loop>.
 *
 * Warum der Umweg über ein <audio>-Element und nicht direkt Web Audio?
 * Nur ein Media-Element läuft auf Handys zuverlässig weiter, wenn der
 * Bildschirm aus ist oder die App im Hintergrund liegt - und nur dafür
 * gibt es Sperrbildschirm-Steuerung (MediaSession).
 */
import { soundById } from './sounds.js';

const SAMPLE_RATE = 32000;
const LOOP_SECONDS = 30;
const CROSSFADE_SECONDS = 1.2;
const CACHE_LIMIT = 3;

const cache = new Map(); // id -> { url, channels, sampleRate }

const audio = new Audio();
audio.loop = true;
audio.preload = 'auto';
audio.setAttribute('playsinline', '');

let unlocked = false;
let currentId = null;
/**
 * Ausweichweg: Manche Hosts verbieten per Content-Security-Policy blob:-Medien.
 * Dann läuft der Ton über Web Audio weiter - ohne Sperrbildschirm-Steuerung,
 * aber immerhin hörbar.
 */
let fallback = null;
let baseVolume = 0.6;
let fadeTimer = null;
let stopTimer = null;
let timerEndsAt = null;
const listeners = new Set();

function emit() {
  listeners.forEach((fn) =>
    fn({
      soundId: currentId,
      playing: isPlaying(),
      volume: baseVolume,
      timerEndsAt
    })
  );
}

export function onAudioChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ------------------------------------------------------------- Rendering */

function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = frames * channels * 2;
  const out = new ArrayBuffer(44 + bytes);
  const view = new DataView(out);
  const str = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  str(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, bytes, true);

  const data = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([out], { type: 'audio/wav' });
}

/**
 * Legt den Anfang über das überschüssig gerenderte Ende (gleiche Leistung),
 * damit der Loop ohne Knacken durchläuft.
 */
function crossfadeLoop(rendered, loopFrames, fadeFrames) {
  const channels = rendered.numberOfChannels;
  const out = [];
  for (let c = 0; c < channels; c++) {
    const src = rendered.getChannelData(c);
    const dst = new Float32Array(loopFrames);
    dst.set(src.subarray(0, loopFrames));
    for (let i = 0; i < fadeFrames; i++) {
      const t = i / fadeFrames;
      const fadeIn = Math.sin((Math.PI / 2) * t);
      const fadeOut = Math.cos((Math.PI / 2) * t);
      dst[i] = src[i] * fadeIn + src[loopFrames + i] * fadeOut;
    }
    out.push(dst);
  }
  return out;
}

/**
 * Lautheits-Ausgleich: auf einen Ziel-Effektivwert (RMS) skalieren, damit
 * alle Klänge gleich laut wirken - eine reine Spitzenwert-Normalisierung
 * ließe impulsreiche Klänge wie die Spieluhr deutlich leiser erscheinen.
 * Der Spitzenwert wird zusätzlich begrenzt, damit nichts übersteuert.
 */
function normalize(channels, targetRms, maxPeak = 0.92) {
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      const abs = Math.abs(v);
      if (abs > peak) peak = abs;
      sum += v * v;
      count += 1;
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, count));
  if (rms === 0 || peak === 0) return;
  const factor = Math.min(targetRms / rms, maxPeak / peak);
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) data[i] *= factor;
  }
}

async function renderSound(id) {
  if (cache.has(id)) return cache.get(id);
  const sound = soundById(id);
  const loopFrames = LOOP_SECONDS * SAMPLE_RATE;
  const fadeFrames = Math.round(CROSSFADE_SECONDS * SAMPLE_RATE);
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Offline(2, loopFrames + fadeFrames, SAMPLE_RATE);
  sound.build(ctx, loopFrames + fadeFrames);
  const rendered = await ctx.startRendering();

  const channels = crossfadeLoop(rendered, loopFrames, fadeFrames);
  normalize(channels, sound.loudness ?? 0.16);

  const loopBuffer = {
    numberOfChannels: 2,
    length: loopFrames,
    sampleRate: SAMPLE_RATE,
    getChannelData: (c) => channels[c]
  };
  const entry = {
    url: URL.createObjectURL(encodeWav(loopBuffer)),
    channels,
    sampleRate: SAMPLE_RATE
  };

  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== currentId) {
      URL.revokeObjectURL(cache.get(oldest).url);
      cache.delete(oldest);
    }
  }
  cache.set(id, entry);
  return entry;
}

/** Lautstärke auf den gerade aktiven Ausgabeweg legen. */
function outputVolume(value) {
  audio.volume = value;
  if (fallback) fallback.gain.gain.value = value;
}

function stopFallback() {
  if (!fallback) return;
  try {
    fallback.source.stop();
  } catch (err) {
    /* schon gestoppt */
  }
  fallback.ctx.close();
  fallback = null;
}

/** Wiedergabe über Web Audio, wenn das <audio>-Element nicht darf. */
function startFallback(entry) {
  stopFallback();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return false;
  const ctx = new Ctx();
  const buffer = ctx.createBuffer(2, entry.channels[0].length, entry.sampleRate);
  for (let c = 0; c < 2; c++) buffer.copyToChannel(entry.channels[c], c);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = baseVolume;
  source.connect(gain).connect(ctx.destination);
  source.start(0);
  fallback = { ctx, source, gain };
  return true;
}

/* ------------------------------------------------------------ Wiedergabe */

/**
 * iOS/Android geben ein Media-Element erst nach einer echten Nutzergeste
 * frei. Da das Rendern danach passiert, entsperren wir das Element sofort
 * beim ersten Tippen mit einem winzigen stillen Puffer.
 */
export function unlock() {
  if (unlocked) return;
  unlocked = true;
  const silent =
    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';
  const prev = audio.src;
  audio.src = silent;
  audio.volume = 0;
  const p = audio.play();
  if (p && p.catch) p.catch(() => {});
  window.setTimeout(() => {
    audio.pause();
    audio.volume = baseVolume;
    if (prev) audio.src = prev;
  }, 60);
}

function clearTimers() {
  if (fadeTimer) window.clearInterval(fadeTimer);
  if (stopTimer) window.clearTimeout(stopTimer);
  fadeTimer = null;
  stopTimer = null;
  timerEndsAt = null;
}

function setupMediaSession(sound) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new window.MediaMetadata({
    title: sound.name,
    artist: 'Schlummer',
    album: 'Einschlafgeräusche',
    // Ohne Bild bleibt die Benachrichtigung auf dem Sperrbildschirm leer.
    artwork: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
    ]
  });
  navigator.mediaSession.setActionHandler('play', () => play(sound.id));
  navigator.mediaSession.setActionHandler('pause', () => stop());
  navigator.mediaSession.setActionHandler('stop', () => stop());
}

/** Spielt einen Sound; läuft bereits derselbe, passiert nichts. */
export async function play(id, { timerMinutes = null } = {}) {
  unlock();
  const sound = soundById(id);
  const entry = await renderSound(sound.id);
  stopFallback();
  if (currentId !== sound.id || audio.src !== entry.url) {
    audio.src = entry.url;
    audio.currentTime = 0;
  }
  audio.volume = baseVolume;
  currentId = sound.id;
  try {
    await audio.play();
  } catch (err) {
    console.warn('Media-Element blockiert, weiche auf Web Audio aus', err);
    startFallback(entry);
  }
  if (audio.error && !fallback) startFallback(entry);
  setupMediaSession(sound);
  setTimer(timerMinutes);
  emit();
  return sound.id;
}

export function stop() {
  audio.pause();
  stopFallback();
  clearTimers();
  // currentId bleibt erhalten, damit die Auswahl in der UI sichtbar ist.
  emit();
}

export function toggle(id, options) {
  if (currentId === id && isPlaying()) {
    stop();
    return Promise.resolve(id);
  }
  return play(id, options);
}

export function setVolume(value) {
  baseVolume = Math.max(0, Math.min(1, value));
  if (!fadeTimer) outputVolume(baseVolume);
  emit();
}

export function getVolume() {
  return baseVolume;
}

export function isPlaying() {
  return Boolean(currentId) && (!audio.paused || Boolean(fallback));
}

export function currentSoundId() {
  return currentId;
}

export function timerEnd() {
  return timerEndsAt;
}

/** Einschlaf-Timer: sanftes Ausblenden über die letzte Minute. */
export function setTimer(minutes) {
  clearTimers();
  if (!minutes) {
    outputVolume(baseVolume);
    emit();
    return;
  }
  const total = minutes * 60 * 1000;
  timerEndsAt = new Date(Date.now() + total);
  const fadeMs = Math.min(60000, total / 2);
  stopTimer = window.setTimeout(() => {
    const steps = 30;
    let step = 0;
    fadeTimer = window.setInterval(() => {
      step += 1;
      outputVolume(Math.max(0, baseVolume * (1 - step / steps)));
      if (step >= steps) {
        window.clearInterval(fadeTimer);
        fadeTimer = null;
        audio.pause();
        stopFallback();
        outputVolume(baseVolume);
        timerEndsAt = null;
        emit();
      }
    }, fadeMs / 30);
  }, total - fadeMs);
  emit();
}

audio.addEventListener('play', emit);
audio.addEventListener('pause', emit);
audio.addEventListener('error', () => {
  const entry = currentId ? cache.get(currentId) : null;
  if (entry && !fallback) {
    console.warn('Media-Element meldet Fehler, weiche auf Web Audio aus');
    startFallback(entry);
    emit();
  }
});

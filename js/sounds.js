/**
 * Klang-Rezepte.
 *
 * Alle Geräusche werden im Browser synthetisiert - es gibt keine
 * Audiodateien im Repo, also auch keine Lizenzfragen. Jedes Rezept füllt
 * einen Rohpuffer (Mathematik) und/oder hängt Web-Audio-Filter davor.
 */

/** Deterministischer Zufall, damit jeder Render identisch klingt. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function whiteFill(data, rand) {
  for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
}

function pinkFill(data, rand) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
}

function brownFill(data, rand) {
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const w = rand() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    data[i] = last * 3.5;
  }
}

const FILLERS = { white: whiteFill, pink: pinkFill, brown: brownFill };

/** Stereo-Rauschpuffer mit dekorrelierten Kanälen. */
function noiseBuffer(ctx, frames, kind, seed) {
  const buffer = ctx.createBuffer(2, frames, ctx.sampleRate);
  FILLERS[kind](buffer.getChannelData(0), mulberry32(seed));
  FILLERS[kind](buffer.getChannelData(1), mulberry32(seed + 7919));
  return buffer;
}

function source(ctx, buffer) {
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  node.start(0);
  return node;
}

function biquad(ctx, type, freq, q = 1, gain = 0) {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = freq;
  node.Q.value = q;
  node.gain.value = gain;
  return node;
}

function chain(nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

function gainNode(ctx, value) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** Amplituden-Modulation über einen LFO (Periode teilt die Loop-Länge). */
function modulate(ctx, target, { rate, depth, phase = 0 }) {
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rate;
  const amount = gainNode(ctx, depth);
  const delay = phase / rate;
  lfo.connect(amount).connect(target.gain);
  lfo.start(delay > 0 ? delay : 0);
  return lfo;
}

/** Puffer, der in JS Sample für Sample geschrieben wird. */
function synthBuffer(ctx, frames, writer) {
  const buffer = ctx.createBuffer(2, frames, ctx.sampleRate);
  writer(buffer.getChannelData(0), buffer.getChannelData(1), ctx.sampleRate);
  return buffer;
}

/** Herzschlag-Layer: "lub-dub" mit fester Schlagperiode. */
function heartbeatWriter(bpm, level) {
  return (left, right, sr) => {
    const period = 60 / bpm;
    const beats = Math.ceil(left.length / sr / period) + 1;
    const thump = (offset, amp, freq, decay) => {
      const start = Math.round(offset * sr);
      const len = Math.round(decay * 4 * sr);
      for (let i = 0; i < len; i++) {
        const idx = start + i;
        if (idx < 0 || idx >= left.length) continue;
        const t = i / sr;
        const env = Math.exp(-t / decay) * (1 - Math.exp(-t / 0.006));
        const v = Math.sin(2 * Math.PI * freq * t) * env * amp;
        left[idx] += v;
        right[idx] += v;
      }
    };
    for (let b = 0; b < beats; b++) {
      const t0 = b * period;
      thump(t0, level, 52, 0.075);
      thump(t0 + 0.26, level * 0.62, 44, 0.09);
    }
  };
}

/** Regentropfen als kurze, gefilterte Transienten. */
function dropletWriter(seed, density, level) {
  return (left, right, sr) => {
    const rand = mulberry32(seed);
    const seconds = left.length / sr;
    const count = Math.round(seconds * density);
    for (let d = 0; d < count; d++) {
      const at = Math.round(rand() * (left.length - 1));
      const freq = 900 + rand() * 4200;
      const decay = 0.004 + rand() * 0.02;
      const amp = level * (0.25 + rand() * 0.75);
      const pan = rand();
      const len = Math.round(decay * 5 * sr);
      for (let i = 0; i < len; i++) {
        const idx = at + i;
        if (idx >= left.length) break;
        const t = i / sr;
        const v = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t / decay) * amp;
        left[idx] += v * (1 - pan * 0.7);
        right[idx] += v * (1 - (1 - pan) * 0.7);
      }
    }
  };
}

/** Spieluhr: eigene, zufällig-pentatonische Melodie (deterministisch). */
function musicBoxWriter(seed) {
  return (left, right, sr) => {
    const rand = mulberry32(seed);
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66];
    const step = 0.75;
    const notes = Math.floor(left.length / sr / step);
    for (let n = 0; n < notes; n++) {
      const t0 = n * step + (rand() < 0.25 ? step / 2 : 0);
      const freq = scale[Math.floor(rand() * scale.length)];
      const amp = 0.16 + rand() * 0.1;
      const decay = 1.1;
      const start = Math.round(t0 * sr);
      const len = Math.round(decay * 3 * sr);
      const pan = 0.35 + rand() * 0.3;
      for (let i = 0; i < len; i++) {
        const idx = start + i;
        if (idx >= left.length) break;
        const t = i / sr;
        const env = Math.exp(-t / decay) * (1 - Math.exp(-t / 0.004));
        const v =
          (Math.sin(2 * Math.PI * freq * t) +
            0.35 * Math.sin(2 * Math.PI * freq * 2 * t) +
            0.12 * Math.sin(2 * Math.PI * freq * 3.01 * t)) *
          env *
          amp;
        left[idx] += v * pan;
        right[idx] += v * (1 - pan);
      }
    }
  };
}

/**
 * Die Sound-Bibliothek.
 * build(ctx, frames) baut den Graphen und verbindet ihn mit ctx.destination.
 * loudness: Ziel-Effektivwert (RMS) für den Lautheits-Ausgleich.
 */
export const SOUNDS = [
  {
    id: 'white',
    name: 'Weißes Rauschen',
    emoji: '🌫️',
    hint: 'Der Klassiker - deckt Alltagsgeräusche zuverlässig ab.',
    loudness: 0.16,
    build(ctx, frames) {
      const src = source(ctx, noiseBuffer(ctx, frames, 'white', 11));
      chain([src, biquad(ctx, 'lowpass', 9000, 0.7), gainNode(ctx, 0.5)]).connect(ctx.destination);
    }
  },
  {
    id: 'pink',
    name: 'Rosa Rauschen',
    emoji: '🌸',
    hint: 'Weicher und tiefer als weißes Rauschen, angenehm für lange Nächte.',
    loudness: 0.16,
    build(ctx, frames) {
      const src = source(ctx, noiseBuffer(ctx, frames, 'pink', 23));
      chain([src, biquad(ctx, 'lowpass', 6000, 0.7), gainNode(ctx, 1.6)]).connect(ctx.destination);
    }
  },
  {
    id: 'brown',
    name: 'Braunes Rauschen',
    emoji: '🟤',
    hint: 'Tiefes Grollen wie ferne Brandung - sehr beruhigend.',
    loudness: 0.17,
    build(ctx, frames) {
      const src = source(ctx, noiseBuffer(ctx, frames, 'brown', 31));
      chain([src, biquad(ctx, 'lowpass', 900, 0.6), gainNode(ctx, 2.2)]).connect(ctx.destination);
    }
  },
  {
    id: 'womb',
    name: 'Mutterleib',
    emoji: '🤰',
    hint: 'Gedämpftes Rauschen mit Herzschlag - vertraut für Neugeborene.',
    loudness: 0.16,
    build(ctx, frames) {
      const noise = source(ctx, noiseBuffer(ctx, frames, 'brown', 43));
      const noiseGain = gainNode(ctx, 2.4);
      const shaped = chain([noise, biquad(ctx, 'lowpass', 500, 0.8), noiseGain]);
      modulate(ctx, noiseGain, { rate: 0.2, depth: 0.7 });
      shaped.connect(ctx.destination);

      const heart = source(ctx, synthBuffer(ctx, frames, heartbeatWriter(72, 0.5)));
      chain([heart, biquad(ctx, 'lowpass', 160, 0.9), gainNode(ctx, 1.1)]).connect(ctx.destination);
    }
  },
  {
    id: 'heartbeat',
    name: 'Herzschlag',
    emoji: '💗',
    hint: 'Ruhiger Puls mit 72 Schlägen pro Minute.',
    loudness: 0.13,
    build(ctx, frames) {
      const heart = source(ctx, synthBuffer(ctx, frames, heartbeatWriter(72, 0.75)));
      chain([heart, biquad(ctx, 'lowpass', 220, 0.8), gainNode(ctx, 1.2)]).connect(ctx.destination);
      const bed = source(ctx, noiseBuffer(ctx, frames, 'brown', 57));
      chain([bed, biquad(ctx, 'lowpass', 320, 0.7), gainNode(ctx, 0.5)]).connect(ctx.destination);
    }
  },
  {
    id: 'rain',
    name: 'Regen',
    emoji: '🌧️',
    hint: 'Gleichmäßiger Landregen auf dem Dach.',
    loudness: 0.16,
    build(ctx, frames) {
      const bed = source(ctx, noiseBuffer(ctx, frames, 'pink', 67));
      chain([bed, biquad(ctx, 'bandpass', 700, 0.5), gainNode(ctx, 2.6)]).connect(ctx.destination);
      const low = source(ctx, noiseBuffer(ctx, frames, 'brown', 71));
      chain([low, biquad(ctx, 'lowpass', 320, 0.7), gainNode(ctx, 1.0)]).connect(ctx.destination);
      const drops = source(ctx, synthBuffer(ctx, frames, dropletWriter(89, 55, 0.32)));
      chain([drops, biquad(ctx, 'highpass', 600, 0.7), gainNode(ctx, 0.9)]).connect(ctx.destination);
    }
  },
  {
    id: 'ocean',
    name: 'Meeresrauschen',
    emoji: '🌊',
    hint: 'Wellen, die alle zehn Sekunden anrollen.',
    loudness: 0.15,
    build(ctx, frames) {
      const swellGain = gainNode(ctx, 1.4);
      const bed = source(ctx, noiseBuffer(ctx, frames, 'brown', 97));
      chain([bed, biquad(ctx, 'lowpass', 600, 0.8), swellGain]).connect(ctx.destination);
      modulate(ctx, swellGain, { rate: 0.1, depth: 1.0 });

      const spray = source(ctx, noiseBuffer(ctx, frames, 'white', 103));
      const sprayGain = gainNode(ctx, 0.12);
      chain([spray, biquad(ctx, 'bandpass', 2400, 0.6), sprayGain]).connect(ctx.destination);
      modulate(ctx, sprayGain, { rate: 0.1, depth: 0.11, phase: 0.15 });
    }
  },
  {
    id: 'shush',
    name: 'Schhh-Schhh',
    emoji: '🤫',
    hint: 'Rhythmisches Schhh wie beim Beruhigen auf dem Arm.',
    loudness: 0.14,
    build(ctx, frames) {
      const src = source(ctx, noiseBuffer(ctx, frames, 'white', 113));
      const pulse = gainNode(ctx, 0.5);
      chain([src, biquad(ctx, 'bandpass', 1500, 0.7), pulse]).connect(ctx.destination);
      modulate(ctx, pulse, { rate: 1, depth: 0.45 });
    }
  },
  {
    id: 'vacuum',
    name: 'Staubsauger',
    emoji: '🧹',
    hint: 'Kräftiges Motorgeräusch - hilft bei Bauchweh und Schreiphasen.',
    loudness: 0.16,
    build(ctx, frames) {
      const src = source(ctx, noiseBuffer(ctx, frames, 'pink', 127));
      chain([
        src,
        biquad(ctx, 'bandpass', 800, 0.4),
        biquad(ctx, 'peaking', 220, 1.2, 9),
        gainNode(ctx, 2.2)
      ]).connect(ctx.destination);
      for (const [freq, level] of [[110, 0.09], [220, 0.05], [330, 0.03]]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        chain([osc, biquad(ctx, 'lowpass', 700, 0.7), gainNode(ctx, level)]).connect(ctx.destination);
        osc.start(0);
      }
    }
  },
  {
    id: 'fan',
    name: 'Ventilator',
    emoji: '💨',
    hint: 'Gleichmäßiger Luftzug mit leisem Flügelrhythmus.',
    loudness: 0.16,
    build(ctx, frames) {
      const src = source(ctx, noiseBuffer(ctx, frames, 'pink', 131));
      const g = gainNode(ctx, 2.0);
      chain([src, biquad(ctx, 'lowpass', 1400, 0.7), g]).connect(ctx.destination);
      modulate(ctx, g, { rate: 22.5, depth: 0.2 });
      const hum = ctx.createOscillator();
      hum.frequency.value = 45;
      chain([hum, gainNode(ctx, 0.06)]).connect(ctx.destination);
      hum.start(0);
    }
  },
  {
    id: 'car',
    name: 'Autofahrt',
    emoji: '🚗',
    hint: 'Tiefes Rollen wie auf der Landstraße.',
    loudness: 0.17,
    build(ctx, frames) {
      const rumble = source(ctx, noiseBuffer(ctx, frames, 'brown', 149));
      const g = gainNode(ctx, 2.4);
      chain([rumble, biquad(ctx, 'lowpass', 260, 0.7), g]).connect(ctx.destination);
      modulate(ctx, g, { rate: 0.2, depth: 0.35 });
      const road = source(ctx, noiseBuffer(ctx, frames, 'pink', 151));
      chain([road, biquad(ctx, 'bandpass', 1100, 0.5), gainNode(ctx, 0.5)]).connect(ctx.destination);
    }
  },
  {
    id: 'musicbox',
    name: 'Spieluhr',
    emoji: '🎵',
    hint: 'Zarte Glockentöne über warmem Rauschen.',
    loudness: 0.12,
    build(ctx, frames) {
      const box = source(ctx, synthBuffer(ctx, frames, musicBoxWriter(181)));
      chain([box, biquad(ctx, 'lowpass', 5200, 0.7), gainNode(ctx, 1.0)]).connect(ctx.destination);
      const bed = source(ctx, noiseBuffer(ctx, frames, 'brown', 191));
      chain([bed, biquad(ctx, 'lowpass', 700, 0.7), gainNode(ctx, 0.5)]).connect(ctx.destination);
    }
  }
];

export function soundById(id) {
  return SOUNDS.find((s) => s.id === id) || SOUNDS[0];
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const JS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
const files = readdirSync(JS_DIR).filter((f) => f.endsWith('.js'));

test('Jeder Import zeigt auf eine vorhandene Datei', () => {
  for (const file of files) {
    const source = readFileSync(join(JS_DIR, file), 'utf8');
    for (const match of source.matchAll(/from\s+'\.\/([\w.]+)'/g)) {
      assert.ok(
        existsSync(join(JS_DIR, match[1])),
        `${file} importiert js/${match[1]}, das es nicht gibt`
      );
    }
  }
});

test('Kein Modul importiert sich selbst', () => {
  for (const file of files) {
    const source = readFileSync(join(JS_DIR, file), 'utf8');
    assert.ok(!source.includes(`from './${file}'`), `${file} importiert sich selbst`);
  }
});

test('Der Service Worker kennt alle Module', () => {
  const sw = readFileSync(join(JS_DIR, '..', 'sw.js'), 'utf8');
  for (const file of files) {
    assert.ok(sw.includes(`./js/${file}`), `sw.js fehlt js/${file} im Offline-Cache`);
  }
});

test('Keine echten Kinderdaten im Repo', () => {
  // Das Repo ist oeffentlich. Testvorlagen duerfen deshalb nur erfundene
  // Kinder enthalten - einmal ist hier versehentlich ein echtes Protokoll
  // gelandet, mit Name, Geburtsdatum und fuenf Wochen Schlafzeiten.
  const WURZEL = join(JS_DIR, '..');
  const erlaubt = new Set(['Testkind', '']);

  const suche = (verzeichnis) => {
    for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
      if (eintrag.name === 'node_modules' || eintrag.name.startsWith('.')) continue;
      const pfad = join(verzeichnis, eintrag.name);
      if (eintrag.isDirectory()) {
        suche(pfad);
        continue;
      }
      if (!eintrag.name.endsWith('.json') || eintrag.name === 'package-lock.json') continue;
      let daten;
      try {
        daten = JSON.parse(readFileSync(pfad, 'utf8'));
      } catch {
        continue;
      }
      if (!daten || !Array.isArray(daten.sleeps)) continue;
      const name = (daten.child && daten.child.name) || '';
      assert.ok(
        erlaubt.has(name),
        `${pfad} enthaelt ein Protokoll von "${name}" - Testvorlagen brauchen erfundene Kinder`
      );
    }
  };

  suche(WURZEL);
});

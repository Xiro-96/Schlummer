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

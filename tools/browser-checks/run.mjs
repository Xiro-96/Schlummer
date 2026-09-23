// Startet einen lokalen Server und laesst alle Browser-Pruefungen laufen.
// Ein Aufruf, ein Ergebnis - damit die Huerde niedrig bleibt.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const PORT = 8145;

const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: WURZEL,
  stdio: 'ignore'
});
const ende = () => server.kill();
process.on('exit', ende);
process.on('SIGINT', () => { ende(); process.exit(130); });

// Dem Server einen Moment geben, bevor der erste Abruf kommt.
await new Promise((fertig) => setTimeout(fertig, 800));

const skripte = readdirSync(HIER)
  .filter((f) => f.endsWith('.mjs') && f !== 'run.mjs')
  .sort();

let fehlgeschlagen = 0;
for (const skript of skripte) {
  const code = await new Promise((fertig) => {
    const kind = spawn(process.execPath, [join(HIER, skript)], {
      cwd: WURZEL,
      stdio: 'inherit',
      env: { ...process.env, SCHLUMMER_PORT: String(PORT) }
    });
    kind.on('close', fertig);
  });
  if (code !== 0) {
    fehlgeschlagen++;
    console.log(`\n!! ${skript} ist durchgefallen\n`);
  }
}

ende();
console.log(
  fehlgeschlagen
    ? `\n${fehlgeschlagen} von ${skripte.length} Pruefungen durchgefallen`
    : `\n${skripte.length} Pruefungen, alle gruen`
);
process.exit(fehlgeschlagen ? 1 : 0);

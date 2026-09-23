# Browser-Prüfungen

Die Unit-Tests in `test/` prüfen die Rechenlogik. Was sie nicht sehen: ob die
Oberfläche die Ergebnisse auch zeigt, ob Karten und Plan dieselbe Zeit nennen
und ob ein Knopf dort steht, wo man ihn sucht. Dafür sind diese Skripte da.

Sie laufen nicht in der CI (Chromium wäre dort erst zu installieren), sondern
von Hand:

```sh
python3 -m http.server 8145 &          # aus dem Projektverzeichnis
node tools/browser-checks/morgen.mjs
```

Jedes Skript endet mit „Alles wie erwartet" oder listet die Abweichungen und
beendet sich mit Code 1.

## Was hier drin liegt

| Skript | Prüft |
| --- | --- |
| `morgen.mjs` | Aufstehzeit ohne erfasste Nacht: gelebte Gewohnheit statt Einstellung, kranke Tage draußen, Hinweis nur wenn geschätzt |
| `haenger.mjs` | Eintrag ohne Ende wird erkannt und lässt sich in einem Tipp geradeziehen; Krank-Modus fragt nicht nach Schlafzeiten |

## Warum im Projekt und nicht daneben

Diese Prüfungen lagen eine Zeit lang in einem temporären Verzeichnis und waren
nach einem Neustart weg - mitsamt den Fällen, die sie festhalten sollten.
Deshalb gehören sie hierher.

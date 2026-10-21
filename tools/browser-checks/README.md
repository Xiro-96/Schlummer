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

`run.mjs` startet den Server selbst und lässt alle Skripte nacheinander laufen:

```sh
npm run check:browser
```

| Skript | Prüft |
| --- | --- |
| `morgen.mjs` | Aufstehzeit ohne erfasste Nacht: gelebte Gewohnheit statt Einstellung, kranke Tage draußen, Hinweis nur wenn geschätzt |
| `haenger.mjs` | Eintrag ohne Ende wird erkannt und lässt sich in einem Tipp geradeziehen; Krank-Modus fragt nicht nach Schlafzeiten |
| `budget.mjs` | Die übliche Nacht ist Nettoschlaf, nicht Zeit im Bett - sonst fällt die Weckempfehlung still aus |
| `aufstehzeit.mjs` | Aufstehzeit von Hand setzen schlägt die Schätzung und überlebt den Neustart |
| `tagziel.mjs` | Das Tagschlaf-Ziel aus den ruhigen Nächten steht in der Statistik und der Plan rechnet damit; Prognose im Bogen bleibt die gelernte Länge, nicht die Empfehlung |
| `kurzer-nap.mjs` | Nach einem Nickerchen von 24 Minuten wird ein zweites eingeplant, statt sieben Stunden Wachzeit bis zum Abend |
| `angebot.mjs` | Die Angebotsgrenze wird aus den eigenen Nächten geschätzt und der Plan bleibt darunter |
| `wunsch.mjs` | Der Wunschrhythmus zieht den Abend aus der verrutschten Gewohnheit zurück, ohne die gerechnete Bettzeit zu ersetzen; der Knopf im Bewertungs-Sheet schließt es auch |
| `experiment.mjs` | Experiment starten, laufender Hinweis auf der Startseite, Auswertung - und bei zu wenig Nächten sagt sie das, statt zu rechnen |
| `flasche.mjs` | Flasche und Windel je Wachphase als dreiwertiger Schalter (ja/nein/offen), Abendmenge in ml, und die Auswertung rechnet erst ab genug Nächten |

## Warum im Projekt und nicht daneben

Diese Prüfungen lagen eine Zeit lang in einem temporären Verzeichnis und waren
nach einem Neustart weg - mitsamt den Fällen, die sie festhalten sollten.
Deshalb gehören sie hierher.

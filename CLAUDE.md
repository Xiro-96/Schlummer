# Schlummer

Schlafplaner für Babys und Kleinkinder als installierbare Web-App (PWA).
Deutschsprachig, kostenlos, ohne Konto. Alle Daten bleiben im `localStorage`
des Geräts - es geht kein Byte an einen Server.

Die App wird täglich von einer Familie für ein bestimmtes Kind benutzt. Das
ist kein Nebensatz, sondern die wichtigste Eigenschaft des Projekts: Jede
Änderung landet am selben Abend bei einem echten Kind, und ein falscher Wert
im Bogen kostet jemanden Schlaf. Im Zweifel lieber „dafür reichen die Daten
nicht" anzeigen als eine Zahl erfinden.

## Grundregeln

- **Keine Abhängigkeiten zur Laufzeit, kein Build-Schritt.** Vanilla ES-Module,
  direkt vom Dateisystem ausgeliefert. Playwright ist die einzige
  Entwicklungsabhängigkeit und nur für die Browser-Prüfungen da.
- **Relative Pfade überall** (`./js/...`), damit die App unter jedem Unterpfad
  läuft (GitHub Pages hängt den Repo-Namen davor).
- **Offline muss funktionieren.** Jedes neue Modul gehört in die `ASSETS`-Liste
  in `sw.js`; ein Testlauf prüft das.
- **Deutsch, im ganzen Projekt:** Oberfläche, Kommentare, Commit-Nachrichten,
  Testnamen. Kommentare erklären das *Warum*, nicht das *Was* - am wertvollsten
  sind die, die festhalten, welcher Fehler zu einer Regel geführt hat.
- **Niemals echte Kinderdaten ins Repo.** Testdaten heißen „Testkind". Ein
  Testlauf (`Keine echten Kinderdaten im Repo`) scannt jede JSON-Datei auf
  Export-Form und schlägt an, wenn dort ein anderer Name steht. Das Repo ist
  öffentlich.

## Aufbau

```
index.html          Gerüst, lädt js/app.js als Modul
css/app.css         ein Stylesheet, Dark-Theme
sw.js               Service Worker: Netz zuerst für eigenen Code, Cache für Bilder/Klänge
js/
  app.js            Oberfläche, Navigation, Dialoge, Aktionen (~4700 Zeilen)
  store.js          Zustand + localStorage, einziger Ort mit Nebenwirkungen
  schedule.js       Zeit- und Planrechnung (rein)
  learning.js       Lernen aus den eigenen Daten (rein)
  experiment.js     Experimente und ihre Auswertung (rein)
  explain.js        Herleitung „wie kommt diese Uhrzeit zustande?" (rein)
  norms.js          Vergleich mit publizierten Normwerten (rein)
  data.js           Altersbänder und Normwerte, mit Quellenangabe je Zahl
  audio.js          Audio-Engine (OfflineAudioContext -> WAV-Blob -> <audio loop>)
  sounds.js         Klang-Rezepte, alles synthetisch erzeugt
test/               node --test, keine Testbibliothek
tools/browser-checks/  Playwright-Skripte gegen die echte Oberfläche
```

**Reine Module haben keinen DOM- und keinen Speicherzugriff.** Sie bekommen
`Date`-Objekte und Zahlen herein und geben Zahlen zurück. Nur so sind sie im
Test ohne Browser lauffähig, und nur deshalb sind sie überhaupt prüfbar.
`app.js` und `store.js` sind die einzigen Module, die das brechen dürfen.

### Datenfluss

`store.getState()` → `context(now)` in `app.js` → Views → HTML-String → `render()`

`context()` ist der zentrale Knoten: Es sammelt Alter, Altersband, gelerntes
Profil, Wunschrhythmus, Tagesform, Plan, Bilanz, Experiment und Status in ein
Objekt. Views lesen nur daraus. **`context()` ist nicht gemerkt** und wird pro
Render mehrfach aufgerufen - das ist bewusst einfach gehalten, aber teure neue
Rechnungen gehören deshalb nicht blind hinein.

### Datenformat (`localStorage`, Schlüssel `schlummer.state.v1`)

```js
{
  version: 1,
  child: { name, birthDate, dueDate },
  settings: { morningWake, wunschBett, wunschAuf, learning, napCount, ... },
  sleeps: [{ id, type: 'nap'|'night', start, end, note, settle, mood,
             wakings, unterwegs, interruptions: [{ start, end }] }],
  experiment: { id, name, tage, ziel, start, ende } | null,
  experimente: [...],
  sickDays: ['2026-09-16', ...],
  morningOverrides: { '2026-10-01': '05:50' }
}
```

Zeiten sind ISO-Strings im Speicher und `Date`-Objekte im Code; `store.js`
wandelt an der Grenze um. Alle Tagesschlüssel sind Ortszeit, nicht UTC.

Beim Erweitern des Formats: Feld in `DEFAULT_STATE` ergänzen, in `load()`
gegen fehlende/kaputte Werte absichern **und** in `importJSON()` übernehmen -
sonst geht es beim Import eines älteren Backups still verloren.

## Wie die App rechnet

Drei Schichten, in dieser Reihenfolge:

1. **Altersband** (`data.js`): publizierte Richtwerte für Wachfenster,
   Nickerchen und Nachtschlaf. Jede Zahl trägt ihre Quelle und ihre
   Belastbarkeit im Kommentar.
2. **Gelerntes Profil** (`learning.js`): aus den eigenen Einträgen geschätzte
   Werte, mit dem Altersband verrechnet (Shrinkage `w = n/(n+4)`), jüngere Tage
   stärker gewichtet (Halbwertszeit 7 Tage), getrennt nach Tagesform.
3. **Der Tag selbst** (`schedule.js`): `buildPlan()` legt aus Aufstehzeit,
   erfassten Schläfen, Wachfenstern und Schlafdruck die Zeiten fest.

Dazu Regeln, die aus den Daten *dieser* Familie stammen und nur erscheinen,
wenn sie belegt sind - sonst geben die Funktionen `null` zurück und die
Oberfläche zeigt nichts:

- `napWindowEffect` - ab welcher Wachzeit das Nickerchen lang wird
- `calmDayTarget` - wie viel Tagschlaf zu den durchgeschlafenen Nächten gehört
- `sleepOfferLimit` - wie viel Schlafgelegenheit (Zeit im Bett + Tagschlaf)
  in 24 h noch zu Schlaf wird statt zu Wachliegen
- `usualNightSleep`, `sleepNeed24h` - die eigenen Median- bzw. Perzentilwerte

**Der Wunschrhythmus** (`settings.wunschBett` / `wunschAuf`) steckt den Rahmen
ab: Er verschiebt das Abendfenster und ankert die Budget-Rechnung. Die Bettzeit
selbst wird trotzdem gerechnet - auf der Startseite soll stehen, wann dieses
Kind nach diesem Tag müde ist, nicht, wann es jemand gern hätte. Weichen beide
ab, steht beides da.

### Zwei Dinge nie verwechseln

- **Prognose vs. Empfehlung.** Der Bogen sagt „wach etwa 14:03" - das ist eine
  Vorhersage aus der gelernten Nickerchenlänge. Die Weckkarte sagt „bis 13:36
  ist Luft" - das ist eine Empfehlung aus dem Budget. Wer beide Zahlen aus
  derselben Quelle speist, baut genau den Fehler ein, der schon einmal drin war.
- **Netto-Schlaf vs. Zeit im Bett.** Nächtliche Wachphasen gehören abgezogen,
  wo von Schlaf die Rede ist. Einmal verwechselt, und die Weckempfehlung fällt
  still aus, weil für den Tag rechnerisch nichts übrig bleibt.

## Entwicklung

```sh
npm test                 # node --test, ~184 Tests, läuft auch in der CI
npm run check:browser    # Playwright gegen die echte Oberfläche (lokal)
npm start                # python3 -m http.server 8080
```

### Testlaufe

`test/` prüft die Rechenlogik ohne Browser. `test/modules.test.mjs` enthält
außerdem Wachhunde, die ganze Fehlerklassen abfangen: jeder Import zeigt auf
eine vorhandene Datei, kein Modul importiert sich selbst, der Service Worker
kennt alle Module, keine echten Kinderdaten im Repo, jeder Knopf hat einen
Handler.

`tools/browser-checks/` prüft, was die Unit-Tests nicht sehen: ob die
Oberfläche die Ergebnisse auch zeigt, ob Karte und Plan dieselbe Zeit nennen,
ob ein Knopf dort steht, wo man ihn sucht. Diese Skripte laufen **nicht** in
der CI (Chromium wäre dort erst zu installieren), sondern von Hand. Jeder
Fehler, der bis in die Oberfläche durchgeschlagen ist, hat hier einen Fall
bekommen - sie sind die Regressionssammlung des Projekts.

Fixtures für Browser-Prüfungen brauchen **explizite Zeitzonen-Offsets**
(`'2026-09-20T19:15:00+02:00'`). `new Date(y, m, d, h, min)` im Node-Prozess
ist UTC, im Browser Berlin - das verschiebt die Daten um zwei Stunden und
führt zu Prüfungen, die aus dem falschen Grund grün oder rot sind.

### Bei jeder sichtbaren Änderung

1. `APP_VERSION` in `js/app.js` erhöhen
2. `CACHE` in `sw.js` erhöhen (`schlummer-vNN`)
3. `npm test` und `npm run check:browser` grün
4. Committen und nach `main` pushen - der Workflow testet und veröffentlicht

Ohne Schritt 2 bekommen bestehende Installationen die Änderung nicht.

### Veröffentlichen

`.github/workflows/pages.yml`: Jeder Push nach `main` lässt erst `node --test`
laufen und veröffentlicht nur bei grünem Testlauf über GitHub Pages. Der
Deploy-Schritt kopiert ausschließlich die App-Dateien, nicht `test/` oder
`tools/`.

## Commit-Nachrichten

Deutsch, Betreffzeile als Aussagesatz über die Wirkung, nicht über den Code.
Im Rumpf steht, welches Verhalten falsch war und warum die neue Lösung richtig
ist - mit den Zahlen, die dahinterstehen. Das Projekt lebt davon, dass später
nachvollziehbar ist, welche Beobachtung zu welcher Regel geführt hat.

```
Nach einem zu kurzen Nickerchen noch eines einplanen

Heute war der Fall da: um 06:34 wach, von 10:22 bis 10:46 geschlafen - 24
Minuten nach einem Wachfenster von 3:48, also genau das, was die eigene
Schwelle vorhersagt. Die App plante daraufhin 7 Std 42 Min Wachzeit am
Stück und eine Bettzeit um 18:28. Das schafft kein Kind.
```

## Fallen, die schon zugeschnappt sind

- **Service Worker:** Der eigene Code wird *netzzuerst* geladen. Vorher war es
  umgekehrt, und neue Versionen kamen erst beim zweiten Start an - wer einmal
  nachschaut und nichts Neues sieht, schaut kein zweites Mal.
- **Tote Knöpfe:** `data-action="…"` ohne Eintrag in `actions` fällt nicht auf,
  der Klick läuft ins Leere. Dafür gibt es jetzt einen Testlauf.
- **Große Löschungen in `app.js`:** Nach jedem Massen-Edit die Liste der
  Top-Level-Funktionen gegen `HEAD` vergleichen. Eine zu gierige Löschregel hat
  hier schon eine ganze View mitgenommen.
- **Gleitende Fenster:** Kennzahlen aus 21 oder 28 Tagen springen von Tag zu
  Tag zwischen „Wert" und „kein Wert". Wo ein Wert stabil sein soll, 6-8 Wochen
  nehmen und die Stabilität über mehrere Stichtage nachrechnen.
- **Medianwerte als Warnschwelle:** Die Hälfte aller Tage liegt über dem
  Median. Eine Warnung, die daran hängt, erscheint an jedem zweiten Tag und
  wird zu Recht ignoriert.

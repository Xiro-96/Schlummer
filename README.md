# Schlummer

Kostenloser Schlafplaner mit Wachfenstern, Schlafprotokoll und synthetischen
Einschlafgeräuschen. Läuft als installierbare Web-App (PWA), offline nutzbar,
alle Daten bleiben auf dem Gerät.

## Veröffentlichen (einmalig)

1. Dieses Repository **öffentlich** anlegen und den Inhalt hochladen.
2. **Settings → Pages → Source: "GitHub Actions"** einstellen.
3. Fertig - ab jetzt veröffentlicht jeder Push nach `main` die App unter
   `https://<benutzername>.github.io/<repo>/`.

## Daten mitnehmen

Die Einträge liegen im Browserspeicher und gehören zur Adresse, unter der die
App läuft. Beim Umzug auf eine neue Adresse deshalb:

1. In der alten App: **Mehr → Daten sichern → Export** (JSON-Datei).
2. Neue Adresse öffnen, **Mehr → Daten → Import**, Datei auswählen.

## Entwicklung

```
node --test test/     # Rechenlogik
python3 -m http.server 8080
```

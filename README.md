# GrafikenOverlays

Webbasierte Livestream-Grafiken (Chroma-Key) für Kletterwettkämpfe, gespeist aus der [results.info](https://results.info) API. Ein Control-Panel steuert, welche Grafik gerade live auf einer separaten Output-Seite (für OBS o. ä. als Browser-Source) angezeigt wird.

## Funktionsumfang

- **Namen-Grafik** — Lower-Third mit zwei Athlet:innen per Startnummer
- **Ergebnisliste-Grafik** — Ranking-Tabelle mit Seitenblättern
- **Turnierbaum-Grafik** — Speed-K.-o.-Baum (seitliche Pyramide, Finale/Kleines Finale mittig)
- **Webseite-Grafik** — beliebige URL als Vollbild-Overlay einbetten (sofern die Zielseite Framing erlaubt)
- **Ecken-Einblendungen** — Bild/Video oben links/rechts, unabhängig live schaltbar, Größe einstellbar
- Chroma-Hintergrund frei wählbar, oder komplett transparent (echte Alpha-Transparenz für OBS)
- Alle Steuerungen synchronisieren sich live per WebSocket zwischen Control-Panel und Output-Seite

## Voraussetzungen

- [Node.js](https://nodejs.org) 18 oder neuer (für natives `fetch`)
- npm (kommt mit Node.js)

## Installation

```bash
npm install
```

## Starten

```bash
npm start
```

Danach im Terminal-Output zu finden (Standardport 3000, änderbar über die Umgebungsvariable `PORT`):

- **Control-Panel:** http://localhost:3000/control/
- **Output (für OBS):** http://localhost:3000/output/

## Nutzung

1. Control-Panel öffnen, Tenant wählen (`dav-stage` zum Testen, `dav`/`ifsc` für echte Wettkämpfe) und die Wettkampf-ID laden.
2. Pro Kachel (Namen, Ergebnisliste, Turnierbaum, Webseite) Kategorie/Runde bzw. URL wählen und in der Vorschau prüfen.
3. Mit dem jeweiligen "…Live"-Button die Grafik auf die Output-Seite schalten. Es ist immer nur eine Hauptgrafik gleichzeitig live; "Alles Aus" schaltet zurück auf reines Chroma-Grün.
4. Ecken-Einblendungen (Logos/Sponsoren) separat hochladen und mit dem "Live"-Button pro Ecke unabhängig einblenden.
5. In OBS (oder vergleichbarer Software) eine **Browser-Source** auf die Output-URL setzen, Auflösung 1920×1080, und einen Chroma-Key-Filter auf die gewählte Hintergrundfarbe legen (oder die Transparenz-Option im Control-Panel aktivieren, dann ist kein Chroma-Key nötig).

## Projektstruktur

```
server.js                  Express-Server, results.info-Proxy, WebSocket-Sync, Upload-Endpunkte
public/
  control/                 Control-Panel (Bedienoberfläche)
  output/                  Output-Seite (Browser-Source für OBS)
  shared/                  Gemeinsame Render-Logik und Styles für Vorschau + Output
  uploads/                 Laufzeit-Uploads der Ecken-Einblendungen (nicht Teil des Repos)
RESULTS_INFO_API.md        Dokumentation der genutzten results.info API
```

## results.info API

Details zu Authentifizierung, Endpunkten und den Eigenheiten der API stehen in [RESULTS_INFO_API.md](RESULTS_INFO_API.md).

## Auf GitHub hochladen

Falls das Projekt noch kein Git-Repository ist:

```bash
cd "/Users/jannikweiser/Desktop/GrafikenOverlays"
git init
git add .
git commit -m "Initial commit"
```

Dann auf [github.com](https://github.com/new) ein neues, leeres Repository anlegen (ohne README/`.gitignore`, die hat dieses Projekt schon) und den angezeigten Anweisungen für ein "existierendes Repository" folgen — im Kern:

```bash
git remote add origin https://github.com/<dein-benutzername>/<repo-name>.git
git branch -M main
git push -u origin main
```

Falls die GitHub-CLI (`gh`) installiert ist, geht es auch ohne den Umweg über die Website:

```bash
gh repo create <repo-name> --private --source=. --remote=origin --push
```

**Wichtig:** `public/uploads/` ist bewusst in `.gitignore` — dort liegen deine hochgeladenen Ecken-Logos/-Videos, die nicht ins Repository gehören (Größe, Persönliches). Der Ordner selbst bleibt über `.gitkeep` erhalten, seine Inhalte werden nie mitgeschickt.

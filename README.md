# Hexagon Universalis

Hexagon Universalis ist eine rein clientseitige Webanwendung für eine interaktive, aus Hexagon- und Pentagonzellen aufgebaute Weltkugel. Die aktuelle Projektgrundlage stellt Vite, TypeScript, Three.js und die Qualitätswerkzeuge für die folgenden Fach-Issues bereit.

## Voraussetzungen

- Node.js 20.19.0 (siehe `.nvmrc`)
- npm 10 oder neuer
- ein Browser mit WebGL-Unterstützung

## Installation

```bash
npm ci
```

## Entwicklung

```bash
npm run dev
```

Vite zeigt anschließend die lokale URL an. Die Startseite rendert eine rotierende Three.js-Testgeometrie und reagiert auf Größenänderungen des Browserfensters.

### Tile-Showcase-Welt (Demo-Modus)

Standardmäßig lädt die Anwendung die echte Erdkugel. Über den Query-Parameter
`?world=demo` (z. B. `http://localhost:5173/?world=demo`) lässt sich
stattdessen eine separate Showcase-Welt laden, die jeden Tile-Typ aus dem
visuellen Katalog (`src/data/tileCatalog.ts`) auf einer eigenen,
geodätischen Testkugel mit 42 Zellen (Frequenzstufe 2) zeigt. Jeder Tile-Typ
erhält dabei `floor(42 / 24)` oder `ceil(42 / 24)` Zellen. Die Demo verwendet
keine realen Geographie-, Höhen-, Fluss- oder Politikdaten und ist im
Statusbereich eindeutig mit „Tile-Demo – keine reale Erde" gekennzeichnet.
Der reale Erdmodus bleibt davon unverändert.

### Prozedurale Multi-LOD-Testwelt

`?world=procedural` öffnet eine eindeutig als künstlich gekennzeichnete, deterministische
Testwelt. Sie verwendet denselben Seed und dieselben Generatorparameter in den benannten Stufen
Global, Regional und Lokal. Beim Zoomen bleiben ferne Regionen global, während sichtbare
Regional- und Lokalzellen als lückenlose, feinere Overlays materialisiert werden. Dichteprofile,
Zellzahlen, die deutlich erweiterte Nahzoomgrenze, Hystereseschwellen und Budgets sind in
[docs/procedural-world-lod.md](./docs/procedural-world-lod.md) dokumentiert. Das bestehende
`?world=lod` bleibt als reine Geometrie-Diagnose verfügbar.

Das rechte Testwelt-Panel wendet Seed und eines der Profile `low`, `standard` oder `high` erst über
**Welt neu generieren** an. Aktive Zellzahl, Frequenz, Welt-LOD und Fingerprint bleiben dort
sichtbar; erfolgreiche Konfigurationen werden für reproduzierbare Reloads in die URL geschrieben.
Seedformat, Profilwerte, Statusmodell und responsives Verhalten beschreibt
[docs/procedural-world-controls.md](./docs/procedural-world-controls.md).

## Produktionsbuild

```bash
npm run build
npm run preview
```

Der Build erzeugt ausschließlich statische Dateien im Verzeichnis `dist/`. Das Projekt besitzt weder Serverimplementierung noch Backend-Laufzeitabhängigkeit.

## Erd-Datenpyramide

Die versionierten, gzip-komprimierten Multi-LOD-Artefakte werden offline
erzeugt und geprüft:

```bash
npm run data:build
npm run data:verify
```

Format, Quellenbezug, Reproduzierbarkeit, Budgets und Debugkarten sind in
[docs/earth-tile-pyramid.md](./docs/earth-tile-pyramid.md) dokumentiert. Die
Anwendung verarbeitet keine GIS-Rohdaten im Browser.

## Tests und Qualitätsprüfungen

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run test:e2e
npm run build
```

Die Playwright-E2E-Tests starten den Produktionsserver und prüfen Canvas,
Status, responsive Layout sowie grundlegende Pointer-/Wheel-Interaktion. Für
den ersten lokalen Lauf ist einmalig `npx playwright install chromium`
erforderlich.

Für die lokale Entwicklung stehen zusätzlich `npm run format` und der Vitest-Watchmodus über `npm test` bereit.

## GitHub Pages

Die produktive Seite ist unter der Projekt-URL
`https://kevni92.github.io/hexagon-universalis/` erreichbar. Vite verwendet im
Produktionsbuild automatisch den Unterpfad `/hexagon-universalis/`; lokale
Entwicklung bleibt unter `/` erreichbar. Gebündelte Assets aus `src/` werden
von Vite korrekt referenziert. Dateien aus `public/` müssen über
`import.meta.env.BASE_URL` oder einen relativen Pfad eingebunden werden und
dürfen keinen hart codierten Pfad wie `/assets/...` verwenden.

Der Workflow `.github/workflows/deploy-pages.yml` startet bei jedem Push auf
`main` sowie manuell über `workflow_dispatch`. Pull Requests lösen kein
produktives Deployment aus. Formatprüfung, Linting, Typecheck, Tests und
Produktionsbuild müssen erfolgreich sein, bevor das Pages-Artefakt veröffentlicht
wird. Bei einem fehlgeschlagenen Check oder Deployment bleibt die zuletzt
erfolgreich veröffentlichte Version bestehen.

Vor dem ersten Deployment muss unter _Settings → Pages_ als Quelle **GitHub
Actions** ausgewählt werden. Ein fehlgeschlagenes Deployment lässt sich nach der
Fehlerkorrektur über den Workflow-Button **Run workflow** erneut ausführen. Nur
`main` wird produktiv veröffentlicht.

## Projektstruktur

- `src/app/` – Start, Lebenszyklus und Zusammensetzung
- `src/rendering/` – Three.js-spezifische Darstellung
- `src/world/` – Weltmodell und spätere Topologie
- `src/input/` – Maus-, Pointer- und Touch-Eingaben
- `src/ui/` – DOM-basierte Benutzeroberfläche
- `src/shared/` – allgemeine Hilfsfunktionen und Typen
- `tests/` – automatisierte Tests
- `e2e/` – Playwright-Tests gegen den Produktionsbuild
- `docs/` – Architektur, Datenpipeline und bekannte Auflösungsgrenzen

## Mitarbeit

Branch-Namensschema, Pull-Request-Anforderungen, lokale Prüfungen vor dem Push und empfohlene Branch-Protection-Regeln für `main` sind in [CONTRIBUTING.md](./CONTRIBUTING.md) dokumentiert.

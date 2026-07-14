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

## Produktionsbuild

```bash
npm run build
npm run preview
```

Der Build erzeugt ausschließlich statische Dateien im Verzeichnis `dist/`. Das Projekt besitzt weder Serverimplementierung noch Backend-Laufzeitabhängigkeit.

## Tests und Qualitätsprüfungen

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run build
```

Für die lokale Entwicklung stehen zusätzlich `npm run format` und der Vitest-Watchmodus über `npm test` bereit.

## Projektstruktur

- `src/app/` – Start, Lebenszyklus und Zusammensetzung
- `src/rendering/` – Three.js-spezifische Darstellung
- `src/world/` – Weltmodell und spätere Topologie
- `src/input/` – Maus-, Pointer- und Touch-Eingaben
- `src/ui/` – DOM-basierte Benutzeroberfläche
- `src/shared/` – allgemeine Hilfsfunktionen und Typen
- `tests/` – automatisierte Tests

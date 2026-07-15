# Architektur und Datenpipeline

Die Anwendung trennt geodätische Topologie, offline aufbereitete Erd- und
Quelldaten, Rendering, Eingabe und DOM-View-Modelle. Die Topologie aus
`src/topology/` ist Three.js-unabhängig; `src/rendering/` übersetzt sie in
gebündelte Buffer-Geometrie. Erdwerte bleiben in Metern und werden erst in der
Darstellung über die monotone Reliefkurve visuell überhöht.

`data/sources.json` fixiert Datensatzversion, Lizenz, Attribution, Projektion,
Verarbeitung und SHA-256-Prüfsummen. Die Manifestprüfung akzeptiert keine
fehlenden Prüfsummen. Rohdaten werden offline verarbeitet und nicht zur
Laufzeit von GIS-Diensten geladen. Die Standardtopologie ist Frequenz 2
(42 Zellen); niedrige Profile können Frequenz 1 verwenden.

Landbedeckung wird über die dokumentierte WorldCover-Tabelle klassifiziert.
Höhen- und Tiefenwerte werden mit Samples aggregiert, Wasser-/Küstenstatus aus
Landanteil und Nachbarschaft abgeleitet. Flüsse werden als validierte,
vereinfachte WGS84-Linien vorbereitet. Alle Schritte sind deterministisch und
verwenden keine Seeds oder Zufallswerte.

Für den lokalen Nachweis:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npx playwright install chromium
npm run test:e2e
npm run build
```

Die räumliche Auflösung begrenzt die Darstellung schmaler Küsten, Inseln und
Flüsse. Das ist eine dokumentierte Aggregationsgrenze, keine alternative oder
zufällige Geographie.

Architekturentscheidungen mit dauerhafter Tragweite werden als ADRs unter
`docs/architecture/` festgehalten, beginnend mit
[0001-hierarchical-geodesic-lod.md](./architecture/0001-hierarchical-geodesic-lod.md)
zur mehrstufigen geodätischen Auflösungsarchitektur.

Die verbindliche Zielarchitektur für die siebenstufige prozedurale Welt-LOD
mit sichtbereichsgechunkten Budgets steht in
[0002-seven-level-world-lod.md](./architecture/0002-seven-level-world-lod.md).

Die Offline-Erzeugung, das komprimierte Chunkformat, Integritäts- und
Größenprüfungen sowie die Debugkarten der realen Referenzregionen beschreibt
[earth-tile-pyramid.md](./earth-tile-pyramid.md). Laufzeit-Laden und Rendering
dieser Chunks bleiben bewusst Aufgabe von #60.

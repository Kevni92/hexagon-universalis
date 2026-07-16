# Spielbarer Breitengradbereich der Nahansicht

Issue #109 begrenzt nur die spielnahe Flat-Nahansicht. Die Weltgeometrie, die
Polarkappen und die globale Kugeldarstellung bleiben vollständig erhalten.

## Zentrale Regel

`PlayableLatitudeController` in `src/topology/lod/playableLatitude.ts` ist
render-unabhängig und liefert eine symmetrische Standardgrenze von `78°` Nord
und Süd. Ein Eintrittspuffer von `1°` verhindert, dass die Projektion an der
Grenze zwischen Globe und Flat flackert. Der Wert kann über
`ProceduralRendererOptions.playableLatitude` geändert werden.

Die Regel normalisiert den Fokusvektor, behandelt beide Pole symmetrisch und
liefert für spätere Gameplay- oder Baubarkeitsprüfungen dieselbe Zustandslogik.

## Kamera und LOD

Der `WorldLodProjectionController` erhält die Entscheidung, ob Flat erlaubt
ist. Außerhalb des Bereichs bleibt die Kamera im Globe-Modus; Herauszoomen ist
weiter möglich. Sobald Flat aktiv ist, klemmt `GlobeControls` den tatsächlichen
Kamera-Breitengrad auf die konfigurierte Grenze. Das Clamping setzt auch die
vertikale Trägheit zurück, damit Dragging, Inertia, Touch und Mausrad keinen
weiteren Grenzübertritt erzeugen.

Canvas-Diagnoseattribute dokumentieren den Zustand:

- `data-playable-latitude`
- `data-playable-latitude-limit`
- `data-playable-latitude-status`
- `data-projection-reason="latitude-limit"` beim Verlassen von Flat an der Grenze

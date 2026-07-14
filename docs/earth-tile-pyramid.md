# Mehrstufige Erd-Tile-Datenpyramide

Issue #59 ergänzt die Offline-Datenpipeline um ein deterministisches,
browsergeeignetes Austauschformat für die drei Auflösungsstufen aus ADR 0001. Die Produktionsanwendung liest ausschließlich das kleine
`manifest.json` und bei Bedarf einzelne `json.gz`-Chunks. GeoTIFF-, NetCDF-,
Shape-, GeoPackage- und ZIP-Rohdaten werden nie in `public/` übernommen.

## Reproduzierbare Erzeugung

```bash
npm run data:build
npm run data:verify
```

Die Referenzeingabe liegt in `data/pyramid/reference-input.json`. Sie ist ein
kleiner, eingecheckter Abnahmekorpus mit quellenabgeleiteten Werten für
Himalaya/Mount Everest, Alpen, Sahara, Amazonas, Antarktis, Grönland, eine
Küste und einen Ozeanpunkt an der Datumsgrenze. Eine vollständige lokale
Aufbereitung der in `data/sources.json` beschriebenen Rohdaten exportiert
dasselbe normalisierte Eingabeformat; die großen lizenzierten Rohdateien
bleiben außerhalb des Repositorys.

Der Generator sortiert Objektschlüssel, Zellen, Samples und Chunks
deterministisch, normalisiert Längengrade und schreibt gzip mit festem Header.
Gleiche Eingabe erzeugt deshalb bytegleiche Dateien und identische
SHA-256-Prüfsummen. Vor einem produktiven Quellenwechsel muss
`tilePyramid.inputSha256` in `data/sources.json` mit
`Get-FileHash data/pyramid/reference-input.json -Algorithm SHA256` (Windows)
oder `sha256sum data/pyramid/reference-input.json` aktualisiert werden.

## Format

`public/data/earth/v1/manifest.json` enthält:

- Format- und Datensatzversion,
- Fingerprints der Topologie- und Quellenkonfiguration,
- die verfügbaren Level `global`, `regional` und `local`,
- pro Chunk Pfad, gzip-Kodierung, Zellzahl, Bytegröße und SHA-256,
- pro Level einen Größenbericht.

Die globale Ebene wird als ein Bootstrap-Chunk ausgeliefert. Regionale und
lokale Dateinamen enthalten die vollständige Eltern-Zell-ID. Damit bleiben
die statischen Artefakte auch dann eindeutig, wenn lokale Elternindizes in
verschiedenen Patches gleich sind. Die Laufzeit-ID-Korrektur aus #67 bleibt
ein eigenes Issue.

Jede Zelle enthält Mittelwert, Minimum, Maximum, P10 und P90 der Höhe bzw.
Tiefe, Landanteil, dominante Terrainklasse, alle relevanten Terrainanteile,
Flussklassen, einen politischen Grenzhinweis und explizite Qualitätsflags.
Fehlende Quellenwerte werden nicht still ersetzt, sondern als
`missing-*` markiert. Vollständige Zellen tragen ausschließlich `complete`.

## Integrität und Budgets

`npm run data:verify` prüft Index/Chunk-Übereinstimmung, SHA-256,
komprimierte Größen, maximal 2.000 HTTP-Chunks, ein Gesamtbudget von 8 MB
und verbotene Rohdatenendungen. Die automatisierten Tests prüfen zusätzlich:

- bytegleiche Wiederholungsläufe,
- eindeutige, hierarchiequalifizierte Chunk- und Zellreferenzen,
- gültige Wertebereiche und Qualitätsflags,
- Eltern-/Kindkonsistenz innerhalb dokumentierter Toleranzen,
- Referenzregionen auf allen drei Stufen,
- Küstenmischungen, Pole und Datumsgrenze.

## Manuelle Debug-Abnahme

Der Build erzeugt unter `public/data/earth/v1/debug/` je eine SVG-Karte für
`global`, `regional` und `local`. Die Punkte sind nach Terrainklasse gefärbt;
der Tooltip zeigt Zell-ID, Klasse und Höhe. Die Karten dienen dem schnellen
Vergleich der Referenzregionen und sind keine Laufzeitkarte.

Die aktuelle Referenzpyramide umfasst 17 komprimierte Chunks und liegt weit
unter dem 8-MB-Budget. Die exakten, reproduzierbar erzeugten Werte stehen in
`public/data/earth/v1/sizes.json`.

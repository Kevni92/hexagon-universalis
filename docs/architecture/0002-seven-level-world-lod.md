# ADR 0002: Siebenstufige, sichtbereichsgechunkte Welt-LOD-Architektur

- Status: Angenommen
- Datum: 2026-07-15
- Betrifft: `src/topology/lod/`, `src/world/`, `src/rendering/`, Picking und #103
- Ersetzt: die dreistufige Zielskizze aus ADR 0001 für die prozedurale Welt

## Kontext

Die bisherige prozedurale Laufzeit kennt drei vollständige Topologien. Das
höchste bestehende Profil endet bei `f32` mit `10.242` Zellen. Eine direkte
Fortsetzung bis `f144` würde `207.362` Zellen sowie Millionen nicht
indexierter Deck- und Seitendreiecke dauerhaft erzeugen. Das verletzt die
Browserbudgets, obwohl bei einem Nahzoom nur ein kleiner Ausschnitt der Kugel
relevant ist.

Die Architektur muss deshalb Auflösung und Darstellung trennen:

- Das Weltmodell bleibt sphärisch, deterministisch und projektionsneutral.
- Pro Frame wird innerhalb des sichtbaren Viewports genau eine Weltauflösung
  ausgewählt. Sichtbare Mischungen aus groben und feinen Zellgrößen sind nicht
  zulässig.
- Hohe Auflösungen werden über fachliche Chunks adressiert. Nur sichtbare,
  fokurnahe und pixelrelevante Chunks dürfen materialisiert werden.
- Die Renderprojektion ist eine nachgelagerte Eigenschaft. Global und mittlere
  Stufen bleiben kugelförmig; #103 kann für `local` und `detail` zusätzlich eine
  lokale Tangentialebene aktivieren.

Die bestehende Drei-Stufen-Runtime bleibt bis #97 unverändert. Diese ADR und
die typisierten Werte in `sevenLevelArchitecture.ts` legen den Zielvertrag fest;
eine beiläufige Komplettmigration wäre außerhalb des Umfangs von #96.

## Entscheidung

### Sieben semantische Stufen

Die verbindliche Zielsequenz ist:

| Tiefe | Name          | Frequenz | vollständige Zellzahl | Projektion      |
| ----: | ------------- | -------: | --------------------: | --------------- |
|     0 | Global        |        8 |                   642 | Globe           |
|     1 | Kontinental   |       13 |                 1.692 | Globe           |
|     2 | Makroregional |       21 |                 4.412 | Globe           |
|     3 | Regional      |       34 |                11.562 | Globe           |
|     4 | Subregional   |       55 |                30.252 | Globe           |
|     5 | Lokal         |       89 |                79.212 | Globe oder Flat |
|     6 | Detail        |      144 |               207.362 | Globe oder Flat |

Die Zellzahl folgt für jede vollständige geodätische Topologie der Formel
`10 × f² + 2`. Die Frequenzen sind Fibonacci-artig gewählt: Der
Auflösungssprung liegt ungefähr bei einem Faktor `1,6` statt bei einer
Verdopplung. Damit werden Maßstabssprünge kleiner, während `f144` nahe am
Zielbudget von 200.000 adressierbaren Zellen liegt.

Die Namen und Tiefen sind in `WORLD_LOD_LEVELS` eindeutig typisiert. IDs der
Zielarchitektur verwenden das Format `lvl<depth>-<name>`, zum Beispiel
`lvl6-detail`. Die bestehende Drei-Stufen-ID bleibt bis zur Runtime-Migration
in #97 rückwärtskompatibel.

### Gechunkte Materialisierung

Level 0 bleibt als geschlossene, vollständig residente Kugel erhalten. Ab
`continental` werden fachliche Chunks verwendet. Ein Chunk besitzt eine
stabile Level-ID, einen stabilen Chunk-Schlüssel und optional den Schlüssel
seines fachlichen Elternbereichs:

```ts
interface WorldLodChunkAddress {
  level: WorldLodLevelId;
  chunkKey: string;
  parentKey: string | null;
}
```

Die Schnittstelle enthält keine Three.js-Projektionsobjekte. Ein Chunk darf
für Globe- und Flat-Rendering wiederverwendet werden. Seine sphärischen
Zentren, Nachbarschaften, Weltwerte und IDs sind die fachliche Quelle; flache
Positionen sind ausschließlich abgeleitete Renderdaten.

Ein Chunk zielt auf höchstens 512 aktive Zellen. Die Grenze ist ein
Budgetparameter, keine fachliche Zellgrenze: Ein Parentbereich darf an
Pentagonen, Datumsgrenzen oder Sichtbarkeitsgrenzen kleinere Chunks erzeugen.
Unvollständige Rand-Chunks werden nicht mit künstlichen Zellen aufgefüllt.

### Auswahl und Übergang

Die Auswahl wird in drei unabhängigen Schritten implementiert:

1. Aus Kamera, Fokus, Sichtkegel und Horizont werden relevante fachliche
   Parentbereiche bestimmt.
2. Pixelgröße, Hysterese und das plattformabhängige Chunkbudget wählen genau
   eine Welt-LOD-Stufe für den sichtbaren Viewport.
3. Der Renderer erhält die gewählten Chunkadressen und wendet erst danach
   `globe` oder `flat` an.

Die Auswahl ist deterministisch und priorisiert den Kamerafokus. Eine kleine
Vorladezone darf Chunks bereits erzeugen, zählt aber gegen das Cachebudget und
wird nicht sichtbar gerendert. Beim Wechsel hält der Renderer alte Geometrie
höchstens für die dokumentierte Übergangsdauer resident; sichtbare Flächen
werden nicht gleichzeitig mit unterschiedlichen Zellgrößen über denselben
Viewport gelegt. #97 definiert die konkrete Hysterese und die geschlossene
Übergangsgeometrie.

Rückseite, Horizontferne und pixelirrelevante Bereiche werden vor der
Topologiematerialisierung verworfen. Ein einzelner `f144`-Vollaufbau ist kein
zulässiger Fallback. Bei Budgetüberschreitung bleibt die zuletzt gültige
Stufe sichtbar und neue Chunks werden in begrenzten Arbeitsscheiben nachgeladen.

### Projektionsneutraler Vertrag zu #103

Die fachliche Auswahl liefert eine `WorldLodLevelId` und eine Liste von
`WorldLodChunkAddress`-Werten. Sie kennt weder `globe` noch `flat`. #103 darf
darauf eine separate Projektion anwenden:

- `global` bis `subregional` sind globe-only.
- `local` und `detail` sind globe-or-flat-fähig.
- Der Projektionswechsel ist eine Rendererentscheidung mit eigener
  Hysterese, Rezentrierung und Pickingabbildung.
- Ein Fokuswechsel verändert die Projektion und Chunkmaterialisierung, nicht
  die fachliche Zell-ID oder die Generatorwerte.

Damit kann #103 eine lokale Ost-Nord-Hoch-Basis verwenden, ohne die
LOD-Auswahl, Weltfingerprints oder Nachbarschaften umzuschreiben.

## Budgets

Die folgenden Werte sind verbindliche Architekturobergrenzen für die erste
Implementierung. Sie gelten für den sichtbaren aktiven Zustand; die
vollständige Zellzahl einer Stufe ist nur eine Adressierungsgröße.

### Aktive Chunks und Zellen

| Stufe         | Desktop: Chunks | Desktop: Zellen | Mobile: Chunks | Mobile: Zellen |
| ------------- | --------------: | --------------: | -------------: | -------------: |
| Global        |               1 |             642 |              1 |            642 |
| Kontinental   |               8 |           1.692 |              4 |          1.692 |
| Makroregional |              12 |           4.412 |              6 |          3.072 |
| Regional      |              16 |           8.192 |              8 |          4.096 |
| Subregional   |              24 |          12.288 |             10 |          5.120 |
| Lokal         |              32 |          16.384 |             12 |          6.144 |
| Detail        |              32 |          16.384 |             12 |          6.144 |

Die Zellzahl je gechunkter Stufe ist `min(vollständige Zellzahl,
maxChunks × 512)`. Dadurch werden kleine frühe Stufen nicht künstlich
beschnitten, während `f144` nie mit mehr als 16.384 Desktop- beziehungsweise
6.144 Mobile-Zellen gleichzeitig materialisiert wird.

### GPU-, CPU- und Arbeitsbudgets

| Budget               | Desktop |  Mobile | Herleitung                                 |
| -------------------- | ------: | ------: | ------------------------------------------ |
| aktive Zellen gesamt |  16.384 |   6.144 | feinste aktive Stufe                       |
| aktive Chunks gesamt |      32 |      12 | höchste Stufenlimits                       |
| sichtbare Dreiecke   | 294.912 | 110.592 | 18 Reliefdreiecke/Zelle                    |
| GPU-Buffer           |  48 MiB |  16 MiB | 36 Byte/Vertex plus 20 % Reserve           |
| CPU-Arbeitssatz      |  96 MiB |  48 MiB | aktive Chunks, IDs, Nachbarschaften, Cache |
| Chunkcache           |      64 |      24 | nur fachliche Chunkdaten, LRU              |
| Generierungsscheibe  |    4 ms |    2 ms | maximale Arbeit pro Frame                  |
| Einzelchunk-Aufbau   |   40 ms |   60 ms | asynchrones Budget, kein Pflichtframe      |
| maximale Draw Calls  |      33 |      13 | Chunks plus ein gemeinsames Substrat       |
| maximale Materialien |      33 |      13 | kein Material pro Zelle                    |

Die GPU-Schätzung verwendet die aktuelle nicht indexierte Bufferpipeline:
Position, Normale und Vertexfarbe benötigen `3 × 4 × 3 = 36` Byte je Vertex.
Ein Relief-Polygon benötigt eine Deckfläche und zwei Seiten-Dreiecke je
Kante. Eine Volltopologie besitzt `60 × f²` Kanten und damit im Worst Case
`180 × f²` Dreiecke. Für `f144` ergeben sich dadurch:

```text
Kanten:                   60 × 144²       = 1.244.160
Reliefdreiecke:           3 × Kanten      = 3.732.480
Nichtindexierte Vertices:                 = 11.197.440
Roher GPU-Buffer:         Vertices × 36 B = 403.107.840 B ≈ 384,4 MiB
```

Der letzte Wert erklärt, warum `f144` niemals als vollständige permanente
Reliefgeometrie erzeugt werden darf. Die reproduzierbare Berechnung ist mit

```bash
npm run lod:budget
```

ausführbar. Die Ausgabe und die Formeln sind zusätzlich in
`tests/seven-level-architecture.test.ts` abgesichert. Die GPU- und CPU-Werte
sind harte Zielbudgets; #98 misst reale Browserwerte und darf sie nur mit
begründeter ADR-/Issue-Änderung anheben.

## Alternativen

### A: Vollständige Topologie jeder Stufe mit aggressivem Culling

Jede Frequenz wird als vollständige Kugel erzeugt, anschließend werden nur
sichtbare Zellen gerendert. Das ist konzeptionell einfach, scheitert aber bei
`f144` bereits vor dem Culling an den oben berechneten CPU-/GPU-Kosten.
Verworfen.

### B: Binäre oder reine Potenzfolge

Eine Folge wie `8, 16, 32, 64, 96, 128, 144` vereinfacht manche
Unterteilungsheuristiken, erzeugt aber frühe große Pixel- und Geometriesprünge
und besitzt keine durchgängige Parentstruktur. Als interne Chunkgröße bleibt
eine Zweierpotenz sinnvoll; als Welt-LOD-Folge wird sie verworfen.

### C: Gewählte Fibonacci-artige Folge mit sichtbereichsgechunkter Auswahl

`8, 13, 21, 34, 55, 89, 144` verteilt die Maßstabssprünge gleichmäßiger und
erreicht das Zielbudget. Die Parentbeziehung wird deterministisch über
fachliche Raumzuordnung und stabile Chunkadressen hergestellt, nicht über die
Annahme einer exakten ganzzahligen Frequenzteilung. Gewählt.

### D: Gemischte Zellgrößen im Viewport

Grobe Eltern bleiben außerhalb eines Fokus-Chunks sichtbar, während feine
Kinder hineingeschnitten werden. Das spart kurzfristig Materialisierung,
erzeugt aber sichtbare Auflösungsgrenzen und kompliziert Picking, Relief und
Flat-Rezentrierung. Verworfen; Übergangsgeometrie darf nur temporär und
geschlossen verwendet werden.

## Konsequenzen

Positiv:

- `f144` ist adressierbar, ohne eine 200.000-Zellen-Vollgeometrie zu halten.
- Welt-LOD-Auswahl und Globe-/Flat-Projektion besitzen getrennte Verträge.
- Sieben Levels, IDs, Zellzahlen und Plattformbudgets sind maschinenprüfbar.
- #97 kann die Runtime schrittweise implementieren; #103 kann auf denselben
  Chunk- und Fokusdaten aufbauen.
- Der bestehende Drei-Stufen-Stand bleibt bis zur Migration rückwärtskompatibel.

Zu tragende Risiken:

- Unabhängige geodätische Patches haben an Parentgrenzen keine automatisch
  exakte Voronoi-Unterteilung; #97 muss Kanten, Nachbarschaften und Chunks
  deterministisch absichern.
- Die CPU-Arbeitssatzschätzung ist konservativ und muss in #98 mit realen
  Browserprofilen verifiziert werden.
- Kleine Chunks verbessern Culling und Nachladen, erhöhen aber Verwaltung und
  potenzielle Draw Calls; die Budgets begrenzen diesen Trade-off.
- Eine Flat-Projektion kann die Welt nicht fachlich verändern und muss bei
  Rezentrierung alle aktiven Renderchunks neu ableiten.

## Folge-Issues und Abgrenzung

- **#97:** siebenstufige sichtbereichsgechunkte Auswahl, Hysterese und Runtime.
- **#98:** Benchmark und Absicherung des `f144`-Adressierungs-/Chunkprofils.
- **#103:** Globe-/Flat-Projektion, Rezentrierung und Projektionshysterese.
- **#108:** konkrete Flat-Nahbereichsdarstellung.

Nicht enthalten sind die vollständige siebenstufige Runtime, Flat-Geometrie,
Generatoränderungen, Reliefänderungen, Worker-/WASM-Migration und neue Biome.

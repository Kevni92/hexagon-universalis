# ADR 0001: Hierarchische Multi-LOD-Architektur für die geodätische Erdtopologie

- Status: Angenommen
- Bezug: #57 (Teil von #1, baut auf #7 und #8 auf, berücksichtigt Performanceanforderungen aus #18)
- Betrifft: `src/topology/`, zukünftige `src/world/`-Schicht, `src/rendering/`, Offline-Datenpipeline, Picking

## Kontext

`src/topology/geodesic.ts` erzeugt heute genau eine geodätische Kugel pro
Aufruf von `createGeodesicTopology(frequency)`. Ausgehend von einem
Ikosaeder wird jede der 20 Dreiecksflächen `frequency`-mal unterteilt; die
entstehenden Dreiecksmittelpunkte bilden die Voronoi-Zentren der Hex-/Pentagon-
Zellen. Die Zellzahl folgt der geschlossenen Formel

```
Zellen(f) = 10 * f² + 2
```

mit **immer genau 12 Pentagonen** (den ursprünglichen Ikosaeder-Ecken) und
`10 * (f² - 1)` Hexagonen. `SceneRenderer` instanziiert die Standardfrequenz 2
(42 Zellen, `docs/architecture.md`) und rendert die vollständige Zellmenge in
einem einzigen `BufferGeometry`/`Mesh` (`createCellGlobeMesh` in
`src/rendering/CellGlobe.ts`).

Reproduzierbare Referenzwerte (siehe `scripts/geodesic-cell-counts.mjs` und
`tests/geodesic-cell-counts-script.test.ts`):

| frequency | Zellen | Hexagone | Pentagone |
| --------- | -----: | -------: | --------: |
| 1         |     12 |        0 |        12 |
| 2         |     42 |       30 |        12 |
| 4         |    162 |      150 |        12 |
| 8         |    642 |      630 |        12 |
| 16        |  2 562 |    2 550 |        12 |
| 32        | 10 242 |   10 230 |        12 |

### Grenzen der heutigen Implementierung

1. **Keine Zwischenstufen.** Es gibt nur eine Auflösung zur Zeit; ein Wechsel
   bedeutet, `createGeodesicTopology` komplett neu aufzurufen und den
   gesamten Mesh zu ersetzen.
2. **Lineares Wachstum in `f²`, aber global uniform.** Um erkennbare Länder,
   Alpen, Sahara oder Himalaya darzustellen, wäre eine Frequenz im Bereich
   von `f = 64…128` (40 962 bzw. 163 842 Zellen) nötig – uniform über die
   _gesamte_ Kugel, obwohl beim Zoomen auf eine Region der Rest der Erde
   nicht in dieser Auflösung sichtbar ist.
3. **`MAX_FREQUENCY = 32` deckelt die Einzeltopologie bei 10 242 Zellen.**
   Das reicht nicht für lokale Detailtiefe (Siedlungen, Flussverläufe).
4. **Alles-oder-nichts-Rendering.** `createCellGlobeMesh` baut für _jede_
   Zelle der übergebenen Topologie Dreiecke; es gibt keinen Mechanismus, nur
   einen Ausschnitt zu materialisieren.
5. **Keine stabile Zelladressierung über Auflösungen hinweg.** `cellId(index)`
   ist nur innerhalb einer einzelnen Topologie-Instanz eindeutig
   (`cell-0000`); zwei Topologien unterschiedlicher Frequenz haben keine
   Beziehung zwischen ihren IDs, wodurch Picking, gespeicherte Auswahl und
   Geodaten-Zuordnung bei einem Auflösungswechsel unmöglich stabil bleiben.
6. **Keine räumliche Chunk-Struktur.** Für statisch ausgelieferte
   Browserartefakte (GitHub Pages, siehe `docs/architecture.md`) fehlt ein
   Schlüssel, um nur die für einen Kamera-Ausschnitt relevanten Daten zu
   laden.

Diese Grenzen sind der eigentliche Anlass für #57: Eine bloße
Frequenzerhöhung skaliert nicht, weil sie _global_ auflöst statt _dort, wo
die Kamera hinschaut_.

## Entscheidung

Wir führen eine **dreistufige hierarchische Auflösungsarchitektur** mit
expliziter Eltern-Kind-Zuordnung und räumlichem Chunking ein:

- **Level 0 – `global`**: eine einzelne, immer vollständig resident gehaltene
  geodätische Topologie niedriger Frequenz für die gesamte Kugel.
- **Level 1 – `regional`**: pro Level-0-Zelle wird bei Bedarf ein eigenes,
  höher aufgelöstes geodätisches Patch erzeugt ("Kind-Topologie"). Jede
  Level-1-Zelle kennt genau eine Level-0-Elternzelle.
- **Level 2 – `local`**: pro Level-1-Zelle wird analog ein noch feineres
  Patch erzeugt. Jede Level-2-Zelle kennt genau eine Level-1-Elternzelle
  (und transitiv eine Level-0-Großelternzelle).

Jede Ebene wird weiterhin mit dem bestehenden, unveränderten
`createGeodesicTopology`-Algorithmus erzeugt – **nicht** durch rekursive
Unterteilung einzelner Voronoi-Zellen. Das garantiert die bestehende,
getestete Eigenschaft "genau 12 Pentagone pro vollständiger Kugelstufe" ohne
neue Geometrie-Sonderfälle: Level 0 hat 12 Pentagone (die eigentlichen
topologischen Pole des Ikosaeders); jedes einzelne Level-1- oder
Level-2-Patch ist selbst eine vollständige Mini-Kugel-Topologie mit ihren
eigenen 12 Pentagonen, von denen im Regelfall nur der für die Elternzelle
relevante Ausschnitt materialisiert und gerendert wird (siehe
"Umgang mit Kind-Pentagonen" unten).

Die Zuordnung Kind→Eltern erfolgt nicht über exakt verschachtelte
Voronoi-Polygone (geometrisch nicht exakt möglich, siehe
"Alternativen"), sondern über eine **nächste-Zentren-Zuordnung**: Jede
Level-(n+1)-Zelle wird anhand ihres normalisierten 3D-Zentrums der
Level-n-Zelle zugeordnet, deren Zentrum den geringsten Großkreisabstand hat
(`acos(dot(childCenter, parentCenter))`). Das ist deterministisch,
funktioniert unabhängig von Datumsgrenze und Polregionen (reine
3D-Vektor-Operation, keine Lat/Lon-Sonderfälle) und ist die gleiche
Grundoperation, die die bestehende `angleAround`/`normalize`-Vektor-Bibliothek
in `geodesic.ts` bereits verwendet.

Zell-, Level- und Chunk-Identitäten sind deterministisch, kollisionsfrei und
string-serialisierbar (siehe Abschnitt "Identitätsschema"). Eine minimale,
isolierte Grundlage ist in `src/topology/lod/identifiers.ts` implementiert
und mit `tests/lod-identifiers.test.ts` abgedeckt; sie ist bewusst **nicht**
in `SceneRenderer` oder `CellGlobe` verdrahtet.

### Umgang mit Kind-Pentagonen

Wird eine Level-n-Zelle in ein Level-(n+1)-Patch aufgelöst, entsteht dabei
eine vollständige Kugel-Topologie mit 12 Pentagonen an fixen, aus der
Ikosaeder-Ausgangslage bekannten Indizes. Nur die Zellen, deren Zentrum in
den Zuständigkeitsbereich der Elternzelle fällt (nächste-Zentren-Zuordnung,
s. o.), werden tatsächlich materialisiert und gerendert; alle anderen Zellen
des Kind-Patches – einschließlich der meisten seiner 12 Pentagone – werden
verworfen. Das ist zulässig, weil die Garantie "genau 12 Pentagone pro
vollständiger Kugelstufe" sich auf eine **vollständig materialisierte** Stufe
bezieht (Level 0 in der Praxis; ein Level-1- oder Level-2-Patch wird nur bei
einer expliziten Vollständigkeits-Prüfung – etwa in Tests – komplett erzeugt).
Dieser Umgang wird in `tests/lod-identifiers.test.ts` und einer künftigen
Implementierung explizit dokumentiert und getestet, nicht stillschweigend
vorausgesetzt.

## Alternativen betrachtet

### Alternative A: Rekursive Zellunterteilung mit exakter geometrischer Verschachtelung

Jede Voronoi-Zelle wird direkt in kleinere Voronoi-Zellen zerlegt, sodass die
Kind-Polygone exakt innerhalb des Eltern-Polygons liegen (ähnlich einem
Quadtree/H3-artigen Schema).

**Vorteile:** Exakte geometrische Verschachtelung, keine Grenzüberlappung
zwischen Kindern verschiedener Eltern.

**Nachteile:** Auf einer Kugel aus Hexagonen/Pentagonen ist eine _exakt_
flächentreue rekursive Unterteilung ohne neue Verzerrung nicht ohne
erheblichen Zusatzaufwand möglich (bekanntes Problem geodätischer/H3-artiger
Gitter: Kind-Zentren fallen nicht exakt mit einer neu erzeugten,
eigenständigen Geodäsie zusammen). Das hätte einen komplett neuen,
nicht wiederverwendbaren Unterteilungsalgorithmus erfordert und wäre auf den
12 Pentagon-Positionen besonders fehleranfällig (Pentagon-Kinder verzerren
zwangsläufig stärker als Hexagon-Kinder). Deutlich höheres Implementierungs-
und Testrisiko für dieses Architektur-Issue.

### Alternative B (gewählt): Unabhängig regenerierte Geodäsie pro Level + nächste-Zentren-Elternzuordnung + räumliches Chunking

Wie oben in "Entscheidung" beschrieben: jede Ebene ist eine vollständige,
unabhängige Anwendung des bestehenden, getesteten
`createGeodesicTopology`-Algorithmus; Eltern-Kind-Beziehungen werden separat
über nächste-Zentren-Zuordnung berechnet, nicht durch die Unterteilung selbst
erzwungen.

**Vorteile:** Nutzt den bestehenden, bereits getesteten und batterie-
geprüften Algorithmus unverändert weiter (kein neues Geometrie-Risiko,
Pentagon-Garantie bleibt pro Stufe strukturell identisch zum Status quo).
Elternzuordnung ist eine einfache, gut testbare 3D-Vektoroperation ohne
Lat/Lon-Sonderfälle an Datumsgrenze/Polen. Jede Stufe ist unabhängig
generier- und cachebar (gut für statische Offline-Artefakte).

**Nachteile:** Kind-Polygone liegen _approximativ_, nicht exakt, innerhalb
der Elternzelle; an Elterngrenzen kann es zu Zellen kommen, deren Zentrum
knapp auf der einen Seite, deren Rand aber leicht in die Nachbarregion
hineinreicht. Das ist für dieses Architektur-Issue ausdrücklich
akzeptiert und im Migrationsplan als bekannte, zu testende Grenzfallklasse
dokumentiert (siehe "Konsequenzen").

### Alternative C (verworfen): Nur Frequenzerhöhung ohne Hierarchie

Einfach `MAX_FREQUENCY` erhöhen und bei Bedarf mit sehr hoher Frequenz neu
generieren.

**Nachteile:** Skaliert nicht – erzwingt globale Uniformität in
Rechenzeit, Speicher und Draw-Calls, obwohl nur ein kleiner Kamera-Ausschnitt
sichtbar ist. Widerspricht direkt den Performance-Leitplanken aus #18
("keine unnötige Zellanzahl", begrenzte Draw Calls, begrenztes Ladebudget).
Verworfen als alleinige Lösung, bleibt aber als Erzeugungsmechanismus
_innerhalb_ jeder einzelnen Ebene bestehen.

## Auflösungsstufen: Zellzahlen, Speicher- und Geometriebudgets

Alle Werte sind Richtwerte auf Basis der Formel `Zellen(f) = 10*f² + 2` und
der bestehenden Geometrie-Erzeugung (`createCellGlobeGeometryData`: 3
Vertices pro Boundary-Kante, also `≈ 6 * cells` Dreiecks-Vertices für ein
überwiegend hexagonales Gitter; jeder Vertex belegt Position + Normal + Farbe
= 9 Float32 = 36 Byte, siehe `CellGlobe.ts`).

| Ebene        | Rolle                                    | Frequenz je Patch | Zellen je Patch | Aktiv gehaltene Patches (typisch) | Zellen gesamt (typisch) | Geometrie-Vertices (≈) | Geometrie-Speicher (≈) |
| ------------ | ---------------------------------------- | ----------------: | --------------: | --------------------------------: | ----------------------: | ---------------------: | ---------------------: |
| 0 `global`   | Kontinente/Ozeane, immer resident        |                 8 |             642 |                                 1 |                     642 |                ≈ 3 800 |               ≈ 140 KB |
| 1 `regional` | Gebirge/Biome je Level-0-Elternzelle     |                 8 |             642 |                  ≤ 12 (Sichtfeld) |                 ≤ 7 700 |               ≤ 46 000 |               ≤ 1,7 MB |
| 2 `local`    | Siedlungen/Flüsse je Level-1-Elternzelle |                 4 |             162 |                  ≤ 40 (Sichtfeld) |                 ≤ 6 500 |               ≤ 39 000 |               ≤ 1,4 MB |

Begründung der Werte:

- **Level 0 (f = 8, 642 Zellen):** grob genug, um dauerhaft komplett resident
  zu sein (vgl. heutige Standardfrequenz 2 mit 42 Zellen als unterste
  Stufe für sehr niedrige Profile), aber fein genug, um Kontinent-/Ozean-
  Umrisse sowie grobe Klimazonen zu tragen. Bleibt weit innerhalb des
  bestehenden `MAX_FREQUENCY = 32`.
- **Level 1 (f = 8 je Patch, ≤ 12 gleichzeitig sichtbare Eltern):** ein
  typischer Kamera-Ausschnitt bei Regional-Zoom deckt laut Akzeptanzkriterium
  "regionale Zoomsequenz" realistisch wenige benachbarte Level-0-Zellen ab
  (ein Hexagon plus direkte Nachbarn). 12 aktive Patches × 642 Zellen ist ein
  konservatives oberes Limit, keine feste Vorgabe.
- **Level 2 (f = 4 je Patch, ≤ 40 gleichzeitig sichtbare Eltern):** lokaler
  Zoom auf Siedlungs-/Flussebene deckt mehr, aber kleinere Level-1-Zellen ab;
  niedrigere Patch-Frequenz reicht, weil auf dieser Stufe zusätzlich echte
  Geodaten (Relief, Flüsse, politische Layer) die visuelle Detailtiefe
  tragen, nicht die Zellzahl selbst.

Diese Budgets sind bewusst konservativ und sollen in #18
("Verbindliche Budgets... werden nach Messung festgelegt") messtechnisch
verifiziert und bei Bedarf nachjustiert werden. Sie sind hier als
Ausgangswerte für die Architektur, nicht als endgültige Performance-Vorgabe,
dokumentiert.

Reproduzierbar nachvollziehbar über:

```bash
node scripts/geodesic-cell-counts.mjs 1 2 4 8 16 32
```

## Identitätsschema

### `LevelId`

```
lvl<depth>-<name>
```

`name ∈ {global, regional, local}`, `depth ∈ {0, 1, 2}` ist redundant zu
`name` kodiert (zur schnellen lexikografischen Sortierung/Validierung ohne
Nachschlagetabelle). Implementiert in `src/topology/lod/identifiers.ts` als
`createLevelId`, `formatLevelId`, `parseLevelId`.

Beispiel: `lvl0-global`, `lvl1-regional`, `lvl2-local`.

### `CellId`

```
lvl<depth>-<name>/<root|p<parentIndex>>/c<index>
```

- `index`: der Index der Zelle _innerhalb ihres eigenen Patches_ (entspricht
  dem bestehenden `cellId(index)`-Schema aus `geodesic.ts`, hier aber
  zusätzlich in den hierarchischen Kontext eingebettet statt als
  eigenständiger String).
- `root`: nur auf Level 0 zulässig (keine Elternzelle).
- `p<parentIndex>`: auf Level 1/2 verpflichtend; referenziert den `index`
  der Elternzelle auf der jeweils nächsthöheren Ebene.

Beispiele: `lvl0-global/root/c5`, `lvl1-regional/p5/c12`,
`lvl2-local/p12/c3`.

Eindeutigkeit ist strukturell garantiert: Zwei Zellen können nur dieselbe
`CellId` haben, wenn Ebene, Elternindex und lokaler Index übereinstimmen –
das schließt Kollisionen zwischen Ebenen und zwischen Geschwister-Patches
unterschiedlicher Eltern per Konstruktion aus (siehe
`tests/lod-identifiers.test.ts`, "produces no collisions...").

### `ChunkId`

```
lvl<depth>-<name>/chunk-p<parentIndex>
```

Ein Chunk ist die Auslieferungseinheit für ein einzelnes Kind-Patch: alle
Level-(n+1)-Zellen mit demselben `parentIndex` bilden einen Chunk und werden
als eine zusammenhängende statische Datei ausgeliefert (z. B.
`data/lvl1-regional/chunk-p5.json` als spätere Konvention der
Datenpipeline, nicht Teil dieses Issues). Level 0 wird nicht gechunkt (immer
vollständig resident). Beispiel: `lvl1-regional/chunk-p5`.

## Auswahl-, Übergangs- und Picking-Strategie (Entwurf, nicht Teil der Implementierung)

Diese Punkte sind Teil der zu entscheidenden Architektur laut Issue, werden
hier als Entwurf festgehalten und in Folge-Issues konkretisiert:

- **Auswahlregel:** projizierte Zellgröße in Pixel (Kameraabstand,
  Zellradius in Weltkoordinaten, Viewport-Höhe/FOV) bestimmt, ob eine
  Elternzelle durch ihre Level-(n+1)-Chunks ersetzt wird. Nutzt dieselbe
  Distanz-/Hysterese-Idee wie das bestehende `LodController`-Muster in
  `src/rendering/TileLod.ts` – dort für Instanz-Details _innerhalb_ einer
  Zelle, hier für den Ebenenwechsel _zwischen_ Zellauflösungen. Beide
  Konzepte bleiben bewusst getrennt benannt (`ResolutionLevelName` vs.
  `LodLevel`), um Verwechslung zu vermeiden.
- **Übergang:** angrenzende Regionen unterschiedlicher Auflösung werden in
  einer künftigen Implementierung durch eine schmale Übergangszone mit noch
  aktiver Elternzelle plus bereits geladenen, aber ausgeblendeten
  Kind-Chunks realisiert (kein visueller Popping-Ausschluss ist Teil dieses
  Issues; nur die strukturelle Möglichkeit, beide Auflösungen gleichzeitig
  im Speicher zu halten, wird hier vorbereitet).
- **Picking:** Rohes Raycasting liefert weiterhin Dreiecke einer aktuell
  gerenderten Geometrie; die zugehörige `CellId` wird über
  `mesh.userData.cellIds` aufgelöst (wie heute), aber die IDs sind ab dieser
  Architektur hierarchisch aufgebaut, sodass eine gespeicherte Auswahl über
  `parentIndex`-Traversierung auch nach einem Auflösungswechsel wiedergefunden
  werden kann.

## Migrationsplan

1. **Phase 1 (dieses Issue, #57):** Nur Dokumentation und isolierte
   Identitäts-Grundlage (`src/topology/lod/identifiers.ts`). Kein Eingriff in
   `SceneRenderer`, `CellGlobe` oder die Renderpipeline.
2. **Phase 2 (Folge-Issue):** Elternzuordnungs-Funktion (nächste-Zentren-
   Zuordnung) plus Patch-Erzeugung je Elternzelle implementieren und gegen
   Datumsgrenze/Pole testen (`tests/`-Fixtures analog zu
   `tests/geodesic.test.ts`).
3. **Phase 3 (Folge-Issue):** Chunk-Serialisierung für die Offline-
   Datenpipeline (`data/`) inklusive `data/sources.json`-Erweiterung um
   Level-/Chunk-Metadaten.
4. **Phase 4 (Folge-Issue):** `SceneRenderer`/`CellGlobe` auf selektives
   Laden/Entladen von Chunks nach Kameraabstand umstellen; bestehende
   `createCellGlobeMesh`-Signatur bleibt pro Chunk unverändert nutzbar, da
   ein Chunk selbst wieder eine gewöhnliche `GeodesicTopology`-Teilmenge ist.
5. **Phase 5 (Folge-Issue):** Picking- und Auswahlzustand
   (`tests/cell-picking.test.ts`) auf hierarchische `CellId`s umstellen.

Rückwärtskompatibilität während der Migration: `createGeodesicTopology`
bleibt unverändert die Grundlage jeder einzelnen Ebene/jedes Patches; bis
Phase 4 abgeschlossen ist, kann `SceneRenderer` weiterhin ausschließlich
Level 0 (oder die heutige Einzeltopologie) verwenden, ohne dass das
Identitätsschema oder spätere Phasen invalidiert werden.

## Konsequenzen

**Positiv:**

- Der bestehende, getestete Geodäsie-Algorithmus bleibt unverändert die
  einzige Geometriequelle; kein neues geometrisches Fehlerrisiko in diesem
  Issue.
- Zell-, Level- und Chunk-IDs sind ab sofort deterministisch spezifiziert und
  können von Folge-Issues (#9–18, #20, #26, #43, #44, #53, #54) referenziert
  werden, ohne dass die Renderpipeline schon migriert sein muss.
- Rein clientseitig, keine Laufzeit-API nötig (Chunks sind statische
  Dateien, konsistent mit `docs/architecture.md`).
- Pentagon-Garantie bleibt strukturell identisch zum Status quo (jede
  vollständige Kugelstufe hat 12 Pentagone, siehe
  `tests/geodesic.test.ts` und neu `tests/lod-identifiers.test.ts`).

**Negativ / zu tragende Risiken:**

- Nächste-Zentren-Zuordnung erzeugt approximative, nicht exakt
  verschachtelte Kind-Polygone; Zellen nahe einer Elterngrenze benötigen in
  einer künftigen Implementierung explizite Grenzfall-Tests (siehe
  Migrationsplan Phase 2).
- Drei unabhängig generierte Ebenen bedeuten drei separate Stellen, an denen
  `createGeodesicTopology` mit unterschiedlicher Frequenz aufgerufen wird;
  das erhöht die Zahl der zu pflegenden Konfigurationswerte (hier als feste
  Richtwerte dokumentiert, siehe Tabelle oben).
- Chunking, Übergangszonen und Picking-Migration sind bewusst nicht Teil
  dieses Issues (siehe "Nicht enthalten" in #57) und bleiben bis zu ihrer
  jeweiligen Umsetzung unvalidierte Annahmen dieser ADR.

## Auswirkungen auf Folgeissues (hohe Flugebene)

- **#9–#18** (Rendering-/Datenpipeline-Grundlagen, Performance): Budgets
  aus dieser ADR sind Ausgangswerte für die in #18 zu messenden,
  verbindlichen Zahlen; keine der hier genannten Zahlen ist final.
- **#20**: Politische Layer benötigen langfristig eine Zuordnung zu
  `CellId`s über Ebenen hinweg; das hierarchische Schema liefert dafür die
  Adressierung, die Umsetzung ist nicht Teil von #57.
- **#26**: Fluss-Geometrie kann analog zu Terrain über `ChunkId`s
  regionsweise ausgeliefert werden, sobald Phase 3 der Migration umgesetzt
  ist.
- **#43, #44**: Vegetations-/Detaildarstellung auf Zellebene bleibt vom
  bestehenden `LodController`/`TileLod`-Mechanismus getrennt und baut erst
  auf dieser Ebenen-Architektur auf, wenn Level 2 (`local`) real
  materialisiert wird.
- **#53, #54**: Betreffen vermutlich UI/Interaktion auf der Showcase-Welt;
  diese ADR ändert an der heutigen `tileShowcase`-Nutzung nichts, legt aber
  fest, wie eine spätere echte Mehrfachauflösung adressiert würde.

Alle diese Punkte sind bewusst nur auf "hohem Flugniveau" benannt; konkrete
Umsetzungsdetails gehören in die jeweiligen Issues selbst.

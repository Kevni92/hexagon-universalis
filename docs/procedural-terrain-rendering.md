# Prozedurale Terrain-, Relief- und Detaildarstellung

Issue #80 verbindet die prozedurale Referenzwelt aus #77 mit der Global-/Regional-/Lokal-Pipeline aus #78. Issue #86 schließt die Reliefgeometrie und verhindert gleichzeitig sichtbare Eltern-/Kindüberlagerungen. Die echte Erde, die Tile-Demo und die reine LOD-Diagnose bleiben unverändert.

## Datenfluss

1. `ProceduralWorldLod` projiziert jede sichtbare LOD-Zelle räumlich auf die deterministische Referenzwelt.
2. Neben Terrain-Typ, Höhe, Temperatur und Feuchtigkeit bleiben Reliefband und Tile-Modifikatoren erhalten.
3. `ProceduralWorldLodController` ersetzt verfeinerte Elternzellen durch ihre Kinder. Außerhalb der verfeinerten Region bleibt die globale Stufe als geschlossene Rückfallkugel erhalten; dieselbe Raumregion wird nie gleichzeitig als Global-, Regional- und Lokalfläche gezeichnet.
4. `ChunkRenderer` erzeugt weiterhin höchstens ein gebündeltes Flächen-Mesh pro aktiver LOD-Stufe. Relief-Tiles bestehen aus einer radial stabilen Deckfläche und gebündelten Seitenflächen.
5. `ProceduralDetailRenderer` bündelt Bäume, Sträucher, Gras, Felsen und Eis als ein `InstancedMesh` pro Detailtyp.
6. Nachbarschaftsübergänge verwenden die deterministischen Regeln aus #61. Jede gemeinsame Kante besitzt genau einen kanonischen Planer; Wasser, Gletscher und unvereinbare Übergänge bleiben ausgeschlossen.

Die Weltlogik kennt weiterhin kein Three.js. Der Rendering-Adapter konsumiert ausschließlich serialisierbare Weltwerte und stabile LOD-IDs.

## Reliefprofil

Normalisierte prozedurale Höhen werden für die Darstellung auf folgende Meterbereiche abgebildet:

- Land: `0 … 9.000 m`
- Wasser: `0 … -11.000 m`

Anschließend wird das logarithmische Spiel-Relief aus `Relief.ts` mit einem engeren prozeduralen Profil verwendet:

- Meeresspiegelradius: `1`
- maximale Landanhebung: `0,065`
- maximale Ozeanabsenkung: `0,018`
- LOD-Oberflächenabstand: Global `0`, Regional `0,003`, Lokal `0,006`

Die Abbildung ist monoton: Tiefsee liegt stets unter Flachwasser, Flachland unter Hügeln, Hügel unter Gebirge und Gebirge unter Hochgebirge.

## Geschlossene Podestgeometrie

Bei aktivem Relief wird jede Hexagon- oder Pentagonzelle innerhalb der bestehenden Chunk-Geometrie als geschlossenes Podest erzeugt:

- Die Deckfläche bleibt sphärisch radial begrenzt. Die frühere tangentiale Lokalprojektion wird für Relief nicht mehr verwendet, weil sie am Kugelrand überlange Polygonsplitter erzeugen konnte.
- Die Deckkontur wird je LOD leicht nach innen versetzt: Global `0,99`, Regional `0,97`, Lokal `0,94` der ursprünglichen Zellkontur.
- Für jede Polygonkante entstehen zwei Seiten-Dreiecke bis zum gemeinsamen Basissradius `0,975`.
- Die Seitenfarbe ist eine abgedunkelte Ableitung der Tile-Farbe und benötigt kein zusätzliches Material.
- Benachbarte Podeste treffen sich an derselben Basiskante. Dadurch bleiben auch unterschiedlich hohe Reliefstufen ohne schwarze Spalten geschlossen.

Die zusätzlichen Dreiecke befinden sich im selben `BufferGeometry` und im selben Chunk-Mesh. Es entsteht weder ein Mesh noch ein Material pro Zelle, und die Draw-Call-Grenze ändert sich nicht.

## Terrain- und Modifikatordarstellung

Die Basisfarben stammen aus dem gemeinsamen Tile-Katalog. `ProceduralTerrain.ts` definiert zusätzlich deterministische Farbableitungen für:

- Schnee und Gletscher
- Hügel, Gebirge und Hochgebirge
- feuchte Oberflächen

Die Standardkonfiguration weist im Renderer alle verpflichtenden Gruppen aus: Wasser, Küste, Offenland, Wald, trockene Landschaften, Kälte/Schnee/Eis, Feuchtgebiete sowie sämtliche sieben Reliefbänder.

## Detail-LOD und Budgets

| Stufe    | Zellflächen                     | Basisdetails                     | Kantenübergänge            |
| -------- | ------------------------------- | -------------------------------- | -------------------------- |
| Global   | gebündelte geschlossene Podeste | keine                            | keine                      |
| Regional | gebündelte geschlossene Podeste | 1 je geeigneter sichtbarer Zelle | bis 2 je geeigneter Kante  |
| Lokal    | gebündelte geschlossene Podeste | 3 je geeigneter sichtbarer Zelle | bis 10 je geeigneter Kante |

Zusätzlich gelten die festen globalen Instanzobergrenzen aus `detailTypeBudgets()`. Sie verhindern, dass dichte Wälder oder viele Übergangskanten die Instanzzahl unbeschränkt erhöhen. Es entstehen höchstens:

- 3 Draw Calls für sichtbare Zellflächen
- 12 Draw Calls für Detailtypen
- 15 Draw Calls für die vollständige prozedurale Terrainpipeline
- 1 Material pro aktiver Zellstufe und 1 Material pro aktivem Detailtyp

Globale Einzelobjekte sind ausdrücklich ausgeschlossen. Wasser, Gletscher und Hochgebirge erhalten keine Vegetationsinstanzen. Detailposition, Rotation und Skalierung hängen ausschließlich von stabiler Zell-/Kanten-ID, Tile-Typ, Detailtyp, Index und LOD ab.

## Picking und Lebenszyklus

Deck- und Seiten-Dreiecke tragen dieselbe stabile Zell-ID. Dadurch bleibt die korrekte Zelle sowohl auf der Oberfläche als auch an einer sichtbaren Podestseite auswählbar. Detail-Instanzen nehmen nicht am Raycasting teil, damit die darunterliegende Hex-Zelle auswählbar bleibt.

Bei Seed-, Dichte-, Sichtbereichs- oder LOD-Wechsel wird nur bei geänderter Signatur neu gebündelt. Entfernte Meshes geben Geometrie und Material sofort frei. `SceneRenderer.dispose()` räumt Detailrenderer, Chunkrenderer, Weltmodell, Controls, Listener und GPU-Ressourcen vollständig auf.

## Laufzeitdiagnose und Abnahme

Der prozedurale Canvas veröffentlicht für Tests und Diagnose:

- `data-lod-level`
- `data-detail-instances`
- `data-detail-draw-calls`
- `data-render-draw-calls`
- `data-terrain-types`
- `data-terrain-groups`
- `data-relief-bands`
- `data-relief-minimum`
- `data-relief-maximum`

Unit- und Renderingtests prüfen Deck-/Seitendreiecke, Basissradius, radiale Grenzen, Picking-IDs, hierarchischen Elternersatz, Draw Calls und Dispose. Playwright reproduziert Issue #86 zusätzlich mit Seed `fgh`, Dichte `Niedrig`, Lokal-LOD und schräger Kameraperspektive; der Bericht enthält einen Abnahme-Screenshot.

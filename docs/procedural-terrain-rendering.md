# Prozedurale Terrain-, Relief- und Detaildarstellung

Issue #80 verbindet die prozedurale Referenzwelt aus #77 mit der Global-/Regional-/Lokal-Pipeline aus #78. Issue #86 schließt die Reliefgeometrie. Issue #91 ersetzt sichtbare Eltern-/Kindmischungen durch viewportweit einheitliche Topologien. Die echte Erde, die Tile-Demo und die reine LOD-Diagnose bleiben unverändert.

## Datenfluss

1. `ProceduralWorldLod` projiziert jede sichtbare LOD-Zelle räumlich auf die deterministische Referenzwelt.
2. Neben Terrain-Typ, Höhe, Temperatur und Feuchtigkeit bleiben Reliefband und Tile-Modifikatoren erhalten.
3. `ProceduralWorldLodController` wählt genau eine vollständige Kugeltopologie für den gesamten Viewport. Global-, Regional- und Lokalflächen werden nie im selben Frame gemischt.
4. `ChunkRenderer` erzeugt genau ein gebündeltes Flächen-Mesh für die aktive LOD-Stufe. Relief-Tiles bestehen aus einer radial stabilen Deckfläche und gebündelten Seitenflächen.
5. Ein gemeinsamer innerer Planetenkörper schließt LOD-Nähte und den Raum unter den Podesten, ohne auswählbar zu sein.
6. `ProceduralDetailRenderer` bündelt Bäume, Sträucher, Gras, Felsen und Eis als ein `InstancedMesh` pro Detailtyp.
7. Nachbarschaftsübergänge verwenden die deterministischen Regeln aus #61. Jede gemeinsame Kante besitzt genau einen kanonischen Planer; Wasser, Gletscher und unvereinbare Übergänge bleiben ausgeschlossen.

Die Weltlogik kennt weiterhin kein Three.js. Der Rendering-Adapter konsumiert ausschließlich serialisierbare Weltwerte und stabile LOD-IDs.

## Reliefprofil

Normalisierte prozedurale Höhen werden für die Darstellung auf folgende Meterbereiche abgebildet:

- Land: `0 … 9.000 m`
- Wasser: `0 … -11.000 m`

Anschließend wird das logarithmische Spiel-Relief aus `Relief.ts` mit einem engeren prozeduralen Profil verwendet:

- Meeresspiegelradius: `1`
- maximale Landanhebung: `0,065`
- maximale Ozeanabsenkung: `0,018`
- Die fachliche Höhe bleibt unverändert; nur die Renderamplitude wird durch
  eine zentrale LOD-Kurve skaliert.

Für die siebenstufige Zielarchitektur gilt getrennt für Landhebung und
Ozeanabsenkung:

| Stufe         | Landfaktor | Wasserfaktor |
| ------------- | ---------: | -----------: |
| Global        |       0,00 |         0,00 |
| Kontinental   |       0,08 |         0,04 |
| Makroregional |       0,18 |         0,10 |
| Regional      |       0,32 |         0,20 |
| Subregional   |       0,50 |         0,38 |
| Lokal         |       0,72 |         0,65 |
| Detail        |       1,00 |         1,00 |

Global besitzt dadurch exakt den einheitlichen Radius `1`. Jede feinere Stufe
erhöht die sichtbare Reliefamplitude monoton. Die bestehende Drei-Stufen-
Runtime nutzt bis zur vollständigen Migration dieselbe zentrale Kurve über die
Namen `global`, `regional` und `local`; spätere Flat-Projektionen aus #108
wenden denselben Faktor entlang der lokalen Hochachse aus ADR 0003 an.

Die Abbildung ist monoton: Tiefsee liegt stets unter Flachwasser, Flachland unter Hügeln, Hügel unter Gebirge und Gebirge unter Hochgebirge.

## Geschlossene Podestgeometrie

Bei aktivem Relief wird jede Hexagon- oder Pentagonzelle innerhalb der bestehenden Chunk-Geometrie als geschlossenes Podest erzeugt:

- Die Deckfläche bleibt sphärisch radial begrenzt. Die frühere tangentiale Lokalprojektion wird für Relief nicht mehr verwendet, weil sie am Kugelrand überlange Polygonsplitter erzeugen konnte.
- Die Deckkontur verwendet exakt die geodätische Zellgrenze; benachbarte Zellen teilen dadurch dieselben Deckkanten ohne dekorative Fugen.
- Für jede Polygonkante entstehen zwei Seiten-Dreiecke bis zum gemeinsamen Basissradius `0,975`.
- Die Seitenfarbe ist eine aufgehellte, aber weiterhin abgedunkelte Ableitung der Tile-Farbe und benötigt kein zusätzliches Material.
- Direkt unter dem Podestfuß liegt ein gemeinsamer, nicht auswählbarer Planetenkörper mit Radius `0,974`. Er füllt Restspalten an hierarchischen LOD-Nähten, sodass dort niemals der schwarze Szenenhintergrund sichtbar wird.

Die zusätzlichen Seiten-Dreiecke befinden sich im selben `BufferGeometry` und im selben Chunk-Mesh. Es entsteht weder ein Mesh noch ein Material pro Zelle. Der innere Planetenkörper benötigt unabhängig von Zellzahl und LOD genau einen zusätzlichen Draw Call und ein Material.

## Terrain- und Modifikatordarstellung

Die Basisfarben stammen aus dem gemeinsamen Tile-Katalog. `ProceduralTerrain.ts` definiert zusätzlich deterministische Farbableitungen für:

- Schnee und Gletscher
- Hügel, Gebirge und Hochgebirge
- feuchte Oberflächen

Die Standardkonfiguration weist im Renderer alle verpflichtenden Gruppen aus: Wasser, Küste, Offenland, Wald, trockene Landschaften, Kälte/Schnee/Eis, Feuchtgebiete sowie sämtliche sieben Reliefbänder.

## Detail-LOD und Budgets

| Stufe    | Zellflächen                     | Basisdetails                     | Kantenübergänge            |
| -------- | ------------------------------- | -------------------------------- | -------------------------- |
| Global   | gebündelte flache Zellen        | keine                            | keine                      |
| Regional | gebündelte geschlossene Podeste | keine                            | keine                      |
| Lokal    | gebündelte geschlossene Podeste | 3 je geeigneter sichtbarer Zelle | bis 10 je geeigneter Kante |

Zusätzlich gelten die festen globalen Instanzobergrenzen aus `detailTypeBudgets()`. Sie verhindern, dass dichte Wälder oder viele Übergangskanten die Instanzzahl unbeschränkt erhöhen. Es entstehen höchstens:

- 1 Draw Call für die aktive Zelltopologie
- 1 Draw Call für den inneren Planetenkörper
- 12 Draw Calls für Detailtypen
- 16 Draw Calls für die vollständige prozedurale Terrainpipeline
- 1 Material pro aktiver Zellstufe, 1 Substratmaterial und 1 Material pro aktivem Detailtyp

Globale und regionale Einzelobjekte sind ausdrücklich ausgeschlossen. Wasser, Gletscher und Hochgebirge erhalten auch lokal keine Vegetationsinstanzen. Detailposition, Rotation und Skalierung hängen ausschließlich von stabiler Zell-/Kanten-ID, Tile-Typ, Detailtyp, Index und LOD ab.

## Picking und Lebenszyklus

Deck- und Seiten-Dreiecke tragen dieselbe stabile Zell-ID. Dadurch bleibt die korrekte Zelle sowohl auf der Oberfläche als auch an einer sichtbaren Podestseite auswählbar. Der innere Planetenkörper und Detail-Instanzen nehmen nicht am Raycasting teil, damit nur tatsächlich sichtbare Zellflächen ausgewählt werden.

Bei Seed-, Dichte-, Sichtbereichs- oder LOD-Wechsel wird nur bei geänderter Signatur neu gebündelt. Entfernte Meshes geben Geometrie und Material sofort frei. `SceneRenderer.dispose()` räumt Detailrenderer, Chunkrenderer, inneren Planetenkörper, Weltmodell, Controls, Listener und GPU-Ressourcen vollständig auf.

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
- `data-relief-land-factor`
- `data-relief-water-factor`

Unit- und Renderingtests prüfen Deck-/Seitendreiecke, Basissradius, Substratradius, radiale Grenzen, Picking-Ausschluss, Picking-IDs, exklusive Volltopologien, Draw Calls und Dispose. Playwright reproduziert die Lokalansicht zusätzlich mit Seed `fgh`, Dichte `Niedrig` und schräger Kameraperspektive; der Bericht enthält einen Abnahme-Screenshot.

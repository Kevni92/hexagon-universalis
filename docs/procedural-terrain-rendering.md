# Prozedurale Terrain-, Relief- und Detaildarstellung

Issue #80 verbindet die prozedurale Referenzwelt aus #77 mit der selektiven Global-/Regional-/Lokal-Pipeline aus #78. Die echte Erde, die Tile-Demo und die reine LOD-Diagnose bleiben unverändert.

## Datenfluss

1. `ProceduralWorldLod` projiziert jede sichtbare LOD-Zelle räumlich auf die deterministische Referenzwelt.
2. Neben Terrain-Typ, Höhe, Temperatur und Feuchtigkeit bleiben nun auch Reliefband und Tile-Modifikatoren erhalten.
3. `ChunkRenderer` erzeugt weiterhin höchstens ein gebündeltes Flächen-Mesh pro aktiver LOD-Stufe. Eine Radiusfunktion hebt oder senkt die Zellgeometrie, ohne Meshes oder Materialien pro Zelle anzulegen.
4. `ProceduralDetailRenderer` bündelt Bäume, Sträucher, Gras, Felsen und Eis als ein `InstancedMesh` pro Detailtyp.
5. Nachbarschaftsübergänge verwenden die deterministischen Regeln aus #61. Jede gemeinsame Kante besitzt genau einen kanonischen Planer; Wasser, Gletscher und unvereinbare Übergänge bleiben ausgeschlossen.

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

Die Abbildung ist monoton: Tiefsee liegt stets unter Flachwasser, Flachland unter Hügeln, Hügel unter Gebirge und Gebirge unter Hochgebirge. Die bestehenden radialen LOD-Abstände verhindern Z-Fighting der selektiven Overlays.

## Terrain- und Modifikatordarstellung

Die Basisfarben stammen aus dem gemeinsamen Tile-Katalog. `ProceduralTerrain.ts` definiert zusätzlich deterministische Farbableitungen für:

- Schnee und Gletscher
- Hügel, Gebirge und Hochgebirge
- feuchte Oberflächen

Die Standardkonfiguration weist im Renderer alle verpflichtenden Gruppen aus: Wasser, Küste, Offenland, Wald, trockene Landschaften, Kälte/Schnee/Eis, Feuchtgebiete sowie sämtliche sieben Reliefbänder.

## Detail-LOD und Budgets

| Stufe    | Zellflächen           | Basisdetails                     | Kantenübergänge            |
| -------- | --------------------- | -------------------------------- | -------------------------- |
| Global   | gebündelt             | keine                            | keine                      |
| Regional | gebündelt             | 1 je geeigneter sichtbarer Zelle | bis 2 je geeigneter Kante  |
| Lokal    | gebündelt, tangential | 3 je geeigneter sichtbarer Zelle | bis 10 je geeigneter Kante |

Zusätzlich gelten die festen globalen Instanzobergrenzen aus `detailTypeBudgets()`. Sie verhindern, dass dichte Wälder oder viele Übergangskanten die Instanzzahl unbeschränkt erhöhen. Es entstehen höchstens:

- 3 Draw Calls für sichtbare Zellflächen
- 12 Draw Calls für Detailtypen
- 15 Draw Calls für die vollständige prozedurale Terrainpipeline
- 1 Material pro aktiver Zellstufe und 1 Material pro aktivem Detailtyp

Globale Einzelobjekte sind ausdrücklich ausgeschlossen. Wasser, Gletscher und Hochgebirge erhalten keine Vegetationsinstanzen. Detailposition, Rotation und Skalierung hängen ausschließlich von stabiler Zell-/Kanten-ID, Tile-Typ, Detailtyp, Index und LOD ab.

## Picking und Lebenszyklus

Relief verändert die bestehenden Dreiecks-zu-Zell-IDs nicht. Detail-Instanzen nehmen nicht am Raycasting teil, damit die darunterliegende Hex-Zelle auswählbar bleibt.

Bei Seed-, Dichte-, Sichtbereichs- oder LOD-Wechsel wird nur bei geänderter Signatur neu gebündelt. Entfernte InstancedMeshes geben Geometrie und Material sofort frei. `SceneRenderer.dispose()` räumt Detailrenderer, Chunkrenderer, Weltmodell, Controls, Listener und GPU-Ressourcen vollständig auf.

## Laufzeitdiagnose

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

Playwright prüft damit Global-, Regional- und Lokalansicht, Reliefbereich, Terrainvielfalt, Detailbudgets, deterministische Rückkehr in dieselbe Lokalansicht sowie fehlende Browserfehler. Screenshots aller drei Stufen werden dem Playwright-Bericht angehängt.

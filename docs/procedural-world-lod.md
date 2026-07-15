# Prozedurale Welt: Global-, Regional- und Lokal-LOD

Issue #78 verbindet das deterministische Weltmodell aus #77 mit der hierarchischen Geodäsie aus
ADR 0001. Der explizite Modus `?world=procedural` ist von der echten Erde (`earth`), der
Tile-Katalog-Demo (`demo`) und der geometrischen LOD-Diagnose (`lod`) getrennt.

## Konsistenzregel

`ProceduralWorldLod` erzeugt genau eine Referenzwelt aus Seed und Generatorparametern. Sichtbare
LOD-Zellen beziehen ihre Fachwerte über das nächstgelegene Referenzzentrum auf der Einheitskugel.
Die Zuordnung verwendet nur den stabilen 3D-Ort, niemals einen lokalen Zufalls- oder Chunkindex.
Gemeinsame Zentren erhalten dadurch auf allen Stufen exakt dieselben Werte. Die 3D-Abtastung hat
weder an der Datumsgrenze noch an den Polen eine Sonderbehandlung oder Naht.

Die Picking-ID ist durch Stufe und global eindeutigen Zellindex qualifiziert, beispielsweise
`lvl2-local/visible/c<local>`. Die geschlossene Globaltopologie bleibt als Fallback resident.
Regional und Lokal legen ausschließlich Zellen innerhalb eines Fokuswinkels von 54 beziehungsweise
25,2 Grad um den anvisierten Kugelpunkt mit 0,3 beziehungsweise 0,6 Prozent radialem Abstand
darüber. So wird nur der betrachtete Bereich feiner; Rückseite, Rand und ferne Regionen bleiben
global beziehungsweise regional. Die Fallbackfläche schließt die nicht deckungsgleichen Ränder
der Voronoi-Stufen, ohne schwarze Löcher. Picking kann anhand des Levels immer das oberste Tile
priorisieren.

Die Lokalstufe verwendet zusätzlich echte Tangentialflächen: Jeder geodätische Randpunkt wird
auf die Tangentialebene am Zellzentrum projiziert. Mittelpunkt und sämtliche Randpunkte eines
Hexagons sind damit koplanar und teilen dieselbe nach außen gerichtete Normale. Das Zellzentrum
und diese Normale bilden den stabilen lokalen Frame für spätere Bäume, Berge, Gebäude und andere
Modelle. Global und Regional behalten ihre kugelförmige Oberfläche.

## Dichte-, Schwellen- und Budgetprofile

Die ausgewählte Dichte bezeichnet die globale Referenzauflösung aus #77. Regional und Lokal
erhöhen die geometrische Frequenz darüber hinaus. Für Frequenz `f` gilt `10 × f² + 2` Zellen.

| Dichte     |      Global |    Regional |        Lokal | Regional ein/aus | Lokal ein/aus | max. aktive Zellen | Draw Calls | Zielbudget Generierung |
| ---------- | ----------: | ----------: | -----------: | ---------------: | ------------: | -----------------: | ---------: | ---------------------: |
| `low`      |    f4 / 162 |    f8 / 642 |  f16 / 2.562 |       70 / 50 px |    70 / 52 px |              3.366 |          3 |                  40 ms |
| `standard` |    f8 / 642 | f16 / 2.562 | f32 / 10.242 |       35 / 25 px |    55 / 40 px |             13.446 |          3 |                  90 ms |
| `high`     | f16 / 2.562 | f24 / 5.762 | f32 / 10.242 |       18 / 13 px |    28 / 20 px |             18.566 |          3 |                 180 ms |

Die Werte vor und nach dem Schrägstrich sind Einschalt- und Ausschaltschwelle der Hysterese.
Global bleibt resident. Regional und Lokal werden erst beim Erreichen ihrer Schwelle erzeugt und
auf Frustum sowie Vorderseite gefiltert. Jede aktive Stufe wird in einer `VisibleUnit` gebündelt;
deshalb sind höchstens drei Draw Calls nötig. `max. aktive Zellen` ist die konservative Summe der
vollständigen Stufen; die tatsächliche Zahl liegt durch die Sichtfeldselektion darunter. Das
Mobilprofil entspricht der `low`-Dichte und verändert keine Generatorparameter oder fachlichen
Werte.

Nur der prozedurale Modus reduziert die minimale Kameradistanz von `2.2` auf `1.18`. Damit liegt
zwischen dem Regionalwechsel bei mittlerer Entfernung und dem Lokalwechsel im echten Nahbereich
ein deutlich größerer nutzbarer Zoombereich. Die Nahgrenze hält trotz des radial um 0,6 Prozent
angehobenen Lokal-Overlays weiterhin Abstand zur Near-Clipping-Ebene.

Die Pointerrotation ist im prozeduralen Modus ebenfalls zoomadaptiv. Maßgeblich ist der Abstand
zwischen Kamera und Kugeloberfläche relativ zur Startansicht bei `3.4`: Dort gilt Faktor `1`, bei
Distanz `2.2` ungefähr `0.5` und im Nahbereich `1.18` der begrenzte Faktor `0.08`. Derselbe Faktor
gilt für die beim Loslassen übernommene Trägheitsgeschwindigkeit.

Ungültige Seeds, Dichten und Generatorparameter werden vor der Welt- oder
Topologiematerialisierung abgelehnt. Ein Seed-/Parameterwechsel leert nur den fachlichen
Projektionscache. Ein Dichtewechsel ersetzt zusätzlich den Topologie- und Hysteresecontroller.
`dispose()` leert beide Cachearten. Die Generationsnummer erlaubt späteren asynchronen UI-Aufrufern,
veraltete Ergebnisse zu erkennen; die heutige Generierung selbst ist synchron.

## Abnahme

Automatisierte Tests decken alle drei erreichbaren Stufen, deterministische stufenübergreifende
Referenzwerte, strikt sinkende mittlere Zellradien, selektive Sichtfeld-Overlays, qualifizierte
Picking-IDs, koplanare Lokalvertices mit einheitlicher Flächennormale, Hysterese,
Cacheinvalidierung und Dispose ab. Im Browser kann die aktive Stufe für E2E- und
Diagnosezwecke über `canvas[data-lod-level]` gelesen werden. Das sichtbare Bedienpanel folgt in
#79; vollständiges Terrainrelief und Detailrendering folgen in #80.

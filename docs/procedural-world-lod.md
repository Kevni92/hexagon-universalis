# Prozedurale Welt: Global-, Regional- und Lokal-LOD

Issue #78 verbindet das deterministische Weltmodell aus #77 mit der hierarchischen Geodäsie aus
ADR 0001. Issue #86 schließt die Reliefflächen und ersetzt verfeinerte Eltern hierarchisch durch
ihre Kinder. Issue #88 koppelt die räumliche Auswahl an den zentralen Kamerastrahl. Der explizite
Modus `?world=procedural` ist von der echten Erde (`earth`), der Tile-Katalog-Demo (`demo`) und der
geometrischen LOD-Diagnose (`lod`) getrennt.

## Konsistenzregel

`ProceduralWorldLod` erzeugt genau eine Referenzwelt aus Seed und Generatorparametern. Sichtbare
LOD-Zellen beziehen ihre Fachwerte über das nächstgelegene Referenzzentrum auf der Einheitskugel.
Die Zuordnung verwendet nur den stabilen 3D-Ort, niemals einen lokalen Zufalls- oder Chunkindex.
Gemeinsame Zentren erhalten dadurch auf allen Stufen exakt dieselben Werte. Die 3D-Abtastung hat
weder an der Datumsgrenze noch an den Polen eine Sonderbehandlung oder Naht.

Die Picking-ID ist durch Stufe und vollständige Elternkette qualifiziert, beispielsweise
`lvl2-local/g<global>/p<regional>/c<local>`. Verfeinerte Global- und Regionaleltern werden durch
ihre Kinder ersetzt. Außerhalb der aktiven Parent-Chunks bleibt die geschlossene Globaltopologie
als Fallback resident. Dadurch existiert je Raumregion nur eine sichtbare Zellauflösung, während
Podestseiten und innerer Planetenkörper verbleibende LOD-Nähte schließen.

## Kamerafokus und stabile Parent-Auswahl

Der Mittelpunkt des Viewports wird als Strahl im lokalen, unrotierten Koordinatensystem der Kugel
berechnet. Der erste positive Schnittpunkt dieses Strahls mit der Weltkugel definiert den
normalisierten LOD-Fokus. Da Kameraposition und Blickrichtung vor der Auswahl mit der inversen
Weltrotation transformiert werden, stimmen Kamera-, Welt- und Zellkoordinaten überein.

Die Pixelgröße einer Elternzelle entscheidet weiterhin mit getrennten Ein- und Ausschaltschwellen,
ob sie verfeinert werden darf. Reicht das aktive Chunkbudget nicht für alle Kandidaten, wird jedoch
nicht mehr die seitlich größte projizierte Zelle gewählt. Priorität hat die höchste Ausrichtung zum
zentralen Fokuspunkt. Projizierte Größe und stabile Parent-ID dienen nur als sekundäre,
deterministische Sortierschlüssel.

Bereits aktive Parents bleiben innerhalb eines kleinen, aus ihrem Winkelradius abgeleiteten
räumlichen Hysteresebands erhalten. Ein Wechsel erfolgt dadurch erst, wenn ein anderer Parent klar
näher am Kamerafokus liegt. Reines Zoomen verändert den Fokuspunkt und die ausgewählten Parent-IDs
nicht. Eine echte Rotation verschiebt sie dagegen nachvollziehbar in Rotationsrichtung.

Für Diagnose und Playwright-Abnahme veröffentlicht das Canvas folgende Werte:

- `data-lod-focus-direction`
- `data-lod-regional-parents`
- `data-lod-local-parents`
- `data-lod-finest-unit-keys`
- `data-lod-finest-cell-count`
- `data-lod-finest-centroid`
- `data-lod-focus-angle`

## Dichte-, Schwellen- und Budgetprofile

Die ausgewählte Dichte bezeichnet die globale Referenzauflösung aus #77. Regional und Lokal
erhöhen die geometrische Frequenz darüber hinaus. Für Frequenz `f` gilt `10 × f² + 2` Zellen.

| Dichte     |      Global |    Regional |        Lokal | Regional ein/aus | Lokal ein/aus | max. aktive Zellen | Draw Calls | Zielbudget Generierung |
| ---------- | ----------: | ----------: | -----------: | ---------------: | ------------: | -----------------: | ---------: | ---------------------: |
| `low`      |    f4 / 162 |    f8 / 642 |  f16 / 2.562 |       70 / 50 px |    70 / 52 px |              3.366 |          3 |                  40 ms |
| `standard` |    f8 / 642 | f16 / 2.562 | f32 / 10.242 |       35 / 25 px |    55 / 40 px |             13.446 |          3 |                  90 ms |
| `high`     | f16 / 2.562 | f24 / 5.762 | f32 / 10.242 |       18 / 13 px |    28 / 20 px |             18.566 |          3 |                 180 ms |

Die Werte vor und nach dem Schrägstrich sind Einschalt- und Ausschaltschwelle der Pixelhysterese.
Global bleibt resident. Regional und Lokal werden erst beim Erreichen ihrer Schwelle erzeugt und
auf Frustum sowie Vorderseite gefiltert. Die prozeduralen Profile erlauben je Ebene genau einen
verfeinerten Parent-Chunk; dadurch bleibt die feinste Region kompakt um den Kamerafokus. Jede
aktive Stufe wird gebündelt gerendert, deshalb sind höchstens drei Zellflächen-Draw-Calls nötig.
`max. aktive Zellen` ist die konservative Summe der vollständigen Stufen; die tatsächliche Zahl
liegt durch die hierarchische Auswahl darunter.

Nur der prozedurale Modus reduziert die minimale Kameradistanz von `2.2` auf `1.18`. Damit liegt
zwischen dem Regionalwechsel bei mittlerer Entfernung und dem Lokalwechsel im echten Nahbereich
ein deutlich größerer nutzbarer Zoombereich. Die Nahgrenze hält trotz des Reliefs weiterhin
Abstand zur Near-Clipping-Ebene.

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
Referenzwerte, die zentrale Strahl-Kugel-Schnittberechnung, Pixel- und Raumhysterese,
deterministische Parent-IDs, reine Zoomsequenzen, Rotation, qualifizierte Picking-IDs,
Cacheinvalidierung und Dispose ab. Der Playwright-Test verwendet Seed `fgh`, Dichte `high`,
Lokal-LOD und eine Zoomsequenz ohne Rotation. Start- und Endaufnahme werden im Testbericht
angehängt; die Diagnoseattribute müssen über alle Zoomschritte stabil bleiben.

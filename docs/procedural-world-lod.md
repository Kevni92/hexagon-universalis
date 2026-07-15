# Prozedurale Welt: Global-, Regional- und Lokal-LOD

Issue #78 verbindet das deterministische Weltmodell aus #77 mit der geodätischen Topologie aus
ADR 0001. Issue #91 balanciert Kamera und prozedurale Darstellung so aus, dass im Viewport nie
mehrere Zellauflösungen nebeneinander liegen. Der explizite Modus `?world=procedural` ist von der
echten Erde (`earth`), der Tile-Katalog-Demo (`demo`) und der geometrischen LOD-Diagnose (`lod`)
getrennt.

## Konsistenzregel

`ProceduralWorldLod` erzeugt genau eine Referenzwelt aus Seed und Generatorparametern. Sichtbare
LOD-Zellen beziehen ihre Fachwerte über das nächstgelegene Referenzzentrum auf der Einheitskugel.
Die Zuordnung verwendet nur den stabilen 3D-Ort, niemals einen lokalen Zufalls- oder Chunkindex.
Gemeinsame Zentren erhalten dadurch auf allen Stufen exakt dieselben Werte. Die 3D-Abtastung hat
weder an der Datumsgrenze noch an den Polen eine Sonderbehandlung oder Naht.

Jede Stufe verwendet eine vollständige, geschlossene Kugeltopologie und eine durch Stufe und
Zellindex qualifizierte Picking-ID, beispielsweise `lvl2-local/visible/c<local>`. Ein Stufenwechsel
ersetzt die vorherige Topologie als Ganzes. Dadurch enthält jeder Frame genau eine Zellauflösung;
Grenzen zwischen großen und kleinen Zellen können nicht in den Viewport geraten.

## Kamera, Stufenwechsel und sichtbare Information

Der Mittelpunkt des Viewports wird als Strahl im lokalen, unrotierten Koordinatensystem der Kugel
berechnet. Der erste positive Schnittpunkt dieses Strahls mit der Weltkugel definiert den
normalisierten LOD-Fokus. Da Kameraposition und Blickrichtung vor der Auswahl mit der inversen
Weltrotation transformiert werden, stimmen Kamera-, Welt- und Zellkoordinaten überein.

Die größte sichtbare projizierte Zellgröße entscheidet mit getrennten Ein- und Ausschaltschwellen
über den Stufenwechsel. Die Hysterese verhindert Flattern bei kleinen Radimpulsen. Global ist flach
und zeigt keine Einzelobjekte. Regional aktiviert das Höhenrelief, bleibt aber detailfrei. Lokal
behält dasselbe Relief und ergänzt erst dann Bäume, Felsen und andere Detailinstanzen.

Der prozedurale Kamerabereich reicht von `3.4` bis `1.2` Kugelradien. Am äußersten Zoom belegt die
vollständige Kugel bei 45° Sichtfeld rund 74 Prozent der Viewporthöhe. Die Nahgrenze hält selbst
über dem maximalen Relief zusätzlich zur Near Plane einen Sicherheitsabstand von 0,035
Kugelradien. Weiteres Herauszoomen auf eine unlesbar kleine Miniatur ist nicht möglich.

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
| `low`      |    f4 / 162 |    f8 / 642 |  f16 / 2.562 |       70 / 66 px |    70 / 52 px |              2.562 |          1 |                  40 ms |
| `standard` |    f8 / 642 | f16 / 2.562 | f32 / 10.242 |       35 / 34 px |    55 / 40 px |             10.242 |          1 |                  90 ms |
| `high`     | f16 / 2.562 | f24 / 5.762 | f32 / 10.242 |       18 / 17 px |    28 / 20 px |             10.242 |          1 |                 180 ms |

Die Werte vor und nach dem Schrägstrich sind Einschalt- und Ausschaltschwelle der Pixelhysterese,
normiert auf eine Referenz-Viewporthöhe von 720 Pixeln. Dadurch liegen die Stufenwechsel auf
Desktop und mobilen Hochformaten bei denselben Kameradistanzen.

Regional und Lokal werden erst beim Erreichen ihrer Schwelle erzeugt. Es ist stets genau eine
vollständige Stufe aktiv und zu einem Zellflächen-Draw-Call gebündelt. `max. aktive Zellen` ist
daher die größte einzelne Topologie statt der Summe aller drei Stufen.

Die Pointerrotation ist im prozeduralen Modus ebenfalls zoomadaptiv. Maßgeblich ist der Abstand
zwischen Kamera und Kugeloberfläche relativ zur Startansicht bei `3.4`: Dort gilt Faktor `1`, bei
Distanz `2.2` ungefähr `0.5` und im Nahbereich `1.2` der begrenzte Faktor `0.08`. Derselbe Faktor
gilt für die beim Loslassen übernommene Trägheitsgeschwindigkeit.

Ungültige Seeds, Dichten und Generatorparameter werden vor der Welt- oder
Topologiematerialisierung abgelehnt. Ein Seed-/Parameterwechsel leert nur den fachlichen
Projektionscache. Ein Dichtewechsel ersetzt zusätzlich den Topologie- und Hysteresecontroller.
`dispose()` leert beide Cachearten. Die Generationsnummer erlaubt späteren asynchronen UI-Aufrufern,
veraltete Ergebnisse zu erkennen; die heutige Generierung selbst ist synchron.

## Abnahme

Visuelle Referenzen für Seed `fgh` und Dichte `standard`:

- [Global: vollständige flache Kugel](./screenshots/issue-91-global.png)
- [Regional: einheitliche Zellen mit Relief](./screenshots/issue-91-regional.png)
- [Lokal: viewportfüllende feine Zellen mit Details](./screenshots/issue-91-local.png)

Automatisierte Tests decken alle drei erreichbaren Stufen, deterministische stufenübergreifende
Referenzwerte, die zentrale Strahl-Kugel-Schnittberechnung, Pixelhysterese, viewportweit exklusive
Stufen, flaches Global-LOD, detailfreies Regional-LOD, qualifizierte Picking-IDs,
Cacheinvalidierung und Dispose ab. Der Playwright-Test verwendet Seed `fgh`, Dichte `high`,
Lokal-LOD und eine Zoomsequenz ohne Rotation. Start- und Endaufnahme werden im Testbericht
angehängt; Stufe, vollständige Topologie und Fokusdiagnose müssen stabil bleiben.

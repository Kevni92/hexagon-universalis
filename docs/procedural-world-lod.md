# Prozedurale Welt: Global-, Regional- und Lokal-LOD

> Der aktuelle Runtime-Stand dieses Dokuments beschreibt weiterhin die
> implementierte Drei-Stufen-Pipeline. Die verbindliche Zielarchitektur für
> sieben Stufen, sichtbereichsgechunkte Materialisierung und Desktop-/Mobile-
> Budgets ist in [ADR 0002](./architecture/0002-seven-level-world-lod.md)
> festgelegt. Die Runtime-Migration erfolgt in #97.

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
- `data-lod-updates`
- `data-lod-cached-topologies`
- `data-lod-topology-builds`
- `data-chunk-cached-meshes`
- `data-chunk-geometry-builds`
- `data-chunk-geometry-disposals`
- `data-detail-cached-states`
- `data-detail-builds`
- `data-detail-disposals`

Die Arbeitszähler sind monoton und zeitunabhängig. Stationäre Frames sowie reine Weltrotation
verändern sie nicht, weil die prozedurale Stufenauswahl ausschließlich Kameradistanz, Sichtfeld
und Viewportmaß benötigt. Damit prüfen Tests reale Arbeit statt instabiler Runner-FPS.

## Dichte-, Schwellen- und Budgetprofile

Die ausgewählte Dichte bezeichnet die globale Referenzauflösung aus #77. Regional und Lokal
erhöhen die geometrische Frequenz darüber hinaus. Für Frequenz `f` gilt `10 × f² + 2` Zellen.

| Dichte     |      Global |    Regional |        Lokal | Regional ein/aus | Lokal ein/aus |         max. aktive Zellen | Draw Calls | Zielbudget Generierung |
| ---------- | ----------: | ----------: | -----------: | ---------------: | ------------: | -------------------------: | ---------: | ---------------------: |
| `low`      |    f4 / 162 |    f8 / 642 |  f16 / 2.562 |       70 / 66 px |    70 / 52 px |                      2.562 |          1 |                  40 ms |
| `standard` |    f8 / 642 | f16 / 2.562 | f32 / 10.242 |       35 / 34 px |    55 / 40 px |                     10.242 |          1 |                  90 ms |
| `high`     | f16 / 2.562 | f24 / 5.762 | f32 / 10.242 |       18 / 17 px |    28 / 20 px |                     10.242 |          1 |                 180 ms |
| `ultra`    | f16 / 2.562 | f24 / 5.762 | f32 / 10.242 |       18 / 17 px |    28 / 20 px | 15.360 aktiv / 16.384 max. |         33 |                 250 ms |

`ultra` ist ein opt-in Experiment. Zusätzlich zu den sicheren f16/f24/f32-
Stufen adressiert die Detailstufe `f144 / 207.362` Zellen. Die f144-Geometrie
wird in 32 lokalen Chunks mit je 480 Zellen vorab erzeugt; aktiv sind damit
15.360 Zellen, das Desktopbudget erlaubt höchstens 16.384. Das Draw-Call-Budget
von 33 entspricht ADR 0002: maximal 32 aktive Chunks plus gemeinsames Substrat.
Zusätzliche Puffer für den späteren Globe-/Flat-Austausch und Rezentrierung
aus ADR 0003 sind in #107 erneut zu vermessen.

Die Werte vor und nach dem Schrägstrich sind Einschalt- und Ausschaltschwelle der Pixelhysterese,
normiert auf eine Referenz-Viewporthöhe von 720 Pixeln. Dadurch liegen die Stufenwechsel auf
Desktop und mobilen Hochformaten bei denselben Kameradistanzen.

Regional und Lokal werden erst beim erstmaligen Erreichen ihrer Schwelle erzeugt. Danach bleiben
genau drei vollständige Topologien und drei zugehörige Weltmeshes (eins aktiv, höchstens zwei
inaktiv) für Zoomzyklen resident. Es ist stets genau eine vollständige Stufe sichtbar und zu einem
Zellflächen-Draw-Call gebündelt. `max. aktive Zellen` ist daher weiterhin die größte einzelne
sichtbare Topologie; der Cache ist unabhängig von der Zahl der Interaktionen konstant begrenzt.
Projektionen und Farben werden pro Stufe ebenfalls wiederverwendet und bei Welt- oder
Dichtewechsel vollständig invalidiert.

Die Pointerrotation ist im prozeduralen Modus ebenfalls zoomadaptiv. Maßgeblich ist der Abstand
zwischen Kamera und Kugeloberfläche relativ zur Startansicht bei `3.4`: Dort gilt Faktor `1`, bei
Distanz `2.2` ungefähr `0.5` und im Nahbereich `1.2` der begrenzte Faktor `0.08`. Derselbe Faktor
gilt für die beim Loslassen übernommene Trägheitsgeschwindigkeit.

Lokale Detailinstanzen bleiben für genau einen Weltfingerprint im Speicher und werden außerhalb
des Lokal-LOD nur ausgeblendet. Global und Regional melden deshalb weiterhin null aktive
Detailinstanzen und -Draw-Calls. Ein anderer Weltfingerprint verwirft diesen einzelnen Zustand.

Ungültige Seeds, Dichten und Generatorparameter werden vor der Welt- oder
Topologiematerialisierung abgelehnt. Ein Seed-/Parameterwechsel leert fachliche Projektionen,
Farben, Weltmeshes und Details. Ein Dichtewechsel ersetzt zusätzlich den Topologie- und
Hysteresecontroller. `dispose()` leert alle Cachearten. Die Generationsnummer erlaubt späteren
asynchronen UI-Aufrufern, veraltete Ergebnisse zu erkennen; die heutige Generierung selbst ist
synchron.

## Abnahme

### Referenzprofil für Issue #89

Der lokale Referenzlauf vom 15. Juli 2026 verwendete einen Intel Core i7-8750H, eine NVIDIA
GeForce GTX 1060, Chromium 149.0.7827.55, 1920 × 1080, Seed `fgh` und Dichte `high`. Da der
automatisierte Browser headless läuft und der verfügbare Grafikpfad virtualisiert sein kann,
werden daraus keine hardwareunabhängigen FPS-Grenzen abgeleitet. Die reproduzierbaren
Arbeitszähler zeigen für 120 stationäre Frames und anschließend zehn Regional-/Lokal-Zyklen:

| Arbeit nach initialem Lokal-Warm-up     | Vor #89 | Nach #89 |
| --------------------------------------- | ------: | -------: |
| zusätzliche LOD-Updates, 120 Ruheframes |     120 |        0 |
| Topologieaufbauten, Warm-up + 10 Zyklen |      13 |        3 |
| Geometrieaufbauten, Warm-up + 10 Zyklen |      22 |        3 |
| Geometriefreigaben während der Zyklen   |      20 |        0 |
| Detailaufbauten, Warm-up + 10 Zyklen    |      11 |        1 |
| Detailfreigaben während der Zyklen      |      10 |        0 |

Reine Weltrotation verursacht nach dem Warm-up ebenfalls null zusätzliche LOD-, Geometrie- oder
Detailarbeit. Der sichtbare Zustand bleibt bei einem Weltmesh plus Substrat und höchstens zwölf
Detail-Draw-Calls innerhalb des Gesamtbudgets von 16. Alle drei Topologien und Weltmeshes sowie
genau ein lokaler Detailzustand bilden die feste obere Cachegrenze; `dispose()` gibt sie komplett
frei.

Visuelle Referenzen für Seed `fgh` und Dichte `standard`:

- [Global: vollständige flache Kugel](./screenshots/issue-91-global.png)
- [Regional: einheitliche Zellen mit Relief](./screenshots/issue-91-regional.png)
- [Lokal: viewportfüllende feine Zellen mit Details](./screenshots/issue-91-local.png)

Automatisierte Tests decken alle drei erreichbaren Stufen, deterministische stufenübergreifende
Referenzwerte, die zentrale Strahl-Kugel-Schnittberechnung, Pixelhysterese, viewportweit exklusive
Stufen, flaches Global-LOD, detailfreies Regional-LOD, qualifizierte Picking-IDs,
Cacheinvalidierung und Dispose ab. Der Playwright-Test verwendet Seed `fgh`, Dichte `high`,
Lokal-LOD, eine stationäre Ruhephase, reine Rotation und kontrolliertes Nahbereichszoomen. Drei
vollständige WebGL-Zoomzyklen laufen mit niedriger Dichte, damit parallele SwiftShader-Kontexte den
Runner nicht verfälschen. Die zeitunabhängigen Regressionen führen zusätzlich 120 stationäre
Frames und zehn Zyklen aus. Start- und Endaufnahme werden im Testbericht angehängt; Stufe,
vollständige Topologie, Fokusdiagnose und die deterministischen Arbeitsbudgets müssen stabil
bleiben.

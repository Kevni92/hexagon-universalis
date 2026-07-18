# Ultra-Dichteprofil: Benchmark und Absicherung (#98)

Das Ultra-Profil bleibt ein opt-in Experiment. Die höchste Stufe `f144` mit
`207.362` global adressierbaren Zellen wird nur als Chunk-Adressraum geführt;
die interaktive Runtime materialisiert höchstens `local / f89` mit `79.212`
Zellen. Das verhindert, dass die rechnerisch mögliche Vollgeometrie den
Browser-Hauptthread oder die GPU-Budgets überlastet.

## Deterministischer Budgetlauf

Der reproduzierbare Strukturbenchmark wird mit `npm run lod:budget` ausgeführt.
Er berechnet Zell-, Kanten-, Reliefdreiecks- und Roh-GPU-Größen ohne
hardwareabhängige FPS-Annahmen:

| Frequenz |  Zellen |    Kanten | Reliefdreiecke | Roh-GPU-Speicher |
| -------: | ------: | --------: | -------------: | ---------------: |
|        8 |     642 |     3.840 |         11.520 |         1,19 MiB |
|       13 |   1.692 |    10.140 |         30.420 |         3,13 MiB |
|       21 |   4.412 |    26.460 |         79.380 |         8,18 MiB |
|       34 |  11.562 |    69.360 |        208.080 |        21,43 MiB |
|       55 |  30.252 |   181.500 |        544.500 |        56,08 MiB |
|       89 |  79.212 |   475.260 |      1.425.780 |       146,85 MiB |
|      144 | 207.362 | 1.244.160 |      3.732.480 |       384,43 MiB |

Die letzte Zeile ist absichtlich eine Warnung vor Vollmaterialisierung und kein
Runtime-Ziel. Die verbindlichen Runtime-Grenzen stehen in
`PROCEDURAL_LOD_PROFILES.ultra`: 16.384 aktive Zellen, 33 aktive Chunks und ein
Generierungsziel von 250 ms. Für mobile Plattformen gelten die strengeren
Grenzen aus ADR 0002.

## Browser-Abnahme

PR #120 prüfte den interaktiven Ultra-Pfad mit Quality-CI und Playwright. Der
lokale Referenzlauf wurde mit Seed `ultra-preloaded-e2e`, Desktop-Chromium und
seriellen Playwright-Tests durchgeführt: 15/15 Tests bestanden. Die E2E-Suite
prüft insbesondere den Loading-Overlay-Fortschritt, die f89-Grenze,
Rotation/Zoom, stabile Cachewerte und den mobilen Overflow-Smoke-Test.

Die Messung bleibt bewusst arbeits- und budgetbasiert statt FPS-basiert:
stationäre Frames dürfen keine neuen LOD-, Geometrie- oder Detailaufbauten
erzeugen; veraltete Chunk-Sätze werden atomar verworfen; f144 wird nicht
automatisch als Vollkugel erzeugt.

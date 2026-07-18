# Prozedurale Testwelt – Generatorformat v1

Bezug: #77, Teil von #76.

## Zweck und Abgrenzung

Der Generator erzeugt ein Three.js-unabhängiges, vollständig serialisierbares Weltmodell für die künstliche Testwelt. Er verändert weder die echte Erde noch deren Datenartefakte. Rendering, UI und hierarchisches Chunk-LOD bleiben ausdrücklich Folge-Issues.

## Konfiguration

`createProceduralWorld` normalisiert und validiert folgende Parameter:

| Parameter            |              Standard | Gültiger Bereich                   |
| -------------------- | --------------------: | ---------------------------------- |
| `seed`               | `hexagon-universalis` | 1–128 Zeichen                      |
| `density`            |            `standard` | `low`, `standard`, `high`, `ultra` |
| `landFraction`       |                `0.38` | `0.20`–`0.75`                      |
| `continentScale`     |                `1.35` | `0.5`–`4.0`                        |
| `elevationVariation` |                `0.32` | `0.0`–`1.0`                        |
| `climateScale`       |                 `2.4` | `0.5`–`8.0`                        |
| `mountainStrength`   |                `0.42` | `0.0`–`1.0`                        |

Unterstützte Dichteprofile verwenden ausschließlich gültige geodätische Frequenzen:

| Profil     | Frequenz | Tatsächliche Zellen |
| ---------- | -------: | ------------------: |
| `low`      |        4 |                 162 |
| `standard` |        8 |                 642 |
| `high`     |       16 |               2.562 |
| `ultra`    |       16 |               2.562 |

Das experimentelle Profil `ultra` erhöht nicht die Referenzweltfrequenz,
sondern die sichtbereichsgechunkte LOD-Detailadressierung. Dadurch bleiben
Seed-Fingerprints und Weltwerte mit einem kontrollierten f16-Arbeitssatz
deterministisch, während die feinste Renderstufe ungefähr 200.000 Zellen
adressieren kann.

## Verfahren

- Seed-Hashing und geglättetes dreidimensionales Value Noise sind projektintern implementiert.
- Mehrere fBm-Frequenzbänder erzeugen Kontinente, lokale Höhenvariation, Gebirgsrücken, Temperatur und Feuchtigkeit.
- Noise wird direkt an normalisierten 3D-Zellmittelpunkten abgetastet. Dadurch gibt es weder eine Längengradnaht noch polare Sonderfälle.
- Der gewünschte Landanteil bestimmt eine Quantilschwelle des zusammenhängenden Höhenfeldes.
- Temperatur berücksichtigt Breitengrad und Höhenabnahme; Feuchtigkeit wird im versionierten Klimamodul aus Küstennähe, Seen, Einzugsgebieten, Gebirgsaufstieg und Regenschatten abgeleitet.
- Tile-Typen und Modifikatoren werden deterministisch aus Wasserstand, Höhe, Temperatur, Feuchtigkeit und Nachbarschaft abgeleitet.
- Alle öffentlichen Fließkommawerte werden auf sechs Dezimalstellen stabilisiert. Zellen werden vor Ausgabe kanonisch nach ID sortiert.

## Reproduzierbarkeit

Generatorformat `1` und Generatorversion `1.2.0` sind Teil des Weltmodells. Gleiche Version, Konfiguration und Topologie erzeugen dieselbe JSON-Reihenfolge und denselben Fingerprint. Änderungen am Algorithmus müssen die Generatorversion erhöhen, sofern vorhandene Seeds danach andere Welten erzeugen.

Folgende Referenz-Fingerprints werden durch Unit-Tests geschützt:

| Seed              | Dichte     | Fingerprint    |
| ----------------- | ---------- | -------------- |
| `reference-alpha` | `low`      | `pw1-245f9efa` |
| `reference-alpha` | `standard` | `pw1-f493331d` |
| `reference-beta`  | `low`      | `pw1-59ec331e` |
| `reference-beta`  | `standard` | `pw1-5fa17418` |

## Fachliche Ausgabe pro Zelle

Jede Zelle enthält stabile ID, Zentrum, Nachbarschaften, Pentagon-/Hexagonstatus, normalisierte Höhe beziehungsweise Tiefe, Land-/Wasser- und Küstenstatus, Temperatur, Feuchtigkeit, Küstendistanz, Wassernähe, Regenschatten, visuellen Tile-Typ, Relief-/Schnee-/Eismodifikatoren, Reliefband, Hydrologie und Qualitätsflags.

Das Modell importiert keine Three.js-Typen und kann direkt mit `JSON.stringify` serialisiert werden.

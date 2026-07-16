# Prozedurales Klima und Biomklassifikation (#105)

Die Klimafelder werden in `src/world/proceduralClimate.ts` zentral und
deterministisch aus den stabilen Zellmittelpunkten, der Reliefstruktur und der
Hydrologie abgeleitet. Die Berechnung ist unabhängig von Zellindex und
Renderer; LOD-Stufen greifen über `ProceduralWorldLod.sampleAt` auf dieselben
Referenzwerte zu.

## Klimafelder

Jede Weltzelle veröffentlicht:

- `temperature`: Breitengrad und Höhe bestimmen den Hauptverlauf; begrenztes
  Seed-Noise liefert regionale Variation. Wasserzugang moderiert die Werte.
- `moisture`: Küstennähe, Seen, Abflussakkumulation und orographischer Aufstieg
  erhöhen die Feuchte. Binnenbecken und der Lee-Anteil einer Gebirgskette
  erzeugen kontrollierte Trockenheit.
- `coastDistance`: normalisierte Nachbarschaftsdistanz zur Ozeanküste
- `waterProximity`: normalisierte Nähe zu Ozean oder See
- `rainShadow`: diagnostischer Lee-Anteil der zugeordneten Gebirgskette

Die Schwellenwerte und die Statistik werden als `world.climate` ausgegeben und
gehen in den Welt-Fingerprint ein. Der aktuelle Klimastand ist Version `1`;
Änderungen an Faktoren oder Schwellenwerten erfordern eine neue Generator-
Version beziehungsweise neue Referenz-Fingerprints.

## Biomregeln

Die Reihenfolge priorisiert Wasser, Eis, Schnee, Hochgebirge, Küsten, Seen und
Feuchtgebiete. Danach folgen tropische und gemäßigte Wälder, Savanne,
Wüsten-/Halbwüsten-, boreale und offene Graslandklassen. Ein See bleibt im
geographischen Oberflächenfeld eine Landzelle, erhält aber `waterFeature:
'lake'` und die visuelle Klasse `wetland`, weil der bestehende Tile-Katalog
keine separate Seegeometrie benötigt.

Die Klimazellen enthalten keine Zufallszustände und keine Laufzeit-Wetter-
simulation. Damit bleiben Chunkgrenzen, Pole und Datumsgrenze bei gleichen
Referenzproben reproduzierbar.

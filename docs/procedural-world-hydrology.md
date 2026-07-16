# Prozedurale Hydrologie (#104)

`src/world/hydrology.ts` berechnet pro Weltzelle eine deterministische
Abflusskante zum niedrigsten geeigneten Nachbarn. Die Kanten sind wegen der
strikt fallenden Höhen azyklisch; lokale Plateaus und Senken bleiben als
explizite Endpunkte erhalten. Die Akkumulation wird anschließend in absteigender
Höhenreihenfolge propagiert.

Makro-Binnenbecken aus #101 liefern zusätzliche lokale See-Kandidaten, wenn
ihre tiefsten Landnachbarn eine zusammenhängende Mindestfläche erreichen. Der
Wasserspiegel liegt relativ zur Senke, die See-ID wird aus Seed und räumlich
quantisiertem Senkenzentrum erzeugt. So bleibt sie bei nahen LOD-Abtastungen
stabiler als eine reine Zellindex-ID. Ein See besitzt Fläche, Pegel,
Einzugsgebiets-ID, optionalen Überlaufpunkt und Endorheie-Markierung.

Die Weltzellen unterscheiden `waterFeature: 'land' | 'lake' | 'ocean'`.
Ozeanzellen erhalten weder Abflusskante noch See-ID; bestehende Oberfläche,
Küste und Terrainfarben bleiben unverändert. Alle Hydrologiedaten sind
serialisierbare Weltmodellwerte und enthalten keine Three.js-Objekte.

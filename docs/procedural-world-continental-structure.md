# Prozedurale Kontinental-, Schelf- und Beckenstruktur (#101)

Die Großgeographie wird aus einem deterministischen Makrofeld auf der
Einheitskugel abgeleitet. `src/world/continentalStructure.ts` erzeugt pro Seed
fünf große Kontinentkeime, sieben separate Inselgruppen und vier Ozeanbecken.
Jeder Keim besitzt eine Richtung, einen geodätischen Einflussradius und eine
Stärke. Die Parameter werden ausschließlich aus dem Seed gehasht.

## Feld und Klassifikation

Das Landfeld kombiniert den stärksten Kontinent- und Inselseinfluss und zieht
den stärksten Beckeneinfluss ab. Mehrskaliges Rauschen verändert nur die
Küstenform und lokale Reliefwerte; es entscheidet nicht allein über Land oder
Wasser. Dadurch bleibt dieselbe räumliche Position über unterschiedliche
Topologiefrequenzen an dasselbe Makrofeld gebunden.

Die konfigurierte Landquote bestimmt weiterhin den Klassifikationsquantilwert.
Einzelland- oder Einzelwasserzellen werden anschließend über die fachlichen
Nachbarschaften entfernt. Schelfzonen markieren das kontinuierliche Band nahe
der Küste; Binnenbecken werden aus starkem Beckeneinfluss innerhalb einer
Landfläche diagnostiziert.

Jede `ProceduralWorld`-Instanz veröffentlicht zusätzlich die serialisierbare
`macroStructure`-Diagnose mit allen Keimen. Zellen tragen
`macroRegion`, `isShelf` und `isInlandBasin`. Diese Werte sind weltmodellseitig
und enthalten keine Three.js- oder Renderdaten.

## Grenzen

Die Struktur ist bewusst keine physikalische Plattentektonik. Gebirge,
Hydrologie, Seen und Klimaklassifikation verwenden die Makrofelder in ihren
Folge-Issues, ändern aber nicht deren fachliche Quelle. Datumsgrenze und Pole
bleiben normale Punkte der Kugel; es gibt keine Sonderfall- oder Nahtlogik.


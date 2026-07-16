# Prozedurale Gebirgsketten und Höhenfelder (#102)

`src/world/mountainStructure.ts` leitet das Reliefgerüst aus der
Makrostruktur von #101 ab. Für jeden großen Kontinent werden deterministische
geodätische Korridore erzeugt; zusätzlich entstehen drei Inselbögen. Die
Korridore unterscheiden kontinentale Randketten, innere Faltengebirge,
Hochländer und Inselbögen.

Jede Achse besitzt eine Länge, eine Querbreite und eine Stärke. Das Höhenfeld
verwendet die Distanz zur Achse für ein glattes Querprofil und ein
seedstabiles Detailfeld für die Gipfelvariation entlang der Kette. Der
Einfluss wird nur auf Landflächen in die positive Reliefhöhe übernommen;
Ozeanbecken bleiben separat negativ.

`ProceduralWorld.mountainStructure` serialisiert alle Achsen. Zellen
veröffentlichen `mountainRangeId` und `mountainInfluence`, sodass Tests und
spätere Gameplay-/Kartendiagnostik die Kohärenz der Gebirgsgürtel prüfen
können. Die LOD-Runtime verwendet weiterhin dieselben räumlichen Zellwerte und
fügt keine indexabhängigen Gipfel hinzu.

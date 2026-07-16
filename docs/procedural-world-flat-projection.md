# Prozedurale Welt: lokaler Flat-Nahbereich (#108)

Die fachlichen Zellzentren, Nachbarschaften und Picking-IDs bleiben sphärisch. Sobald `local`
oder `detail` eine mittlere Zellgröße von mindestens `32 px` erreicht, erzeugt der Renderer aus
dem Kamerafokus eine deterministische lokale Ost-Nord-Hoch-Basis. Die Kugelkrümmung wird in
dieser Basis radial als Bogenlänge abgebildet; Relief, Terrainobjekte und sichtbare Zellflächen
verwenden dieselbe lokale Hochachse.

Beim Herauszoomen schaltet die Projektion erst unter `24 px` zur Kugel zurück. Ein Fokuswechsel
von mehr als `6°` bereitet eine neue Basis vor. Der Projektionsaustausch verwendet die bestehende
atomare Chunk-Aktualisierung: Die neue Geometrie wird vollständig aufgebaut, bevor sie aktiviert
wird; der alte Zustand darf während der kurzen Übergangszeit sichtbar bleiben. Der
Sicherheitsradius beträgt `14°` und wird in #109 durch die spielbare Breitengradregel ergänzt.

Die Projek­tionsdomäne in `src/topology/lod/projection.ts` ist Three.js-unabhängig und bietet
orthonormale Frames, Vorwärts-/Diagnose-Rückprojektion, Hysterese und Generationsnummern. Das
Canvas veröffentlicht dafür `data-projection-mode`, `data-projection-generation`,
`data-projection-reason` und `data-projection-center`. Ein Wechsel der Basis ändert nur
Renderdaten; fachliche Weltwerte und Zell-IDs bleiben unverändert.

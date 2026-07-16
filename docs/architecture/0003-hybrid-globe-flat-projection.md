# ADR 0003: Hybride Globe-/Flat-Projektion für den Nahbereich

- Status: Angenommen
- Datum: 2026-07-16
- Betrifft: `src/topology/lod/`, `src/rendering/`, Kamera, Picking, Relief und #108/#109
- Baut auf: [ADR 0002](./0002-seven-level-world-lod.md)

## Kontext

ADR 0002 trennt die fachliche siebenstufige Welt-LOD-Auswahl von der
Renderprojektion. Die Chunkauswahl liefert sphärische Zellzentren,
Zellgrenzen, IDs, Weltwerte und projektionsneutrale `WorldLodChunkAddress`-
Werte. Global bis `subregional` sind globe-only; `local` und `detail` dürfen
zusätzlich als lokale flache Nahansicht gerendert werden.

Die Flat-Nahansicht soll die sichtbare Krümmung im spielnahen Maßstab
entfernen, ohne das Weltmodell zu verändern. Fachliche Identitäten,
Nachbarschaften, Generatorwerte, Hydrologie, Grenzen und spätere
Gameplayregeln bleiben auf der Kugel definiert. Die lokale Ebene ist eine
abgeleitete Renderdarstellung um den Kamerafokus.

Die Architektur muss außerdem mit ungefähr 200.000 adressierbaren Zellen,
gechunkter Materialisierung, stufenabhängigem Relief, Picking und optionalen
spielbaren Breitengradgrenzen kompatibel sein.

## Entscheidung

### Projektionsmodell

Gewählt wird eine lokale Ost-Nord-Hoch-Projektion über die sphärische
Logarithmusabbildung am Fokuspunkt. Für einen normierten sphärischen Fokus
`f` und einen normierten Punkt `p` auf der Kugel gilt:

```text
up    = normalize(f)
east  = normalize(cross(worldNorth, up))
north = normalize(cross(up, east))
theta = acos(clamp(dot(up, p), -1, 1))
axis  = normalize(p - up * dot(up, p))
x     = theta * dot(axis, east)  * radius
y     = theta * dot(axis, north) * radius
z     = reliefAlongLocalUp
```

Der Spezialfall nahe den Polen verwendet eine deterministische Ersatzachse:
Wenn `abs(dot(worldNorth, up)) > 0,985`, wird `worldEast = (1, 0, 0)` als
Referenz für `east` verwendet. Dadurch bleiben Ost-, Nord- und Hochachse auch
an hohen Breitengraden orthonormal und deterministisch. Die optionale
spielbare Polbegrenzung aus #109 reduziert Verzerrung im Produkt, ist aber
keine Voraussetzung für mathematische Robustheit.

Die logarithmische Abbildung erhält den Projektionsmittelpunkt exakt im
lokalen Ursprung. Geodätische Distanzen vom Fokus werden radial im lokalen
Koordinatensystem als `radius × theta` dargestellt. Winkel und Flächen werden
mit wachsender Entfernung verzerrt; deshalb besitzt die Flat-Ansicht einen
dokumentierten Gültigkeitsradius.

### Gültigkeitsradius und Verzerrung

Die Flat-Projektion darf nur für Chunkflächen aktiviert werden, deren
sphärischer Abstand vom aktuellen Projektionszentrum höchstens `12°` beträgt.
Die Rezentrierungsschwelle liegt bei `6°`, die Rückkehr- beziehungsweise
Abbruchschwelle bei `14°`. Damit gelten getrennte Werte für:

- **Nutzradius `12°`:** normale sichtbare Flat-Geometrie.
- **Rezentrierung `6°`:** sobald der Kamerafokus weiter vom aktuellen
  Projektionszentrum abweicht, wird eine neue Basis vorbereitet.
- **Sicherheitsradius `14°`:** Chunks außerhalb dieses Radius dürfen nicht
  planar gerendert werden; der Renderer bleibt beim letzten gültigen Zustand
  oder fällt auf Globe zurück.

Für einen Einheitsradius entspricht `12°` etwa `0,209` Kugelradien
Bogenlänge. Der Tangentialfehler gegenüber der Bogenlänge einer einfachen
gnomonischen Projektion wäre dort bereits rund `tan(12°) / 12° - 1 ≈ 1,5 %`.
Die gewählte Log-Abbildung hält radiale Distanzen vom Fokus exakt und
verschiebt die Verzerrung in Querabstände, was für einen fokussierten
Strategiespiel-Nahbereich günstiger ist.

### LOD- und Projektionsmodus

LOD-Auflösung und Projektion bleiben getrennte Zustände:

| Welt-LOD        | Projektion                     | Begründung                            |
| --------------- | ------------------------------ | ------------------------------------- |
| `global`        | Globe                          | vollständige Kugel und Pole sichtbar  |
| `continental`   | Globe                          | Großform und Orientierung             |
| `macroregional` | Globe                          | regionale Kugelkrümmung noch relevant |
| `regional`      | Globe                          | Übergangsstufe vor spielnahem Bereich |
| `subregional`   | Globe                          | höchste globe-only Referenz           |
| `local`         | Globe oder Flat                | Eintrittsstufe mit Hysterese          |
| `detail`        | Flat bevorzugt, Globe-Fallback | feinste Nahansicht                    |

Der Projektionscontroller verwendet eine eigene Hysterese:

- Eintritt in Flat nur bei `local` oder `detail`, wenn die projizierte
  mittlere Zellgröße mindestens `32 px` beträgt und der Fokus innerhalb des
  optionalen spielbaren Breitengradbereichs liegt.
- Rückkehr zu Globe, wenn die aktive Stufe gröber als `local` wird oder die
  projizierte mittlere Zellgröße unter `24 px` fällt.
- Ein Projektionswechsel invalidiert Rendergeometrie, aber nicht fachliche
  Chunkdaten, Topologie, Weltwerte oder Zell-IDs.

Damit kann #97 dieselbe Chunkauswahl liefern, während #108 daraus wahlweise
Globe- oder Flat-Vertexpositionen ableitet.

### Übergang

Gewählt wird ein harter, aber verdeckter Projektionswechsel mit atomarem
Geometrieaustausch und kurzer Crossfade-Option. Kontinuierliches Vertex-
Morphing wird nicht als erste Implementierung gewählt, weil es für jeden
Vertex gleichzeitig Globe- und Flat-Positionen sowie Mischzustände in Picking,
Bounds, Normalen und Relief erfordern würde.

Die sichtbare Regel lautet:

1. Neue Flat- oder Globe-Geometrie wird vollständig für dieselben fachlichen
   Chunkadressen aufgebaut.
2. Picking und Diagnose verweisen währenddessen weiter auf den letzten
   stabilen Zustand.
3. Der Renderer tauscht die sichtbare Projektion erst aus, wenn alle
   notwendigen Chunks geschlossen vorhanden sind.
4. Optional darf ein kurzer materialbasierter Crossfade höchstens zwei
   vollständige Projektionssätze halten; er darf keine gemischten Zellgrößen
   oder offenen Kanten zeigen.

### Rezentrierung

Der Flat-Modus speichert einen `projectionCenter` als normierten sphärischen
Fokus. Kamerabewegungen innerhalb von `6°` verwenden dieselbe lokale Basis.
Bei Überschreitung wird eine neue Basis aus dem aktuellen Kamerafokus
vorbereitet. Der Wechsel erfolgt erst, wenn alle weiterhin sichtbaren
Chunkadressen in der neuen Basis neu projiziert wurden.

Rezentrierung ist damit ein Renderinvalidierungsgrund:

- fachliche Chunks bleiben gültig, wenn ihre `WorldLodChunkAddress` weiterhin
  aktiv ist;
- Flat-Vertexpositionen, Bounds, Normalen, Detailinstanzen und Picking-
  Beschleunigungsstrukturen werden neu abgeleitet;
- alte Projektionspuffer werden nach erfolgreichem Austausch freigegeben;
- veraltete asynchrone Ergebnisse tragen eine Generationsnummer und dürfen
  den aktuellen Projektionszustand nicht überschreiben.

### Relief und Tile-Geometrie

Fachliche Elevation bleibt projektionsneutral. In Globe-Projektion verschiebt
Relief entlang der radialen Hochachse des jeweiligen Zellpunkts. In Flat-
Projektion verschiebt Relief entlang der gemeinsamen lokalen `up`-Achse des
Projektionszentrums. Die in #100 definierte Reliefkurve liefert nur den
Skalierungsfaktor; die Projektionsschicht entscheidet die konkrete Hochachse.

Deckflächen müssen die fugenlose Geometrie aus #99 verwenden. Benachbarte
Zellgrenzen werden aus denselben sphärischen Grenzpunkten projiziert; dadurch
bleiben Kanten innerhalb einer numerischen Toleranz von `1e-6` Kugelradien
deckungsgleich. Unterschiedliche Höhen erzeugen geschlossene Seitenflächen
zwischen den projizierten Grenzpunkten und ihren reliefverschobenen Punkten.

### Picking

Picking bleibt zell-ID-orientiert:

1. Der Renderer raycastet gegen die aktuell sichtbare Globe- oder Flat-
   Geometrie.
2. Jedes Dreieck trägt weiterhin die levelqualifizierte sphärische Zell-ID.
3. Ein Treffer liefert Zell-ID, sphärisches Zellzentrum, fachliche Weltwerte
   und optional die lokale Renderposition.
4. Beim Projektionswechsel bleibt eine bestehende Auswahl gültig, solange die
   Zell-ID in der aktiven Chunkauswahl enthalten ist.

Die inverse Flat-Projektion dient Diagnose und Fokusnavigation, aber nicht zur
Neuerfindung fachlicher Nachbarschaften. Weltwerte werden nie aus lokalen
Koordinaten abgeleitet.

### Schnittstellenvertrag für #108

#108 soll folgende Three.js-unabhängige Domänenwerte einführen:

```ts
type WorldLodProjectionMode = 'globe' | 'flat';

interface LocalTangentFrame {
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  readonly east: { readonly x: number; readonly y: number; readonly z: number };
  readonly north: { readonly x: number; readonly y: number; readonly z: number };
  readonly up: { readonly x: number; readonly y: number; readonly z: number };
  readonly radius: number;
}

interface WorldLodProjectionState {
  readonly mode: WorldLodProjectionMode;
  readonly levelName: WorldLodLevelName;
  readonly frame: LocalTangentFrame | null;
  readonly generation: number;
  readonly reason:
    | 'level-change'
    | 'focus-recenter'
    | 'projection-hysteresis'
    | 'latitude-limit'
    | 'configuration-change';
}
```

Diese Werte referenzieren `WorldLodLevelName` und
`WorldLodChunkAddress` aus ADR 0002, enthalten aber keine Three.js-Objekte.
Renderer, Picking und Diagnose dürfen daraus konkrete Buffer, Bounds und
DOM-Attribute ableiten.

### Pole und spielbarer Bereich

Die Architektur unterstützt, aber erzwingt nicht, eine spielbare
Breitengradgrenze. #109 soll eine zentrale Produktregel definieren, zum
Beispiel `75°` bis `80°` Nord/Süd. Außerhalb dieses Bereichs wird Flat nicht
aktiviert; Globe bleibt weiterhin vollständig einschließlich beider Pole
verfügbar. Die mathematische Projektion bleibt auch an hohen Breitengraden
definiert, damit die Polregel keine Renderingfehler verdeckt.

## Alternativen

### A: Gnomonische Tangentialebene

Gnomonische Projektion bildet Großkreise als Geraden ab und ist einfach mit
Ray-/Ebene-Intuition kombinierbar. Sie verzerrt Distanzen jedoch bereits bei
moderaten Winkeln stärker und divergiert bei `90°`. Für einen begrenzten
Nahbereich wäre sie möglich, aber die Distanzwahrnehmung vom Fokus ist
schlechter als bei der Log-Abbildung. Verworfen.

### B: Orthographische Projektion auf Tangentialachsen

Orthographisch ist stabil und günstig, komprimiert aber Entfernungen zum Rand
des Nahbereichs. Lokale Zellgrößen würden mit Fokusabstand sichtbar schrumpfen.
Für Diagnosebilder geeignet, aber nicht als spielnahe Kartenansicht. Verworfen.

### C: Sphärische Log-Abbildung in Ost-Nord-Hoch-Koordinaten

Die gewählte Lösung erhält radiale geodätische Distanzen vom Fokus, besitzt
einen klaren Gültigkeitsradius, lässt sich deterministisch aus einem Fokus
ableiten und trennt fachliche Kugeldaten sauber von Renderkoordinaten.
Gewählt.

### D: Kontinuierliches Morphing zwischen Globe und Flat

Morphing kann visuell attraktiv sein, verdoppelt aber zunächst Vertexdaten,
Bounds, Normalen- und Pickingzustände und macht Zwischenzustände fachlich
schwerer testbar. Für eine spätere visuelle Verbesserung möglich, aber nicht
als erste robuste Architektur. Verworfen.

### E: Harter Wechsel mit vollständigem Neuaufbau ohne Crossfade

Technisch am einfachsten, kann aber bei hoher Dichte sichtbare Sprünge oder
kurze leere Zustände erzeugen. Nur zulässig, wenn der Austausch atomar erfolgt
und die alte Projektion sichtbar bleibt, bis die neue geschlossen bereitsteht.
Als Implementierungsuntergrenze akzeptiert.

## Konsequenzen

Positiv:

- Weltmodell, Chunks, Zell-IDs und Generator bleiben sphärisch und
  deterministisch.
- `local` und `detail` können denselben fachlichen Chunkbestand als Globe oder
  Flat rendern.
- #100 kann Relief projektionsneutral skalieren; #108 entscheidet nur die
  Hochachse.
- #109 kann Flat produktseitig an Breitengrade koppeln, ohne Pole aus dem
  Modell zu entfernen.
- Picking und Auswahl bleiben über Projektionswechsel anhand stabiler Zell-IDs
  erhalten.

Zu tragende Risiken:

- Rezentrierung erzeugt Renderarbeit und benötigt klare Generations- und
  Dispose-Regeln.
- Querabstände in der Log-Abbildung verzerren mit Fokusentfernung; der
  `12°`-Radius muss in #108 visuell und per Diagnose geprüft werden.
- Crossfade darf keine doppelten aktiven Zellgrößen zeigen und zählt gegen
  temporäre GPU-Budgets.
- Flat-Detailinstanzen und Wasserflächen müssen dieselbe lokale Basis wie
  Terrain verwenden, sonst entstehen sichtbare Scherungen.

## Tests und Abnahme für Folge-Issues

#108 muss mindestens folgende automatisierte Tests ergänzen:

- identischer Fokus erzeugt dieselbe `LocalTangentFrame`;
- `east`, `north` und `up` sind orthonormal;
- der Fokuspunkt projiziert auf den lokalen Ursprung;
- Projektion und inverse Diagnoseabbildung bleiben innerhalb des
  Gültigkeitsradius endlich und ohne NaN/Infinity;
- benachbarte Zellkanten sind in Flat innerhalb `1e-6` deckungsgleich;
- Globe-/Flat-Hysterese flattert nicht an den Schwellen;
- Rezentrierung wird erst ab `6°` ausgelöst und tauscht Geometrie atomar;
- Picking liefert dieselbe Zell-ID vor und nach einem Projektionswechsel;
- außerhalb der von #109 konfigurierten Breitengrenze wird Flat nicht
  aktiviert, Globe aber weiter gerendert.

Manuelle Abnahme:

- denselben Küsten-, Gebirgs-, See- und Flachlandort in Globe und Flat
  vergleichen;
- mehrfach langsam und schnell über die Projektionsschwellen zoomen;
- Rezentrierung durch Fokusverschiebung auslösen;
- Datumsgrenze und hohe erlaubte Breiten prüfen;
- Screenshots für Globe, Übergang und Flat im PR zu #108 dokumentieren.

## Abgrenzung

Diese ADR implementiert keinen Flat-Renderer und keine Kamerasperre. Sie
entscheidet ausschließlich Projektionsmodell, Gültigkeitsradius, Hysterese,
Rezentrierung, Pickingabbildung und den Vertrag zu ADR 0002. Die Umsetzung
erfolgt in #108; die spielbare Breitenbegrenzung folgt in #109.

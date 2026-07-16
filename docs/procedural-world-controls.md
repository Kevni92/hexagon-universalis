# Steuerung der prozeduralen Testwelt

Issue #79 ergänzt den Modus `?world=procedural` um ein rechtes, DOM-basiertes Bedienpanel. Die
Steuerung bleibt außerhalb des Three.js-Renderers: Sie übergibt ausschließlich eine typisierte
Seed-/Dichtekonfiguration an die App-Schnittstelle und erhält den aktiven Weltzustand zurück.

## Aktivierung und reproduzierbare URL

Die Standardkonfiguration ist unter folgender URL erreichbar:

```text
?world=procedural
```

Nach einer erfolgreichen Neugenerierung schreibt die App Seed und Dichte mit `history.replaceState`
in die aktuelle URL:

```text
?world=procedural&seed=hexagon-universalis&density=standard
```

Ein Reload reproduziert damit dieselbe Welt. Leere Seeds, Seeds mit mehr als 128 Zeichen und
unbekannte Dichtewerte aus einer URL werden auf die dokumentierte Standardkonfiguration
zurückgesetzt. Eingaben im Panel werden dagegen mit einer zugänglichen Fehlermeldung abgelehnt;
die bisherige gültige Welt bleibt sichtbar.

## Unterstützte Dichteprofile

| Profil                | ID         | globale Frequenz | tatsächliche globale Zellzahl |
| --------------------- | ---------- | ---------------: | ----------------------------: |
| Niedrig               | `low`      |                4 |                           162 |
| Standard              | `standard` |                8 |                           642 |
| Hoch                  | `high`     |               16 |                         2.562 |
| Ultra (experimentell) | `ultra`    |               16 |                         2.562 |

`ultra` verwendet dieselbe deterministische Referenzwelt wie `high`, aktiviert
aber in der LOD-Runtime eine experimentelle Detailstufe mit `f144 / 207.362`
global adressierbaren Zellen. Nur budgetierte sichtbare Chunks dürfen
materialisiert werden.

Das Panel bietet ausschließlich diese diskreten Profile an. Die feineren Regional-/Lokalbudgets
und ihre Zellzahlen sind in [procedural-world-lod.md](./procedural-world-lod.md) dokumentiert.

Beim Start einer Ultra-Neugenerierung werden die 32 initialen Detail-Chunks
asynchron vorbereitet. Währenddessen liegt ein halbtransparentes Loading-Overlay
über dem Viewport und zeigt den Chunkfortschritt. Erst nach erfolgreicher
Materialisierung wird das Overlay entfernt; beim anschließenden Zoomen werden
die vorbereiteten Detail-Chunks aus dem Cache verwendet.

## Zustands- und Lebenszyklusmodell

- Eingabewerte werden erst mit **Welt neu generieren** aktiv.
- Vor der Generierung wird der Seed getrimmt und erneut validiert.
- Synchron eintreffende Submit-Ereignisse werden zusammengefasst; nur die neueste Konfiguration
  erreicht den Renderer.
- Der Button und die Live-Region zeigen `generating`, `ready` oder `error` zugänglich an.
- Die neue Welt ersetzt die alte erst nach erfolgreicher Validierung und Materialisierung.
- LOD, Frequenz, Zellzahl und Fingerprint stammen aus dem aktiven Weltzustand. Renderframes
  überschreiben keine gerade bearbeiteten Formularwerte und verschieben den Fokus nicht.
- `dispose()` entfernt den Submit-Listener und verwirft noch ausstehende UI-Anfragen.

Der Erd-, Demo- und reine LOD-Diagnosemodus erzeugen das Panel nicht.

## Responsive Verhalten

Auf Desktop sitzt das Panel rechts oben, getrennt vom Projekttitel. Unter 700 Pixel Breite wird es
als touchfreundliches Bottom-Panel angezeigt. Eingaben und Primärbutton besitzen mindestens 44
Pixel hohe Ziele; Fokusrahmen bleiben sichtbar. Die einzige UI-Transition wird bei
`prefers-reduced-motion: reduce` deaktiviert.

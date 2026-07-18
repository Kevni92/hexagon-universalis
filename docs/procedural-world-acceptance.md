# Abnahme der prozeduralen Testwelt (#81)

Die prozedurale Testwelt ist unter `?world=procedural` erreichbar und bleibt
im UI als künstliche Welt gekennzeichnet. Seed und Dichte werden im rechten
Panel geändert und erst mit „Welt neu generieren“ übernommen; die URL kann
danach für eine deterministische Reload-Reproduktion verwendet werden.

## Automatisierte Abnahme

Die Produktions-Playwright-Suite `e2e/app.spec.ts` prüft:

- Laden der prozeduralen Welt ohne Browserkonsolenfehler
- Global → Regional → Lokal mit den erwarteten Frequenzen und Zellzahlen
- Relief, Wasser, Küste, Wald, trockene, kalte und feuchte Terrain-Gruppen
- Seed-/Dichtewechsel, Fingerprint-Reproduzierbarkeit und validierte Eingaben
- mobile Viewportgrenzen, stationäre/rotierende LOD-Budgets und Ultra-Preload

Die fachliche Referenzsuite prüft zusätzlich in Vitest Determinismus,
Geographie- und Hydrologiestruktur, Klimafelder, Terrainabdeckung,
LOD-Konsistenz und die siebenstufigen Ultra-Budgets.

## Nachweis

Vor dem Abschluss wurden lokal und in PR-CI ausgeführt:

```text
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run build
npm run test:e2e -- --workers=1
```

Die aktuelle Matrix umfasst 50 Unit-/Integrationstestdateien mit 276 Tests
und 15 Playwright-E2E-Tests. Produktionsbuild, PR-Quality-Check und Playwright
CI waren für die vorausgehenden Generator-, Hydrologie-, Klima- und Ultra-
Änderungen grün. Die vorhandenen Screenshots unter
`docs/screenshots/` dokumentieren die drei benannten LOD-Stufen; die
Arbeitsbudgets werden zusätzlich über Canvas-Diagnosedaten geprüft.

Bekannte Grenze: Die prozedurale Welt ist bewusst keine reale Erde. Der
Erdmodus und seine Datenartefakte bleiben vom Testweltmodus getrennt.

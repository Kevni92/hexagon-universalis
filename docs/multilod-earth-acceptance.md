# Multi-LOD earth acceptance report

## Scope and reference anchors

The production-build Playwright suite validates the GitHub Pages subpath, dataset and topology
fingerprints, and the checked-in anchors for Everest/Himalaya, Alps, Sahara, Amazon, Greenland,
Antarctica, ocean/antimeridian, and a European coast. The anchors cover mountain/highland,
desert, forest, snow/ice, deep water, and coast classes on all three data levels. The artificial
tile showcase is accepted separately through `?world=demo`.

This reference pyramid is deliberately small (8 cells per level, 17 gzip chunks, 7,061 bytes).
It verifies the full offline/runtime contract and named geographic anchors, but it is not a
cartographically complete country or coastline dataset. The 1815 source metadata remains marked
pending; acceptance does not invent missing historical polygons.

## Automated production scenarios

- Browser bootstrap and gzip decoding under `/hexagon-universalis/`.
- Valid format, topology fingerprint, source fingerprint, and dataset version.
- Repeated global-to-local zoom thresholds with bounded chunks, requests, cache, geometries, and
  textures.
- Circular drag/pole regression with zero roll and ±85° latitude cap.
- Chunk 404 interception with a degraded status and retained interactive geometry fallback.
- Desktop Chromium and Pixel 5 viewport profiles.
- Unit coverage for transition pairs, political parent aggregation, LOD border visibility,
  picking IDs, dispose, hierarchy, and resource ledgers.

## Budgets

| Metric                                     | Desktop | Mobile |
| ------------------------------------------ | ------: | -----: |
| Active geometry chunks / draw-call ceiling |      53 |     23 |
| Concurrent data requests                   |       4 |      4 |
| Decoded chunk cache                        |      24 |     24 |
| Earth artifact bytes                       |    8 MB |   8 MB |
| Textures used by cell renderer             |       0 |      0 |
| First visible target                       |     5 s |    5 s |
| Interactive target                         |     8 s |    8 s |

The chunk ceilings derive from one coarse remainder plus the profile limits (12 regional and 40
local on desktop; 6 and 16 on mobile). Runtime diagnostics are exposed read-only through
`window.__hexagonUniversalis.diagnostics()` for production acceptance and do not mutate state.

## Manual follow-up

After merge and a green `main` workflow, verify the deployed Pages URL in current desktop Chromium
and one physical touch device. Inspect every named anchor, rapid rotation while detail requests are
in flight, layer readability over relief, and GPU memory in browser developer tools. Complete
country-boundary visual acceptance remains contingent on replacing the pending 1815 source with a
licensed, georeferenced artifact.

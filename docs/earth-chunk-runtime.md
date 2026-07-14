# Earth chunk runtime

The standard `earth` mode loads `public/data/earth/v1/manifest.json`, validates format and
fingerprints, and then loads the single global chunk before applying data-driven terrain colors.
The artificial showcase remains available only through `?world=demo`; `?world=lod` keeps the
geometry-only LOD diagnostic mode.

Runtime limits are centralized in `EarthChunkRuntime`: at most four detail requests run in
parallel and the LRU cache retains at most 24 decoded chunks. Replacing the visible requirement
set aborts obsolete requests. A missing or corrupt detail chunk moves the runtime into a degraded
state without removing the already loaded global fallback; an incompatible manifest is a fatal,
user-visible error.

The checked-in reference pyramid currently contains 17 gzip chunks (7,061 compressed bytes in
total). Rendering remains one mesh/material per visible geometry chunk. The Three.js-independent
`EarthWorldModel` is the boundary between decoded data and rendering and can be serialized for
tests and diagnostics.

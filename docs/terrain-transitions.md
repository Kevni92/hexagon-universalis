# Neighbor terrain transitions

Transitions are deterministic, data-driven accents in an inner band along a shared cell edge.
They never change either primary tile type. The lexicographically first cell ID owns planning for
an edge, preventing mirrored duplicate instance sets across chunks.

| Source           | Suitable target                      | Accent      | Rule                 |
| ---------------- | ------------------------------------ | ----------- | -------------------- |
| forest           | grassland, cropland, savanna, steppe | source tree | compatible, thinning |
| boreal forest    | tundra, woodland tundra              | low conifer | limited              |
| grassland/steppe | steppe/semi-desert                   | grass       | limited              |
| desert           | semi-desert, bare rock               | rock        | limited              |
| mountain         | hill/flat land                       | rock        | limited              |
| snow/ice         | alpine rock, tundra                  | ice         | limited              |
| wetland          | open land, forest                    | low shrub   | compatible           |
| vegetation       | water or glacier                     | none        | excluded             |
| desert           | snow/ice                             | none        | excluded             |

LOD 0 emits no individual instances. The per-edge budgets for regional through close views are
2, 6, and 10 instances. Callers batch the returned `DetailType` values with the existing detail
instancing pipeline; profiles and results are plain serializable objects and can be cached by edge
ID, data version, and LOD.

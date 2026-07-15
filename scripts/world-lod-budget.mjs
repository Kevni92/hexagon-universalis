#!/usr/bin/env node

// Reproduzierbare Größenabschätzung für ADR 0002.
// Nutzung: node scripts/world-lod-budget.mjs

const FREQUENCIES = [8, 13, 21, 34, 55, 89, 144];
const BYTES_PER_VERTEX = 36; // float32 Position + Normale + Vertexfarbe

function cellCount(frequency) {
  return 10 * frequency ** 2 + 2;
}

function edgeCount(frequency) {
  return 60 * frequency ** 2;
}

function main() {
  console.log('frequency\tcells\tedges\treliefTriangles\trawGpuBytes\trawGpuMiB');
  for (const frequency of FREQUENCIES) {
    const cells = cellCount(frequency);
    const edges = edgeCount(frequency);
    const reliefTriangles = edges * 3;
    const rawGpuBytes = reliefTriangles * 3 * BYTES_PER_VERTEX;
    console.log(
      [
        frequency,
        cells,
        edges,
        reliefTriangles,
        rawGpuBytes,
        (rawGpuBytes / (1024 * 1024)).toFixed(2),
      ].join('\t'),
    );
  }
}

main();

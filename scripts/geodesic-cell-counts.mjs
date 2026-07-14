#!/usr/bin/env node
// Berechnet reproduzierbar die Zellzahl je geodätischer Frequenz.
// Formel: Zellen = 10 * f^2 + 2 (12 Pentagone + 10*(f^2-1) Hexagone).
// Nutzung: node scripts/geodesic-cell-counts.mjs [f1 f2 ...]

const DEFAULT_FREQUENCIES = [1, 2, 4, 8, 16, 32];

function cellCount(frequency) {
  if (!Number.isInteger(frequency) || frequency < 1)
    throw new RangeError(`frequency muss eine positive ganze Zahl sein: ${frequency}`);
  return 10 * frequency * frequency + 2;
}

function main() {
  const args = process.argv.slice(2).map(Number);
  const frequencies = args.length > 0 ? args : DEFAULT_FREQUENCIES;

  console.log('frequency\tcells\thexagons\tpentagons');
  for (const frequency of frequencies) {
    const cells = cellCount(frequency);
    console.log(`${frequency}\t${cells}\t${cells - 12}\t12`);
  }
}

main();

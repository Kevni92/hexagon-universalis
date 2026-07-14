import { TERRAIN_PALETTE } from './terrain';
import type { EarthTileCell, EarthTileChunk } from './tilePyramid';

/** Three.js-unabhaengige, serialisierbare Sicht auf geladene reale Erd-Zellen. */
export class EarthWorldModel {
  private readonly cellsById = new Map<string, EarthTileCell>();

  public applyChunk(chunk: EarthTileChunk): void {
    for (const cell of chunk.cells) this.cellsById.set(cell.cellId, cell);
  }

  public get size(): number {
    return this.cellsById.size;
  }

  public get(cellId: string): EarthTileCell | undefined {
    return this.cellsById.get(cellId);
  }

  public cellColors(): ReadonlyMap<string, string> {
    return new Map(
      [...this.cellsById.values()].map((cell) => [cell.cellId, TERRAIN_PALETTE[cell.terrainClass]]),
    );
  }

  public toJSON(): readonly EarthTileCell[] {
    return [...this.cellsById.values()].sort((left, right) =>
      left.cellId.localeCompare(right.cellId),
    );
  }
}

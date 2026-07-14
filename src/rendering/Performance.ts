export interface PerformanceBudget {
  readonly profile: 'low' | 'default';
  readonly frequency: number;
  readonly maxDrawCalls: number;
  readonly maxMaterials: number;
  readonly maxArtifactBytes: number;
}

export const PERFORMANCE_BUDGETS: Readonly<Record<'low' | 'default', PerformanceBudget>> = {
  low: {
    profile: 'low',
    frequency: 1,
    maxDrawCalls: 8,
    maxMaterials: 8,
    maxArtifactBytes: 2_000_000,
  },
  default: {
    profile: 'default',
    frequency: 2,
    maxDrawCalls: 8,
    maxMaterials: 8,
    maxArtifactBytes: 8_000_000,
  },
};

export interface ResourceCounts {
  readonly geometries: number;
  readonly materials: number;
  readonly textures: number;
  readonly listeners: number;
}

export class ResourceLedger {
  private counts: ResourceCounts = { geometries: 0, materials: 0, textures: 0, listeners: 0 };

  public allocate(kind: keyof ResourceCounts): void {
    this.counts = { ...this.counts, [kind]: this.counts[kind] + 1 };
  }
  public release(kind: keyof ResourceCounts): void {
    this.counts = { ...this.counts, [kind]: Math.max(0, this.counts[kind] - 1) };
  }
  public snapshot(): ResourceCounts {
    return { ...this.counts };
  }
  public assertNoGrowth(baseline: ResourceCounts): void {
    for (const kind of Object.keys(baseline) as (keyof ResourceCounts)[]) {
      if (this.counts[kind] > baseline[kind])
        throw new Error(`Ressourcenwachstum erkannt: ${kind}.`);
    }
  }
}

export function validatePerformanceBudget(
  budget: PerformanceBudget,
  artifactBytes: number,
  drawCalls: number,
  materials: number,
): void {
  if (artifactBytes > budget.maxArtifactBytes)
    throw new Error('Erdartefakt überschreitet das Größenbudget.');
  if (drawCalls > budget.maxDrawCalls) throw new Error('Draw-Call-Budget überschritten.');
  if (materials > budget.maxMaterials) throw new Error('Materialbudget überschritten.');
}

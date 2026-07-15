import { UniformViewportWorldLodController, type VisibleUnit } from '@/topology/lod/WorldLod';
import type { QualityProfile } from '@/topology/lod/profiles';
import type { CameraState } from '@/topology/lod/selection';

/** Schaltet die vollständige prozedurale Topologie viewportweit und exklusiv. */
export class ProceduralWorldLodController {
  private readonly controller: UniformViewportWorldLodController;

  public constructor(profile: QualityProfile) {
    this.controller = new UniformViewportWorldLodController(profile);
  }

  public update(camera: CameraState): readonly VisibleUnit[] {
    return this.controller.update(camera);
  }

  public get cacheStats(): {
    readonly cachedTopologies: number;
    readonly topologyBuilds: number;
  } {
    return this.controller.cacheStats;
  }

  public reset(): void {
    this.controller.reset();
  }
}

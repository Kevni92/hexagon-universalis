import * as THREE from 'three';

import type { Vector3 } from '@/topology/geodesic';
import type { CameraState } from '@/topology/lod/selection';

export interface CameraFrameInput {
  /** Weltrotation der Globus-Gruppe; die nordstabile Steuerung hält sie normalerweise auf Identität. */
  readonly worldQuaternion: THREE.Quaternion;
  /** Kameraposition in Weltkoordinaten. */
  readonly cameraPosition: THREE.Vector3;
  /** Kameraorientierung in Weltkoordinaten. */
  readonly cameraQuaternion: THREE.Quaternion;
  /** Vertikales Sichtfeld in Grad. */
  readonly fovDegrees: number;
  /** Seitenverhältnis Breite/Höhe. */
  readonly aspect: number;
  /** Viewport-Höhe in Pixel. */
  readonly viewportHeight: number;
  /** Kugelradius der Welt. */
  readonly sphereRadius: number;
}

/**
 * Drückt die Kamera im **lokalen, unrotierten** Koordinatensystem der
 * Globus-Gruppe aus. Die nordstabile `GlobeControls`-Variante bewegt die
 * Kamera entlang einer Orbitbahn und lässt die Weltrotation auf Identität;
 * die inverse Weltrotation bleibt für bereits rotierte Hosts als robuste
 * Transformationsgrenze erhalten.
 */
export function computeLocalCameraState(input: CameraFrameInput): CameraState {
  const inverseWorld = input.worldQuaternion.clone().invert();
  const localPosition = input.cameraPosition.clone().applyQuaternion(inverseWorld);
  const localForward = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(input.cameraQuaternion)
    .applyQuaternion(inverseWorld)
    .normalize();

  return {
    position: toVector3(localPosition),
    forward: toVector3(localForward),
    fovY: THREE.MathUtils.degToRad(input.fovDegrees),
    viewportHeight: input.viewportHeight,
    sphereRadius: input.sphereRadius,
    aspect: input.aspect,
  };
}

function toVector3(vector: THREE.Vector3): Vector3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

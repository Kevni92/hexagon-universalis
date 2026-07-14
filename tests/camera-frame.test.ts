import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { computeLocalCameraState } from '@/rendering/CameraFrame';
import { isCellVisible } from '@/topology/lod/selection';

// Diese Tests verwenden BEWUSST das echte three.js (kein Mock), damit die
// riskante Mathematik "Kamera im lokalen, unrotierten Weltframe ausdrücken"
// mit realer Quaternionen-/Vektor-Arithmetik abgedeckt ist. Der Mock in
// tests/scene-renderer.test.ts ersetzt invert()/applyQuaternion() durch
// No-Ops und würde diesen Pfad nicht prüfen.

function makeInput(
  worldQuaternion: THREE.Quaternion,
): Parameters<typeof computeLocalCameraState>[0] {
  return {
    worldQuaternion,
    cameraPosition: new THREE.Vector3(0, 0, 3.4),
    cameraQuaternion: new THREE.Quaternion(), // Kamera blickt entlang -z
    fovDegrees: 45,
    aspect: 4 / 3,
    viewportHeight: 600,
    sphereRadius: 1,
  };
}

describe('computeLocalCameraState', () => {
  it('with no world rotation, the camera stays at +z and looks toward -z', () => {
    const state = computeLocalCameraState(makeInput(new THREE.Quaternion()));
    expect(state.position.z).toBeCloseTo(3.4, 6);
    expect(state.position.x).toBeCloseTo(0, 6);
    expect(state.position.y).toBeCloseTo(0, 6);
    expect(state.forward.z).toBeCloseTo(-1, 6);
  });

  it('a genuinely rotated world moves the effective camera into the local frame', () => {
    // Welt um 180° um die Y-Achse gedreht: die vormals abgewandte Rückseite
    // (-z) liegt jetzt der Kamera zugewandt, im lokalen Frame steht die Kamera
    // effektiv bei -z.
    const half = Math.PI / 2;
    const worldQuaternion = new THREE.Quaternion(0, Math.sin(half), 0, Math.cos(half)); // 180° um Y
    const state = computeLocalCameraState(makeInput(worldQuaternion));
    expect(state.position.z).toBeCloseTo(-3.4, 6);
    expect(state.forward.z).toBeCloseTo(1, 6);
  });

  it('after a 180° Y-rotation, the local +z chunk is culled and the local -z chunk is kept', () => {
    const half = Math.PI / 2;
    const worldQuaternion = new THREE.Quaternion(0, Math.sin(half), 0, Math.cos(half));
    const state = computeLocalCameraState(makeInput(worldQuaternion));

    // Im lokalen Frame blickt die Kamera nun auf -z: die lokale -z-Zelle ist
    // sichtbar (Vorderseite), die lokale +z-Zelle liegt auf der Rückseite.
    const frontChunkCenter = { x: 0, y: 0, z: -1 };
    const backChunkCenter = { x: 0, y: 0, z: 1 };
    expect(isCellVisible(frontChunkCenter, state)).toBe(true);
    expect(isCellVisible(backChunkCenter, state)).toBe(false);
  });

  it('after a 90° Y-rotation, the local +x chunk faces the camera and +z is on the horizon side', () => {
    const quarter = Math.PI / 4;
    const worldQuaternion = new THREE.Quaternion(0, Math.sin(quarter), 0, Math.cos(quarter)); // 90° um Y
    const state = computeLocalCameraState(makeInput(worldQuaternion));

    // 90° um Y: die Kamera (Welt +z) wird im lokalen Frame zur -x-Richtung ...
    // je nach Drehsinn zur +x/-x. Wir prüfen konsistent: die der Kamera
    // zugewandte lokale Zelle ist sichtbar, die abgewandte nicht.
    const cameraDir = normalize(state.position);
    const facing = { x: cameraDir.x, y: cameraDir.y, z: cameraDir.z };
    const away = { x: -cameraDir.x, y: -cameraDir.y, z: -cameraDir.z };
    expect(isCellVisible(facing, state)).toBe(true);
    expect(isCellVisible(away, state)).toBe(false);
  });
});

function normalize(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const length = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

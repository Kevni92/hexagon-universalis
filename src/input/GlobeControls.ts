import * as THREE from 'three';

import { clamp } from '@/shared/clamp';

export interface GlobeControlsOptions {
  rotateSpeed?: number;
  minDistance?: number;
  maxDistance?: number;
  zoomSpeed?: number;
  inertia?: boolean;
  damping?: number;
  zoomAdaptiveRotation?: boolean;
}

interface PointerPosition {
  x: number;
  y: number;
}

const DEFAULTS = {
  damping: 8,
  inertia: true,
  maxDistance: 8,
  minDistance: 2.2,
  rotateSpeed: 0.005,
  zoomSpeed: 0.002,
  zoomAdaptiveRotation: false,
} as const;

const PITCH_LIMIT = Math.PI / 2 - 0.01;
const WHEEL_LINE_HEIGHT = 16;
const WHEEL_PAGE_HEIGHT = 800;

export class GlobeControls {
  private readonly options: Required<GlobeControlsOptions>;
  private readonly pointers = new Map<number, PointerPosition>();
  private yaw = 0;
  private pitch = 0;
  private velocityYaw = 0;
  private velocityPitch = 0;
  private pinchDistance: number | null = null;
  private activePointerId: number | null = null;
  private lastPointer: PointerPosition | null = null;
  private disposed = false;

  public constructor(
    private readonly world: THREE.Object3D,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly element: HTMLElement,
    options: GlobeControlsOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
    if (this.options.minDistance >= this.options.maxDistance) {
      throw new RangeError('minDistance muss kleiner als maxDistance sein.');
    }

    this.setDistance(this.getCameraDistance() || this.options.minDistance);
    this.element.style.touchAction = 'none';
    this.element.addEventListener('pointerdown', this.handlePointerDown);
    this.element.addEventListener('pointermove', this.handlePointerMove);
    this.element.addEventListener('pointerup', this.handlePointerEnd);
    this.element.addEventListener('pointercancel', this.handlePointerEnd);
    this.element.addEventListener('lostpointercapture', this.handlePointerEnd);
    this.element.addEventListener('wheel', this.handleWheel, { passive: false });
    this.element.addEventListener('contextmenu', this.preventDefault);
    this.element.addEventListener('selectstart', this.preventDefault);
    window.addEventListener('blur', this.handleWindowBlur);
  }

  public update(deltaSeconds: number): void {
    if (this.disposed || !this.options.inertia || this.pointers.size > 0) return;
    if (Math.abs(this.velocityYaw) < 0.00001 && Math.abs(this.velocityPitch) < 0.00001) {
      this.velocityYaw = 0;
      this.velocityPitch = 0;
      return;
    }

    const seconds = Math.max(0, Math.min(deltaSeconds, 0.1));
    this.yaw += this.velocityYaw * seconds;
    this.pitch = clamp(this.pitch + this.velocityPitch * seconds, -PITCH_LIMIT, PITCH_LIMIT);
    this.applyRotation();

    const damping = Math.exp(-this.options.damping * seconds);
    this.velocityYaw *= damping;
    this.velocityPitch *= damping;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearPointers();
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('pointerup', this.handlePointerEnd);
    this.element.removeEventListener('pointercancel', this.handlePointerEnd);
    this.element.removeEventListener('lostpointercapture', this.handlePointerEnd);
    this.element.removeEventListener('wheel', this.handleWheel);
    this.element.removeEventListener('contextmenu', this.preventDefault);
    this.element.removeEventListener('selectstart', this.preventDefault);
    window.removeEventListener('blur', this.handleWindowBlur);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.disposed || (event.pointerType === 'mouse' && event.button !== 0)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) {
      this.activePointerId = event.pointerId;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.velocityYaw = 0;
      this.velocityPitch = 0;
    } else if (this.pointers.size === 2) {
      this.pinchDistance = this.getPinchDistance();
      this.activePointerId = null;
      this.lastPointer = null;
    }
    this.element.setPointerCapture?.(event.pointerId);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size >= 2) {
      const distance = this.getPinchDistance();
      if (this.pinchDistance !== null)
        this.zoom((this.pinchDistance - distance) * this.options.zoomSpeed);
      this.pinchDistance = distance;
      return;
    }

    if (this.activePointerId !== event.pointerId || this.lastPointer === null) return;
    const deltaX = event.clientX - this.lastPointer.x;
    const deltaY = event.clientY - this.lastPointer.y;
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.rotate(deltaX, deltaY, 1 / 60);
  };

  private readonly handlePointerEnd = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return;
    if (event.type === 'pointercancel' || event.type === 'lostpointercapture') {
      this.clearPointers();
      return;
    }
    this.pointers.delete(event.pointerId);
    if (this.pointers.size === 0) {
      this.clearPointers();
    } else if (this.pointers.size === 1) {
      const pointer = [...this.pointers.entries()][0];
      if (pointer === undefined) return;
      const [pointerId, position] = pointer;
      this.activePointerId = pointerId;
      this.lastPointer = { ...position };
      this.pinchDistance = null;
    }
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.zoom(normalizeWheelDelta(event) * this.options.zoomSpeed);
  };

  private readonly handleWindowBlur = (): void => this.clearPointers();

  private readonly preventDefault = (event: Event): void => event.preventDefault();

  private rotate(deltaX: number, deltaY: number, deltaTime: number): void {
    const distanceScale = this.options.zoomAdaptiveRotation
      ? rotationScaleForDistance(this.getCameraDistance())
      : 1;
    const scaledRotateSpeed = this.options.rotateSpeed * distanceScale;
    this.yaw += deltaX * scaledRotateSpeed;
    this.pitch = clamp(this.pitch + deltaY * scaledRotateSpeed, -PITCH_LIMIT, PITCH_LIMIT);
    this.velocityYaw = (deltaX * scaledRotateSpeed) / deltaTime;
    this.velocityPitch = (deltaY * scaledRotateSpeed) / deltaTime;
    this.applyRotation();
  }

  private zoom(delta: number): void {
    const distance = clamp(
      this.getCameraDistance() + delta,
      this.options.minDistance,
      this.options.maxDistance,
    );
    this.setDistance(distance);
  }

  private getCameraDistance(): number {
    const { x, y, z } = this.camera.position;
    return Math.hypot(x, y, z);
  }

  private setDistance(distance: number): void {
    this.camera.position.set(
      0,
      0,
      clamp(distance, this.options.minDistance, this.options.maxDistance),
    );
    this.camera.lookAt(0, 0, 0);
  }

  private applyRotation(): void {
    this.world.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')).normalize();
  }

  private getPinchDistance(): number {
    const positions = [...this.pointers.values()];
    const first = positions[0];
    const second = positions[1];
    if (first === undefined || second === undefined) return 0;
    return Math.hypot(first.x - second.x, first.y - second.y);
  }

  private clearPointers(): void {
    this.pointers.clear();
    this.activePointerId = null;
    this.lastPointer = null;
    this.pinchDistance = null;
  }
}

export function normalizeWheelDelta(event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>): number {
  const multiplier =
    event.deltaMode === 1 ? WHEEL_LINE_HEIGHT : event.deltaMode === 2 ? WHEEL_PAGE_HEIGHT : 1;
  return event.deltaY * multiplier;
}

export function rotationScaleForDistance(
  distance: number,
  sphereRadius = 1,
  referenceDistance = 3.4,
): number {
  const referenceSurfaceDistance = referenceDistance - sphereRadius;
  if (
    !Number.isFinite(distance) ||
    !Number.isFinite(sphereRadius) ||
    !Number.isFinite(referenceDistance) ||
    sphereRadius <= 0 ||
    referenceSurfaceDistance <= 0
  )
    throw new RangeError('Rotations-Distanzparameter sind ungültig.');
  const surfaceDistance = Math.max(0, distance - sphereRadius);
  return clamp(surfaceDistance / referenceSurfaceDistance, 0.08, 1);
}

import * as THREE from 'three';

import { clamp } from '@/shared/clamp';

export interface GlobeControlsOptions {
  rotateSpeed?: number;
  minDistance?: number;
  maxDistance?: number;
  zoomSpeed?: number;
  inertia?: boolean;
  damping?: number;
  maxLatitudeDegrees?: number;
  sphereRadius?: number;
  reliefReserve?: number;
  startDistance?: number;
  northAlignSpeed?: number;
}

export interface GlobeOrientation {
  readonly longitudeDegrees: number;
  readonly latitudeDegrees: number;
  readonly rollDegrees: 0;
}

interface PointerPosition {
  x: number;
  y: number;
}

const DEFAULTS = {
  damping: 8,
  inertia: true,
  rotateSpeed: 0.005,
  zoomSpeed: 0.002,
  maxLatitudeDegrees: 85,
  sphereRadius: 1,
  reliefReserve: 0.08,
  northAlignSpeed: 10,
} as const;

const WHEEL_LINE_HEIGHT = 16;
const WHEEL_PAGE_HEIGHT = 800;
const NORTH = new THREE.Vector3(0, 1, 0);
const EAST = new THREE.Vector3(1, 0, 0);

export class GlobeControls {
  private readonly options: Omit<
    Required<GlobeControlsOptions>,
    'minDistance' | 'maxDistance' | 'startDistance'
  > & {
    readonly minDistance: number;
    readonly maxDistance: number;
    readonly startDistance: number;
  };
  private readonly pointers = new Map<number, PointerPosition>();
  private longitude = 0;
  private latitude = 0;
  private roll = 0;
  private velocityYaw = 0;
  private velocityPitch = 0;
  private pinchDistance: number | null = null;
  private activePointerId: number | null = null;
  private lastPointer: PointerPosition | null = null;
  private disposed = false;
  private autoAligning = false;
  private readonly longitudeQuaternion = new THREE.Quaternion();
  private readonly latitudeQuaternion = new THREE.Quaternion();

  public constructor(
    private readonly world: THREE.Object3D,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly element: HTMLElement,
    options: GlobeControlsOptions = {},
  ) {
    const sphereRadius = options.sphereRadius ?? DEFAULTS.sphereRadius;
    const reliefReserve = options.reliefReserve ?? DEFAULTS.reliefReserve;
    const visibleRadius = sphereRadius + reliefReserve;
    const fovRadians = THREE.MathUtils.degToRad(this.camera.fov);
    const fitDistance = (visibleRadius / Math.sin(fovRadians / 2)) * 1.08;
    this.options = {
      ...DEFAULTS,
      ...options,
      sphereRadius,
      reliefReserve,
      minDistance: options.minDistance ?? visibleRadius + Math.max(0.08, sphereRadius * 0.08),
      maxDistance: options.maxDistance ?? sphereRadius * 8,
      startDistance: options.startDistance ?? fitDistance,
    };
    if (this.options.minDistance >= this.options.maxDistance) {
      throw new RangeError('minDistance muss kleiner als maxDistance sein.');
    }

    this.setDistance(this.options.startDistance);
    this.applyRotation();
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
    if (this.disposed || this.pointers.size > 0) return;
    const seconds = Math.max(0, Math.min(deltaSeconds, 0.1));
    if (!this.options.inertia) {
      this.alignNorth(seconds);
      return;
    }
    if (Math.abs(this.velocityYaw) < 0.00001 && Math.abs(this.velocityPitch) < 0.00001) {
      this.velocityYaw = 0;
      this.velocityPitch = 0;
      this.alignNorth(seconds);
      return;
    }

    this.longitude = wrapLongitude(this.longitude + this.velocityYaw * seconds);
    const nextLatitude = clamp(
      this.latitude + this.velocityPitch * seconds,
      -this.latitudeLimit,
      this.latitudeLimit,
    );
    if (
      nextLatitude === this.latitude &&
      Math.sign(this.velocityPitch) === Math.sign(this.latitude)
    )
      this.velocityPitch = 0;
    this.latitude = nextLatitude;
    this.applyRotation();

    const damping = Math.exp(-this.options.damping * seconds);
    this.velocityYaw *= damping;
    this.velocityPitch *= damping;
  }

  public get orientation(): GlobeOrientation {
    return {
      longitudeDegrees: THREE.MathUtils.radToDeg(this.longitude),
      latitudeDegrees: THREE.MathUtils.radToDeg(this.latitude),
      rollDegrees: 0,
    };
  }

  public get isNorthAligning(): boolean {
    return this.autoAligning;
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
      this.autoAligning = false;
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
      this.autoAligning = true;
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
    this.longitude = wrapLongitude(this.longitude + deltaX * this.options.rotateSpeed);
    this.latitude = clamp(
      this.latitude + deltaY * this.options.rotateSpeed,
      -this.latitudeLimit,
      this.latitudeLimit,
    );
    this.velocityYaw = (deltaX * this.options.rotateSpeed) / deltaTime;
    this.velocityPitch = (deltaY * this.options.rotateSpeed) / deltaTime;
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
    this.longitudeQuaternion.setFromAxisAngle(NORTH, this.longitude);
    this.latitudeQuaternion.setFromAxisAngle(EAST, this.latitude);
    this.world.quaternion
      .multiplyQuaternions(this.longitudeQuaternion, this.latitudeQuaternion)
      .normalize();
  }

  private alignNorth(deltaSeconds: number): void {
    if (!this.autoAligning) return;
    const damping = 1 - Math.exp(-this.options.northAlignSpeed * deltaSeconds);
    this.roll *= 1 - damping;
    if (Math.abs(this.roll) < 1e-6) {
      this.roll = 0;
      this.autoAligning = false;
    }
    this.applyRotation();
  }

  private get latitudeLimit(): number {
    return THREE.MathUtils.degToRad(clamp(this.options.maxLatitudeDegrees, 1, 89.9));
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

function wrapLongitude(value: number): number {
  const fullTurn = Math.PI * 2;
  return ((((value + Math.PI) % fullTurn) + fullTurn) % fullTurn) - Math.PI;
}

export function normalizeWheelDelta(event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>): number {
  const multiplier =
    event.deltaMode === 1 ? WHEEL_LINE_HEIGHT : event.deltaMode === 2 ? WHEEL_PAGE_HEIGHT : 1;
  return event.deltaY * multiplier;
}

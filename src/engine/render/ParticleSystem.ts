import * as THREE from 'three';
import { TAU } from '../core/math';
import { PARTICLE_FRAGMENT, PARTICLE_VERTEX } from './shaders';

/**
 * GPU point-sprite particles backed by one preallocated, densely packed
 * buffer. Dead particles are swap-removed, so update cost scales with the
 * live count and nothing is ever allocated after construction. 'glow' particles add light (sparks, embers)
 * and shrink as they fade; 'dust' particles are blended over the scene, so coloured dust shows against bright
 * backgrounds, and billow out (growing) as they thin away.
 */
export class ParticleSystem {
  readonly points: THREE.Points;
  private count = 0;
  private readonly capacity: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly drag: Float32Array;
  private readonly gravity: Float32Array;
  private readonly attrs: THREE.BufferAttribute[];
  private readonly material: THREE.ShaderMaterial;
  private readonly billow: boolean;

  constructor(capacity: number, kind: 'glow' | 'dust' = 'glow') {
    this.capacity = capacity;
    this.billow = kind === 'dust';
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);

    const geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(this.pos, 3);
    const colAttr = new THREE.BufferAttribute(this.col, 3);
    const sizeAttr = new THREE.BufferAttribute(this.size, 1);
    const alphaAttr = new THREE.BufferAttribute(this.alpha, 1);
    this.attrs = [posAttr, colAttr, sizeAttr, alphaAttr];
    for (const a of this.attrs) a.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', posAttr);
    geometry.setAttribute('aColor', colAttr);
    geometry.setAttribute('aSize', sizeAttr);
    geometry.setAttribute('aAlpha', alphaAttr);
    geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      ...(kind === 'dust'
        ? {
            defines: { DUST: '' },
            blending: THREE.CustomBlending,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
          }
        : { blending: THREE.AdditiveBlending }),
      depthWrite: false,
      transparent: true,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  /** Keeps particle sizes in world units for the current viewport. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    r: number,
    g: number,
    b: number,
    size: number,
    life: number,
    drag: number,
    gravity: number,
  ): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.col[i3] = r;
    this.col[i3 + 1] = g;
    this.col[i3 + 2] = b;
    this.size[i] = size;
    this.alpha[i] = 1;
    this.baseSize[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.drag[i] = drag;
    this.gravity[i] = gravity;
  }

  /** Omnidirectional burst, flattened towards the play plane. */
  burst(
    x: number,
    y: number,
    color: THREE.Color,
    count: number,
    speed: number,
    size: number,
    life: number,
    gain = 1,
  ): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.25 + Math.random() * 0.75);
      const l = life * (0.5 + Math.random() * 0.5);
      // Emitted just behind the play plane and drifting away from the camera, so the ball stays in front.
      this.emit(
        x,
        y,
        -0.6,
        Math.cos(a) * s,
        Math.sin(a) * s,
        -Math.random() * s * 0.4,
        color.r * gain,
        color.g * gain,
        color.b * gain,
        size * (0.5 + Math.random() * 0.8),
        l,
        2.2,
        6,
      );
    }
  }

  /** Directional spray around a surface normal. */
  sparks(x: number, y: number, nx: number, ny: number, color: THREE.Color, count: number, speed: number): void {
    const base = Math.atan2(ny, nx);
    for (let i = 0; i < count; i++) {
      const a = base + (Math.random() - 0.5) * 2.2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.emit(
        x,
        y,
        -0.6,
        Math.cos(a) * s,
        Math.sin(a) * s,
        -Math.random() * s * 0.4,
        color.r * 1.1,
        color.g * 1.1,
        color.b * 1.1,
        0.14 + Math.random() * 0.12,
        0.18 + Math.random() * 0.25,
        3,
        10,
      );
    }
  }

  update(dt: number): void {
    const { pos, vel, col, size, alpha, life, maxLife, baseSize, drag, gravity } = this;
    if (dt > 0) {
      let i = 0;
      while (i < this.count) {
        life[i] -= dt;
        if (life[i] <= 0) {
          const last = --this.count;
          if (i !== last) {
            const i3 = i * 3;
            const l3 = last * 3;
            pos[i3] = pos[l3];
            pos[i3 + 1] = pos[l3 + 1];
            pos[i3 + 2] = pos[l3 + 2];
            vel[i3] = vel[l3];
            vel[i3 + 1] = vel[l3 + 1];
            vel[i3 + 2] = vel[l3 + 2];
            col[i3] = col[l3];
            col[i3 + 1] = col[l3 + 1];
            col[i3 + 2] = col[l3 + 2];
            life[i] = life[last];
            maxLife[i] = maxLife[last];
            baseSize[i] = baseSize[last];
            drag[i] = drag[last];
            gravity[i] = gravity[last];
          }
          continue;
        }
        const i3 = i * 3;
        const damp = Math.max(0, 1 - drag[i] * dt);
        vel[i3] *= damp;
        vel[i3 + 1] = vel[i3 + 1] * damp - gravity[i] * dt;
        vel[i3 + 2] *= damp;
        pos[i3] += vel[i3] * dt;
        pos[i3 + 1] += vel[i3 + 1] * dt;
        pos[i3 + 2] += vel[i3 + 2] * dt;
        const t = life[i] / maxLife[i];
        if (this.billow) {
          // Spreads to twice its size, holding thick at first and thinning away at the end.
          alpha[i] = Math.min(1, t * 1.6);
          size[i] = baseSize[i] * (2 - t);
        } else {
          alpha[i] = t;
          size[i] = baseSize[i] * (0.35 + 0.65 * t);
        }
        i++;
      }
    }

    this.points.geometry.setDrawRange(0, this.count);
    for (const attr of this.attrs) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.count * attr.itemSize);
      attr.needsUpdate = true;
    }
  }
}

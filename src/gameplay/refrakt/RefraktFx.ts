import * as THREE from 'three';
import { BALL } from '../config';
import type { ParticleSystem } from '../../engine/render/ParticleSystem';
import type { DebrisSystem } from '../bricks/DebrisSystem';
import type { ImpactFlashPool, ShockwavePool } from '../entities/EntityViews';

/** Rays of dispersed light at once (activation fan + shatter fans), on top of the ball flares. */
const RAY_CAPACITY = 256;
/** Spinning light spokes round each Refrakt ball. */
const FLARES_PER_BALL = 6;
/** Rays sit in front of the bricks (like the shockwave rings) so the light washes over the board. */
const RAY_Z = 0.62;

/**
 * A beam of light as a texture: brightest at its root and fading to nothing at the tip, with a hot white core
 * inside a softer coloured sheath, so a thin quad reads as a shaft of light rather than a stripe.
 */
function createBeamTexture(): THREE.DataTexture {
  const w = 128;
  const h = 32;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const across = (y / (h - 1)) * 2 - 1;
    const core = Math.exp(-((across * 7) ** 2));
    const sheath = Math.exp(-((across * 2.4) ** 2));
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const along = Math.min(1, u / 0.05) * Math.pow(1 - u, 1.4);
      const v = Math.min(1, along * (0.55 * sheath + core));
      const k = (y * w + x) * 4;
      data[k] = data[k + 1] = data[k + 2] = Math.round(v * 255);
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

interface Ray {
  x: number;
  y: number;
  angle: number;
  spin: number;
  length: number;
  width: number;
  color: THREE.Color;
  age: number;
  life: number;
  delay: number;
}

interface Pending {
  at: number;
  x: number;
  y: number;
  hue: number;
  radius: number;
  duration: number;
}

/**
 * Refrakt's light show: dispersed spectra fanning out of a broken prism and every brick the ball shatters,
 * a spinning star of coloured spokes and a halo round each Refrakt ball, rainbow ring cascades, and the
 * screen-edge spectrum and colour-split the renderer draws (read from `screenGlow` / `chroma` / `hue`).
 */
export class RefraktFx {
  /** Strength of the rainbow round the screen edges (0..1); the renderer reads it every frame. */
  screenGlow = 0;
  /** Momentary colour split of the whole frame, in screen-UV units. */
  chroma = 0;
  /** Current hue of the Refrakt light (0..1), shared with the ball, its trail and light. */
  hue = 0;

  private readonly rays: Ray[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly halos: THREE.Sprite[] = [];
  private readonly pending: Pending[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private readonly c = new THREE.Color();
  private clock = 0;
  /** 0..1: how far the ball aura has come up (eases in on activation and out after). */
  private aura = 0;
  /** Extra screen glow from recent events, decaying back to the steady level. */
  private pulse = 0;

  constructor(
    scene: THREE.Scene,
    glow: THREE.Texture,
    private readonly shockwaves: ShockwavePool,
    private readonly flashes: ImpactFlashPool,
    private readonly particles: ParticleSystem,
    private readonly debris: DebrisSystem,
  ) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0.5, 0, 0); // pivot at the beam's root
    const mat = new THREE.MeshBasicMaterial({
      map: createBeamTexture(),
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const capacity = RAY_CAPACITY + BALL.capacity * FLARES_PER_BALL;
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.count = 0;
    scene.add(this.mesh);

    for (let i = 0; i < BALL.capacity; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glow,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      sprite.visible = false;
      sprite.renderOrder = 9;
      this.halos.push(sprite);
      scene.add(sprite);
    }
  }

  /** A prism broke: the light explodes into a full spectrum. Everything here is over within REFRAKT.freeze. */
  start(x: number, y: number): void {
    // A wheel of dispersed light, the hues running once round it.
    const n = 44;
    for (let i = 0; i < n; i++) {
      const long = i % 2 === 0;
      this.addRay(
        x,
        y,
        (i / n) * Math.PI * 2 + Math.random() * 0.04,
        0.35,
        (long ? 9 : 5) + Math.random() * 5,
        0.35 + Math.random() * 0.35,
        this.c.setHSL(i / n, 1, 0.6).multiplyScalar(2.4),
        1 + Math.random() * 0.3,
        Math.random() * 0.06,
      );
    }
    // A cascade of rings, red outermost to violet, chasing each other out.
    for (let i = 0; i < 7; i++) this.later(i * 0.05, x, y, i / 7, 3 + i * 1.3, 0.7 + i * 0.04);
    this.flashes.spawn(x, y, 7, 0.7, 1.1);
    for (let i = 0; i < 12; i++) {
      this.particles.burst(x, y, this.c.setHSL(i / 12, 1, 0.6), 9, 16, 0.4, 0.9, 1.6);
      this.debris.spawn(x, y, this.c.setHSL(i / 12, 0.9, 0.62), 2, 9, 0.6, 0.35, 0, 0.2, 0.7);
    }
    this.pulse = 1;
    this.chroma = 0.014;
  }

  /** A Refrakt ball shattered a brick: a small prism fan of light out of it, rings and rainbow glass. */
  shatter(x: number, y: number, dirX: number, dirY: number): void {
    const base = dirX === 0 && dirY === 0 ? Math.random() * Math.PI * 2 : Math.atan2(dirY, dirX);
    const fan = 7;
    for (let i = 0; i < fan; i++) {
      const k = i / (fan - 1);
      const a = base + (k - 0.5) * 1.1 + (Math.random() - 0.5) * 0.08;
      this.addRay(
        x,
        y,
        a,
        0,
        2.8 + Math.random() * 2.2,
        0.28 + Math.random() * 0.12,
        this.c.setHSL(k * 0.82, 1, 0.6).multiplyScalar(2),
        0.42 + Math.random() * 0.15,
        0,
      );
    }
    // The fan points along the ball's travel; a faint back-spray keeps it from reading as a cone.
    for (let i = 0; i < 4; i++) {
      this.addRay(
        x,
        y,
        base + Math.PI + (Math.random() - 0.5) * 2,
        0,
        1.2 + Math.random(),
        0.2,
        this.c.setHSL(Math.random(), 1, 0.6).multiplyScalar(1.4),
        0.3,
        0,
      );
    }
    this.later(0, x, y, this.hue, 2.2, 0.38);
    this.later(0.05, x, y, (this.hue + 0.5) % 1, 3, 0.45);
    this.flashes.spawn(x, y, 2.6, 0.3, 0.6);
    for (let i = 0; i < 6; i++) {
      this.particles.burst(x, y, this.c.setHSL(i / 6, 1, 0.6), 3, 10, 0.3, 0.5, 1.4);
      this.debris.spawn(x, y, this.c.setHSL(i / 6, 0.9, 0.62), 1, 6, 0.5, 0.3, dirX, dirY, 0.6);
    }
    this.pulse = Math.min(1, this.pulse + 0.22);
    this.chroma = Math.max(this.chroma, 0.004);
  }

  /** Refrakt ran out: each ball lets its light go in a last soft spectrum. */
  end(balls: readonly { active: boolean; x: number; y: number }[]): void {
    for (const ball of balls) {
      if (!ball.active) continue;
      for (let i = 0; i < 12; i++) {
        this.addRay(
          ball.x,
          ball.y,
          (i / 12) * Math.PI * 2,
          -0.6,
          2.5 + Math.random() * 1.5,
          0.2,
          this.c.setHSL(i / 12, 1, 0.6).multiplyScalar(1.5),
          0.7,
          0,
        );
      }
      this.later(0, ball.x, ball.y, this.hue, 2.4, 0.6);
    }
  }

  /**
   * @param active whether Refrakt is on
   * @param ballPos interpolated position of ball i, or null when that ball is not in play
   */
  update(
    simDt: number,
    realDt: number,
    active: boolean,
    hue: number,
    ballPos: (i: number) => THREE.Vector3 | null,
  ): void {
    this.clock += simDt;
    this.hue = hue;
    this.aura += ((active ? 1 : 0) - this.aura) * Math.min(1, realDt * (active ? 5 : 3));
    if (this.aura < 0.003) this.aura = 0;
    this.pulse *= Math.exp(-realDt * 2.2);
    this.chroma *= Math.exp(-realDt * 6);
    if (this.chroma < 0.0002) this.chroma = 0;
    this.screenGlow = Math.min(1, this.aura * 0.32 + this.pulse * 0.9);

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const e = this.pending[i];
      e.at -= simDt;
      if (e.at > 0) continue;
      this.shockwaves.spawn(e.x, e.y, this.c.setHSL(e.hue, 1, 0.6).multiplyScalar(1.6), e.radius, e.duration);
      this.pending.splice(i, 1);
    }

    let n = 0;
    const colors = this.mesh.instanceColor as THREE.InstancedBufferAttribute;
    for (let i = this.rays.length - 1; i >= 0; i--) {
      const r = this.rays[i];
      if (r.delay > 0) {
        r.delay -= simDt;
        continue;
      }
      r.age += simDt;
      if (r.age >= r.life) {
        this.rays.splice(i, 1);
        continue;
      }
      r.angle += r.spin * simDt;
      const k = r.age / r.life;
      const grow = 1 - Math.pow(1 - Math.min(1, k / 0.22), 3); // shoots out fast...
      const fade = k < 0.35 ? 1 : 1 - (k - 0.35) / 0.65; // ...then dims
      this.write(n++, r.x, r.y, r.angle, r.length * grow, r.width * (1 - 0.4 * k), r.color, fade * fade);
    }

    // Each Refrakt ball: a halo in its current colour and a slowly spinning star of spectral spokes.
    for (let b = 0; b < this.halos.length; b++) {
      const pos = this.aura > 0 ? ballPos(b) : null;
      const halo = this.halos[b];
      halo.visible = pos !== null;
      if (!pos) continue;
      const beat = 0.5 + 0.5 * Math.sin(this.clock * 9 + b);
      halo.position.set(pos.x, pos.y, pos.z - 0.05);
      halo.scale.setScalar((1.6 + 0.5 * beat) * this.aura);
      halo.material.color.setHSL(hue, 1, 0.6).multiplyScalar(1.3 * this.aura);
      for (let f = 0; f < FLARES_PER_BALL; f++) {
        const a = this.clock * 2.4 + (f / FLARES_PER_BALL) * Math.PI * 2 + b * 0.7;
        const len = (1.3 + 0.7 * Math.sin(this.clock * 6 + f * 1.7)) * this.aura;
        this.c.setHSL((hue + f / FLARES_PER_BALL) % 1, 1, 0.6).multiplyScalar(1.7);
        this.write(n++, pos.x, pos.y, a, len, 0.2, this.c, this.aura, pos.z + 0.02);
      }
    }

    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    colors.needsUpdate = true;
  }

  /** Drops every effect in flight (a new level or a reset). */
  clear(): void {
    this.rays.length = 0;
    this.pending.length = 0;
    this.pulse = 0;
    this.chroma = 0;
    this.aura = 0;
    this.screenGlow = 0;
    this.mesh.count = 0;
    for (const halo of this.halos) halo.visible = false;
  }

  private write(
    i: number,
    x: number,
    y: number,
    angle: number,
    length: number,
    width: number,
    color: THREE.Color,
    gain: number,
    z = RAY_Z,
  ): void {
    this.p.set(x, y, z);
    this.q.setFromAxisAngle(this.zAxis, angle);
    this.s.set(Math.max(0.001, length), Math.max(0.001, width), 1);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    const colors = this.mesh.instanceColor as THREE.InstancedBufferAttribute;
    colors.setXYZ(i, color.r * gain, color.g * gain, color.b * gain);
  }

  private addRay(
    x: number,
    y: number,
    angle: number,
    spin: number,
    length: number,
    width: number,
    color: THREE.Color,
    life: number,
    delay: number,
  ): void {
    if (this.rays.length >= RAY_CAPACITY) this.rays.shift();
    this.rays.push({ x, y, angle, spin, length, width, color: color.clone(), age: 0, life, delay });
  }

  private later(delay: number, x: number, y: number, hue: number, radius: number, duration: number): void {
    this.pending.push({ at: delay, x, y, hue, radius, duration });
  }
}

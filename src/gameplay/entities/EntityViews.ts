import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BALL, FIELD, LASER, PADDLE, POWERUPS, SHOT } from '../config';
import type { WorldId } from '../../content/worlds';
import { clamp, damp, easeOutCubic, lerp } from '../../engine/core/math';
import { POWERUP_KIND_COUNT, PowerUpKind, type Paddle } from '../types';
import { paddleSlope } from '../hazards/scarabs/scarabs';
import type { World } from '../World';
import { createSlabGeometry } from '../../engine/render/geometry';
import type { ParticleSystem } from '../../engine/render/ParticleSystem';
import { TRAIL_FRAGMENT, TRAIL_VERTEX } from '../../engine/render/shaders';
import { createShadowTexture } from '../../engine/render/textures';
import { createIconTexture } from '../powerups/iconTexture';

function hdr(hex: number, gain: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(gain);
}

function glowSprite(texture: THREE.Texture, color: THREE.Color, scale: number): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  );
  sprite.scale.setScalar(scale);
  return sprite;
}

// ---------------------------------------------------------------------- balls

const TRAIL_POINTS = 40;
const TRAIL_HISTORY = 96;
/** Short, faint trail: enough to show direction without a glittering streak. */
const TRAIL_LENGTH = 2.2;

/** Per-ball ribbon trail fed from a short history of rendered positions. */
class Trail {
  readonly mesh: THREE.Mesh;
  private readonly hx = new Float32Array(TRAIL_HISTORY);
  private readonly hy = new Float32Array(TRAIL_HISTORY);
  private head = 0;
  private size = 0;
  private readonly position: THREE.BufferAttribute;
  private readonly trail: THREE.BufferAttribute;

  constructor(material: THREE.ShaderMaterial) {
    const geo = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 2 * 3), 3);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.trail = new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 2 * 2), 2);
    this.trail.setUsage(THREE.DynamicDrawUsage);
    const index: number[] = [];
    for (let i = 0; i < TRAIL_POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(index);
    geo.setAttribute('position', this.position);
    geo.setAttribute('aTrail', this.trail);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  reset(): void {
    this.size = 0;
  }

  push(x: number, y: number): void {
    if (this.size > 0) {
      const last = (this.head + TRAIL_HISTORY - 1) % TRAIL_HISTORY;
      const dx = x - this.hx[last];
      const dy = y - this.hy[last];
      const d2 = dx * dx + dy * dy;
      if (d2 > 9) this.size = 0; // teleported (respawn / split): start over
      else if (d2 < 0.0004) return;
    }
    this.hx[this.head] = x;
    this.hy[this.head] = y;
    this.head = (this.head + 1) % TRAIL_HISTORY;
    this.size = Math.min(TRAIL_HISTORY, this.size + 1);
  }

  private dirX = 0;
  private dirY = -1;

  /** Writes one cross-section of the ribbon at slot n (a method rather than a per-frame closure: no garbage). */
  private writePoint(n: number, cx: number, cy: number, t: number, width: number): void {
    const pos = this.position.array as Float32Array;
    const tr = this.trail.array as Float32Array;
    const w = width * (1 - t * 0.75);
    const nx = -this.dirY * w;
    const ny = this.dirX * w;
    const o = n * 6;
    pos[o] = cx + nx;
    pos[o + 1] = cy + ny;
    pos[o + 2] = -0.05;
    pos[o + 3] = cx - nx;
    pos[o + 4] = cy - ny;
    pos[o + 5] = -0.05;
    const k = n * 4;
    tr[k] = t;
    tr[k + 1] = 1;
    tr[k + 2] = t;
    tr[k + 3] = -1;
  }

  /** Rebuilds the ribbon from the head (current position) backwards, clipped to TRAIL_LENGTH. */
  build(x: number, y: number, width: number): void {
    const pos = this.position.array as Float32Array;
    const tr = this.trail.array as Float32Array;
    let px = x;
    let py = y;
    let dist = 0;
    let n = 0;
    this.dirX = 0;
    this.dirY = -1;
    for (let i = 1; i <= this.size; i++) {
      const idx = (this.head - i + TRAIL_HISTORY * 2) % TRAIL_HISTORY;
      const seg = Math.hypot(px - this.hx[idx], py - this.hy[idx]);
      if (seg > 1e-4) {
        this.dirX = (px - this.hx[idx]) / seg;
        this.dirY = (py - this.hy[idx]) / seg;
        break;
      }
    }
    this.writePoint(n++, px, py, 0, width);
    for (let i = 1; i <= this.size && n < TRAIL_POINTS; i++) {
      const idx = (this.head - i + TRAIL_HISTORY * 2) % TRAIL_HISTORY;
      const qx = this.hx[idx];
      const qy = this.hy[idx];
      const seg = Math.hypot(qx - px, qy - py);
      if (seg < 1e-5) continue;
      this.dirX = (px - qx) / seg;
      this.dirY = (py - qy) / seg;
      if (dist + seg >= TRAIL_LENGTH) {
        const f = (TRAIL_LENGTH - dist) / seg;
        this.writePoint(n++, px + (qx - px) * f, py + (qy - py) * f, 1, width);
        dist = TRAIL_LENGTH;
        break;
      }
      dist += seg;
      this.writePoint(n++, qx, qy, dist / TRAIL_LENGTH, width);
      px = qx;
      py = qy;
    }
    // Collapse unused vertices onto the tail.
    const lastO = (n - 1) * 6;
    for (let j = n; j < TRAIL_POINTS; j++) {
      const o = j * 6;
      for (let c = 0; c < 6; c++) pos[o + c] = pos[lastO + c];
      const k = j * 4;
      tr[k] = 1;
      tr[k + 1] = 1;
      tr[k + 2] = 1;
      tr[k + 3] = -1;
    }
    this.position.needsUpdate = true;
    this.trail.needsUpdate = true;
    this.mesh.visible = n > 1;
  }
}

/**
 * Refrakt's surface: spectral bands spiralling round the sphere (hue runs along longitude and climbs with
 * latitude), with soft bright seams between them, so spinning the ball sweeps the colours through.
 */
function createSpectrumTexture(): THREE.DataTexture {
  const w = 256;
  const h = 128;
  const data = new Uint8Array(w * h * 4);
  const c = new THREE.Color();
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const phase = (u * 2 + v * 1.5) % 1; // two full spectra round the equator, so it tiles seamlessly
      const seam = Math.pow(Math.abs(Math.sin(phase * Math.PI * 6)), 18); // fine light filaments
      c.setHSL(phase, 1, 0.45 + 0.35 * seam);
      const k = (y * w + x) * 4;
      data[k] = Math.round(c.r * 255);
      data[k + 1] = Math.round(c.g * 255);
      data[k + 2] = Math.round(c.b * 255);
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export class BallsView {
  /** Interpolated position of the lowest ball, used for lighting and camera focus. */
  focusX = 0;
  focusY = 0;
  hasFocus = false;

  private readonly meshes: THREE.Mesh[] = [];
  private readonly trails: Trail[] = [];
  private readonly wasActive: boolean[] = [];
  // Satin pearl rather than a mirror: soft, broad highlights that don't crawl or trip the bloom, plus a
  // small steady self-glow so the ball stays easy to pick out against bricks and shards.
  private readonly matChrome = new THREE.MeshStandardMaterial({
    color: 0xf3f5f8,
    roughness: 0.32,
    metalness: 0.45,
    envMapIntensity: 0.85,
    emissive: 0x7d8796,
    emissiveIntensity: 0.3,
  });
  private readonly matFire = new THREE.MeshStandardMaterial({
    color: 0xffc27a,
    emissive: 0xff5a10,
    emissiveIntensity: 1.4,
    roughness: 0.4,
    metalness: 0.2,
  });
  private readonly spectrum = createSpectrumTexture();
  // Refrakt: the ball becomes spinning light. Lit from within by the spectrum (the texture's hue scrolls too),
  // with a little gloss left on so it still reads as a solid ball.
  private readonly matRefrakt = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: this.spectrum,
    emissive: 0xffffff,
    emissiveMap: this.spectrum,
    emissiveIntensity: 0.6,
    roughness: 0.22,
    metalness: 0.1,
    envMapIntensity: 0.6,
  });
  private readonly trailMaterial: THREE.ShaderMaterial;
  private readonly trailWhite = new THREE.Color(0.8, 0.83, 0.9);
  private readonly trailFire = new THREE.Color(1, 0.45, 0.12);
  private readonly trailRefrakt = new THREE.Color();
  private readonly glint = new THREE.Color();
  private emberAcc = 0;
  private glintAcc = 0;
  /** Seconds of Refrakt seen so far, driving the spin and the colour cycle. */
  private refraktClock = 0;
  /** Current hue of the Refrakt light (0..1), for the trail and the ball light. */
  refraktHue = 0;

  constructor(scene: THREE.Scene) {
    this.trailMaterial = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 0.3 } },
      vertexShader: TRAIL_VERTEX,
      fragmentShader: TRAIL_FRAGMENT,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const geo = new THREE.SphereGeometry(BALL.radius, 48, 32);
    for (let i = 0; i < BALL.capacity; i++) {
      const mesh = new THREE.Mesh(geo, this.matChrome);
      mesh.castShadow = true;
      mesh.visible = false;
      this.meshes.push(mesh);
      const trail = new Trail(this.trailMaterial);
      this.trails.push(trail);
      this.wasActive.push(false);
      scene.add(mesh, trail.mesh);
    }
  }

  /** Where ball i is drawn this frame, or null when it is not in play. */
  positionOf(i: number): THREE.Vector3 | null {
    const mesh = this.meshes[i];
    return mesh && mesh.visible ? mesh.position : null;
  }

  update(world: World, alpha: number, simDt: number, particles: ParticleSystem): void {
    const fire = world.hasEffect(PowerUpKind.Fire);
    const refrakt = world.refraktActive;
    // Refrakt wins the look when both are on: it is the rarer, louder effect.
    const material = refrakt ? this.matRefrakt : fire ? this.matFire : this.matChrome;
    if (refrakt) {
      this.refraktClock += simDt;
      this.refraktHue = (this.refraktClock * 0.45) % 1;
      this.spectrum.offset.y = 0;
      this.spectrum.offset.x = -this.refraktClock * 0.35; // the bands drift through the colours as it spins
      this.trailRefrakt.setHSL(this.refraktHue, 0.85, 0.62);
    }
    (this.trailMaterial.uniforms.uColor.value as THREE.Color).copy(refrakt ? this.trailRefrakt : fire ? this.trailFire : this.trailWhite);
    this.emberAcc += simDt * 10;
    const embers = fire && !refrakt ? Math.floor(this.emberAcc) : 0;
    this.emberAcc -= Math.floor(this.emberAcc);
    this.glintAcc += simDt * 14;
    const glints = refrakt ? Math.floor(this.glintAcc) : 0;
    this.glintAcc -= Math.floor(this.glintAcc);

    this.hasFocus = false;
    let lowest = Infinity;
    const balls = world.balls.items;
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      const mesh = this.meshes[i];
      const trail = this.trails[i];
      mesh.visible = ball.active;
      if (!ball.active) {
        trail.mesh.visible = false;
        this.wasActive[i] = false;
        continue;
      }
      if (!this.wasActive[i]) trail.reset();
      this.wasActive[i] = true;
      const x = lerp(ball.px, ball.x, alpha);
      const y = lerp(ball.py, ball.y, alpha);
      mesh.position.set(x, y, 0);
      mesh.material = material;
      // The plain ball never spins (rotating the tessellated sphere made its highlights crawl); Refrakt's
      // spin is the point, and its glow swamps any crawl. Tumbles on a tilted axis, each ball out of step.
      if (refrakt) {
        mesh.rotation.set(0.5 + i * 0.7, this.refraktClock * 9 + i * 1.3, 0.35);
      } else if (mesh.rotation.y !== 0) {
        mesh.rotation.set(0, 0, 0);
      }
      if (y < lowest) {
        lowest = y;
        this.focusX = x;
        this.focusY = y;
        this.hasFocus = true;
      }
      if (ball.stuck) {
        trail.reset();
        trail.mesh.visible = false;
        continue;
      }
      if (simDt > 0) trail.push(x, y);
      trail.build(x, y, BALL.radius * 0.7);
      // Refrakt glints: tiny sparks of every colour shed behind the ball.
      for (let n = 0; n < glints; n++) {
        this.glint.setHSL((this.refraktHue + Math.random() * 0.5) % 1, 0.95, 0.6);
        particles.emit(
          x + (Math.random() - 0.5) * 0.25,
          y + (Math.random() - 0.5) * 0.25,
          -0.7,
          (Math.random() - 0.5) * 3,
          (Math.random() - 0.5) * 3,
          -0.4,
          this.glint.r * 1.6,
          this.glint.g * 1.6,
          this.glint.b * 1.6,
          0.07 + Math.random() * 0.05,
          0.3 + Math.random() * 0.2,
          2,
          0,
        );
      }
      // Fire-ball embers: few, dim and emitted behind the ball (they used to spawn inside it at z = 0 and
      // pop in and out at its silhouette).
      for (let n = 0; n < embers; n++) {
        particles.emit(
          x + (Math.random() - 0.5) * 0.2,
          y + (Math.random() - 0.5) * 0.2,
          -0.7,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
          -0.5,
          1.2,
          0.4 + Math.random() * 0.2,
          0.08,
          0.35,
          0.35,
          1,
          -4,
        );
      }
    }
  }
}

// --------------------------------------------------------------------- paddle

export const PADDLE_HALF_D = 1.15;

/** Furthest a paddle end dips when an icicle strikes it, world units. */
const TILT_DIP = 0.45;

/**
 * The paddle's roll (about z) for its `tilt` (see Paddle): a damped wobble that starts with the struck end
 * down (positive tilt: the right end) and rocks back and forth a couple of times before settling level.
 */
export function paddleTilt(tilt: number, halfWidth: number): number {
  if (tilt === 0) return 0;
  const left = Math.abs(tilt);
  const wobble = left * left * Math.cos((1 - left) * Math.PI * 4);
  return -Math.sign(tilt) * Math.atan2(TILT_DIP * wobble, halfWidth);
}

/**
 * The paddle's drawn roll about z: an icicle's wobble plus the steady lean of clinging scarabs, drawn at half
 * the bounce turn it gives (a mirror tilted by a turns a reflection by 2a), so the slope reads true.
 */
export function paddleRoll(p: Paddle): number {
  return paddleTilt(p.tilt, p.width / 2) + paddleSlope(p);
}

export class PaddleView {
  readonly group = new THREE.Group();
  private readonly stretch = new THREE.Group();
  private readonly cannonL: THREE.Mesh;
  private readonly cannonR: THREE.Mesh;
  private readonly barMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private readonly accentMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private readonly topMaterial: THREE.MeshPhysicalMaterial;
  private readonly contact: THREE.Mesh;
  private readonly color = new THREE.Color();
  private readonly goal = new THREE.Color();
  // Light-bar colours. Kept modest so the bar (and its floor reflection) reads clearly without blooming.
  private readonly cBase = hdr(0xff7a1f, 2);
  private readonly cMagnet = hdr(0xb04dff, 2);
  private readonly cLaser = hdr(0xff2f4f, 2.2);
  private readonly cStun = hdr(0xff2020, 1.6);
  private readonly cVenom = hdr(0x5dff3a, 1.8);
  private readonly cScarab = hdr(0xffb020, 1.7);

  constructor(scene: THREE.Scene) {
    const halfW = PADDLE.width / 2;
    const halfH = PADDLE.halfH;

    const chrome = new THREE.MeshPhysicalMaterial({
      color: 0xeef1f5,
      metalness: 0.72,
      roughness: 0.26,
      clearcoat: 0.7,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.35,
    });
    const body = new THREE.Mesh(createSlabGeometry(halfW, halfH, PADDLE_HALF_D, 0.5, 0.16), chrome);
    body.castShadow = true;

    this.topMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xe9f1fa,
      roughness: 0.32,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      emissive: 0xbfd4ea,
      emissiveIntensity: 0.18,
      transparent: true,
      opacity: 0.94,
      envMapIntensity: 1.2,
    });
    const top = new THREE.Mesh(createSlabGeometry(halfW - 0.42, 0.04, PADDLE_HALF_D - 0.36, 0.34, 0.03), this.topMaterial);
    top.position.y = halfH + 0.02;

    const recess = new THREE.Mesh(
      new THREE.BoxGeometry(PADDLE.width * 0.82, 0.16, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.35, metalness: 0.8 }),
    );
    recess.position.set(0, -0.04, PADDLE_HALF_D + 0.005);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(PADDLE.width * 0.36, 0.09, 0.05), this.barMaterial);
    bar.position.set(0, -0.04, PADDLE_HALF_D + 0.03);
    this.stretch.add(body, top, recess, bar);

    // Small warm glints at both front corners.
    const accentGeo = new THREE.BoxGeometry(0.22, 0.06, 0.05);
    for (const s of [-1, 1]) {
      const accent = new THREE.Mesh(accentGeo, this.accentMaterial);
      accent.position.set(s * (halfW - 0.36), -0.04, PADDLE_HALF_D - 0.02);
      accent.rotation.y = s * 0.7;
      this.stretch.add(accent);
    }

    const cannonGeo = new THREE.CylinderGeometry(0.1, 0.14, 0.55, 12);
    const cannonMat = new THREE.MeshStandardMaterial({ color: 0xd0d6de, roughness: 0.2, metalness: 1, emissive: 0xff2f4f, emissiveIntensity: 0.8 });
    this.cannonL = new THREE.Mesh(cannonGeo, cannonMat);
    this.cannonR = new THREE.Mesh(cannonGeo, cannonMat);
    this.cannonL.position.y = this.cannonR.position.y = halfH + 0.28;

    this.contact = new THREE.Mesh(
      new THREE.PlaneGeometry(PADDLE.width * 1.25, PADDLE_HALF_D * 3.2),
      new THREE.MeshBasicMaterial({ map: createShadowTexture(), transparent: true, depthWrite: false, opacity: 0.85 }),
    );
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.position.y = FIELD.floorY - PADDLE.y + 0.01;
    this.contact.renderOrder = 1;

    this.group.add(this.stretch, this.cannonL, this.cannonR, this.contact);
    this.color.copy(this.cBase);
    scene.add(this.group);
  }

  get lightColor(): THREE.Color {
    return this.color;
  }

  /** The contact shadow lies on the Space deck; the forest's painted floor has none. */
  setWorld(world: WorldId): void {
    this.contact.visible = world === 'space';
  }

  update(world: World, alpha: number, dt: number): void {
    const p = world.paddle;
    const x = lerp(p.px, p.x, alpha);
    const half = p.width / 2;
    // Hit response: a short, smooth ease-out (no hard on/off).
    const hitT = Math.min(1, Math.max(0, 1 - (world.time - p.hitTime) / 0.3));
    const hit = hitT * hitT;

    this.group.position.set(x, p.y - hit * 0.03, 0);
    this.group.rotation.z = paddleRoll(p);
    this.stretch.scale.set(p.width / PADDLE.width, 1 - hit * 0.05, 1);
    this.contact.scale.x = p.width / PADDLE.width;

    const laser = world.hasEffect(PowerUpKind.Laser);
    this.cannonL.visible = this.cannonR.visible = laser;
    this.cannonL.position.x = -(half - 0.45);
    this.cannonR.position.x = half - 0.45;

    // Stun shows as a steady red light bar (it used to strobe at 30 Hz).
    if (p.stun > 0) this.goal.copy(this.cStun);
    else if (p.shove !== 0) this.goal.copy(this.cVenom);
    else if (world.scarabs.clinging > 0) this.goal.copy(this.cScarab);
    else if (laser) this.goal.copy(this.cLaser);
    else if (world.hasEffect(PowerUpKind.Magnet)) this.goal.copy(this.cMagnet);
    else this.goal.copy(this.cBase);
    this.color.lerp(this.goal, 1 - Math.exp(-6 * dt));
    this.barMaterial.color.copy(this.color).multiplyScalar(1 + hit * 0.35);
    this.accentMaterial.color.copy(this.color).multiplyScalar(0.55 + hit * 0.2);
    this.topMaterial.emissiveIntensity = 0.18 + hit * 0.15;
  }
}

// ---------------------------------------------------------------------- drops

export class DropsView {
  private readonly groups: THREE.Group[] = [];
  private readonly tiles: THREE.Mesh[] = [];
  private readonly icons: THREE.Sprite[] = [];
  private readonly halos: THREE.Sprite[] = [];
  private readonly materials: THREE.MeshPhysicalMaterial[] = [];
  private readonly iconMaterials: THREE.SpriteMaterial[] = [];
  private readonly haloColors: THREE.Color[] = [];

  constructor(scene: THREE.Scene, capacity: number, glowTexture: THREE.Texture) {
    for (let kind = 0; kind < POWERUP_KIND_COUNT; kind++) {
      const info = POWERUPS[kind as PowerUpKind];
      this.materials.push(
        new THREE.MeshPhysicalMaterial({
          color: 0x1c2330,
          roughness: 0.14,
          metalness: 0.3,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
          emissive: info.color,
          emissiveIntensity: 0.12,
          envMapIntensity: 1.4,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      );
      this.iconMaterials.push(
        new THREE.SpriteMaterial({ map: createIconTexture(kind as PowerUpKind, info.letter), transparent: true, depthTest: false, depthWrite: false }),
      );
      this.haloColors.push(new THREE.Color(info.color).multiplyScalar(0.55));
    }
    const geo = new RoundedBoxGeometry(1.3, 1.15, 0.42, 3, 0.2);
    for (let i = 0; i < capacity; i++) {
      const group = new THREE.Group();
      // Draw the whole pickup after the arena, with halo, body and icon in that order.
      // Depth testing is disabled on each layer so bricks cannot cut through it.
      group.renderOrder = 10;
      const tile = new THREE.Mesh(geo, this.materials[0]);
      tile.renderOrder = 1;
      tile.castShadow = true;
      const icon = new THREE.Sprite(this.iconMaterials[0]);
      icon.scale.setScalar(0.92);
      icon.position.z = 0.3;
      icon.renderOrder = 2;
      const halo = glowSprite(glowTexture, new THREE.Color(), 2.6);
      halo.position.z = -0.3;
      halo.material.depthTest = false;
      group.add(halo, tile, icon);
      group.visible = false;
      this.groups.push(group);
      this.tiles.push(tile);
      this.icons.push(icon);
      this.halos.push(halo);
      scene.add(group);
    }
  }

  update(world: World, alpha: number): void {
    const drops = world.drops.items;
    for (let i = 0; i < drops.length; i++) {
      const drop = drops[i];
      const group = this.groups[i];
      group.visible = drop.active;
      if (!drop.active) continue;
      group.position.set(drop.x, lerp(drop.py, drop.y, alpha), 0.2);
      this.tiles[i].material = this.materials[drop.kind];
      this.tiles[i].rotation.y = Math.sin(world.time * 1.6 + i) * 0.35;
      this.icons[i].material = this.iconMaterials[drop.kind];
      // Steady halo with only a slow, faint breathe (was a ~1 Hz, +/-20% pulse).
      (this.halos[i].material as THREE.SpriteMaterial).color.copy(this.haloColors[drop.kind]).multiplyScalar(0.6 + Math.sin(world.time * 2 + i) * 0.05);
    }
  }
}

// --------------------------------------------------------------------- lasers

export class LasersView {
  private readonly meshes: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BoxGeometry(0.1, LASER.halfLength * 2, 0.1);
    const mat = new THREE.MeshBasicMaterial({ color: hdr(0xff4a3a, 5) });
    for (let i = 0; i < LASER.capacity; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.meshes.push(mesh);
      scene.add(mesh);
    }
  }

  update(world: World, alpha: number): void {
    const lasers = world.lasers.items;
    for (let i = 0; i < lasers.length; i++) {
      const laser = lasers[i];
      const mesh = this.meshes[i];
      mesh.visible = laser.active;
      if (laser.active) mesh.position.set(laser.x, lerp(laser.py, laser.y, alpha), 0);
    }
  }
}

// ---------------------------------------------------------------- boss shots

export class ShotsView {
  private readonly meshes: THREE.Mesh[] = [];
  private acc = 0;

  constructor(scene: THREE.Scene, glowTexture: THREE.Texture) {
    const geo = new THREE.IcosahedronGeometry(SHOT.radius, 1);
    const mat = new THREE.MeshBasicMaterial({ color: hdr(0xff3d5e, 3.5) });
    const glowColor = hdr(0xff3d5e, 0.8);
    for (let i = 0; i < SHOT.capacity; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.add(glowSprite(glowTexture, glowColor, 1.8));
      mesh.visible = false;
      this.meshes.push(mesh);
      scene.add(mesh);
    }
  }

  update(world: World, alpha: number, simDt: number, particles: ParticleSystem): void {
    this.acc += simDt * 25;
    const trail = Math.floor(this.acc);
    this.acc -= trail;
    const shots = world.shots.items;
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const mesh = this.meshes[i];
      mesh.visible = shot.active;
      if (!shot.active) continue;
      const x = lerp(shot.px, shot.x, alpha);
      const y = lerp(shot.py, shot.y, alpha);
      mesh.position.set(x, y, 0);
      mesh.rotation.set(world.time * 3, world.time * 4, 0);
      for (let n = 0; n < trail; n++) particles.emit(x, y, 0, 0, 0, 0, 2.2, 0.35, 0.5, 0.4, 0.22, 0, 0);
    }
  }
}

// ----------------------------------------------------------------------- boss

const STAGE_COLORS: readonly number[] = [0x3f8cff, 0xff8424, 0xff3d5e];

export class BossView {
  private readonly group = new THREE.Group();
  private readonly core: THREE.Mesh;
  private readonly shell: THREE.Mesh;
  private readonly rings: THREE.Mesh[] = [];
  private readonly coreMaterial: THREE.MeshPhysicalMaterial;
  private readonly shellMaterial: THREE.MeshPhysicalMaterial;
  private readonly ringMaterial: THREE.MeshPhysicalMaterial;
  private readonly light = new THREE.PointLight(0x3f8cff, 60, 22, 2);
  private readonly color = new THREE.Color(STAGE_COLORS[0]);
  private readonly goal = new THREE.Color(STAGE_COLORS[0]);
  private appear = 0;
  private dying = 0;
  private burstTimer = 0;
  private lastX = 0;
  private lastY = 0;

  constructor(scene: THREE.Scene) {
    this.coreMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x20242c,
      roughness: 0.1,
      metalness: 1,
      clearcoat: 1,
      flatShading: true,
      emissive: STAGE_COLORS[0],
      emissiveIntensity: 0.6,
      envMapIntensity: 1.5,
    });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 1), this.coreMaterial);
    this.core.castShadow = true;
    this.shellMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.04,
      metalness: 0,
      clearcoat: 1,
      transparent: true,
      opacity: 0.14,
      flatShading: true,
      emissive: STAGE_COLORS[0],
      emissiveIntensity: 0.12,
      envMapIntensity: 0.7,
      depthWrite: false,
    });
    this.shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), this.shellMaterial);
    this.ringMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xe6eaf0,
      roughness: 0.14,
      metalness: 1,
      clearcoat: 0.6,
      emissive: STAGE_COLORS[0],
      emissiveIntensity: 0.3,
      envMapIntensity: 1.4,
    });
    const ringGeo = new THREE.TorusGeometry(1.28, 0.055, 12, 96);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(ringGeo, this.ringMaterial);
      ring.scale.setScalar(1 + i * 0.12);
      ring.castShadow = true;
      this.rings.push(ring);
      this.group.add(ring);
    }
    this.light.position.z = 2.5;
    this.group.add(this.core, this.shell, this.light);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Starts the multi-burst death sequence at the boss's last position. */
  startDeath(): void {
    this.dying = 1.3;
    this.burstTimer = 0;
  }

  update(world: World, alpha: number, dt: number, particles: ParticleSystem): void {
    const boss = world.boss;
    if (boss.active) {
      this.lastX = lerp(boss.px, boss.x, alpha);
      this.lastY = lerp(boss.py, boss.y, alpha);
      this.appear = Math.min(1, this.appear + dt * 1.2);
      this.dying = 0;
    } else if (this.dying > 0) {
      this.dying -= dt;
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.burstTimer = 0.32;
        const ox = (Math.random() - 0.5) * boss.radius * 2;
        const oy = (Math.random() - 0.5) * boss.radius * 2;
        particles.burst(this.lastX + ox, this.lastY + oy, this.color, 12, 8, 0.45, 0.7, 1.1);
      }
      if (this.dying <= 0) particles.burst(this.lastX, this.lastY, this.color, 60, 12, 0.55, 1.2, 1.2);
    } else {
      this.appear = 0;
    }

    const visible = boss.active || this.dying > 0;
    this.group.visible = visible;
    if (!visible) return;

    const t = world.time;
    // Hit glow: small and eased out over ~0.35 s; the boss light (which lights the whole scene) barely changes.
    const hitT = Math.max(0, 1 - (t - boss.hitTime) / 0.35);
    const flash = hitT * hitT;
    const dying = this.dying > 0 ? 1 : 0;
    const scale = boss.radius * easeOutCubic(this.appear) * (1 + flash * 0.03) * (this.dying > 0 ? 0.6 + this.dying * 0.4 : 1);
    this.group.position.set(this.lastX, this.lastY, 0);
    this.group.scale.setScalar(Math.max(0.001, scale));

    this.goal.set(STAGE_COLORS[Math.min(STAGE_COLORS.length - 1, boss.stage)]);
    this.color.lerp(this.goal, 1 - Math.exp(-2 * dt));
    this.coreMaterial.emissive.copy(this.color);
    this.coreMaterial.emissiveIntensity = 0.55 + flash * 0.7 + Math.sin(t * 1.2) * 0.06 + dying * 0.6;
    this.shellMaterial.emissive.copy(this.color);
    this.shellMaterial.emissiveIntensity = 0.12 + flash * 0.25;
    this.ringMaterial.emissive.copy(this.color);
    this.ringMaterial.emissiveIntensity = 0.3 + flash * 0.4;
    this.light.color.copy(this.color);
    this.light.intensity = 60 + flash * 25;

    const speed = 1 + boss.stage * 0.8;
    this.core.rotation.set(t * 0.5 * speed, t * 0.7 * speed, 0);
    this.shell.rotation.set(-t * 0.3 * speed, t * 0.2 * speed, t * 0.25);
    this.rings[0].rotation.set(t * 0.9 * speed, t * 0.4, 0);
    this.rings[1].rotation.set(t * 0.3, t * 1.1 * speed, 1);
    this.rings[2].rotation.set(1.2, t * 0.5, t * 0.8 * speed);
  }
}

// --------------------------------------------------------------------- shield

/** A thin glowing line at the barrier's collision height. */
export class ShieldView {
  private readonly mesh: THREE.Mesh;
  private readonly material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  private readonly base = new THREE.Color(0x6ff0ff);
  private flash = 0;

  constructor(scene: THREE.Scene) {
    const radius = 0.035;
    const geometry = new THREE.CapsuleGeometry(radius, FIELD.halfWidth * 2 - radius * 2, 6, 12);
    geometry.rotateZ(Math.PI / 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.set(0, FIELD.shieldY, 0.2);
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  pulse(): void {
    this.flash = 1;
  }

  update(world: World, dt: number): void {
    this.mesh.scale.x = (world.shieldRight - world.shieldLeft) / (FIELD.halfWidth * 2);
    this.mesh.position.set((world.shieldLeft + world.shieldRight) / 2, world.shieldY, 0.2);
    this.flash = damp(this.flash, 0, 3, dt);
    const on = world.shieldCharges > 0;
    this.mesh.visible = on || this.flash > 0.02;
    if (!this.mesh.visible) return;
    // Steady band with a slow, faint breathe; a hit adds a gentle glow that fades over ~1 s.
    const gain = (on ? 0.5 + world.shieldCharges * 0.25 + Math.sin(world.time * 1.5) * 0.04 : 0) + this.flash * 0.6;
    // Keep the narrow core above the renderer's bloom threshold, even on its last charge.
    this.material.color.copy(this.base).multiplyScalar(gain * 2.5);
  }
}

// ----------------------------------------------------------------- shockwaves

/** Pooled expanding rings for explosions and pickups. */
export class ShockwavePool {
  private readonly meshes: THREE.Mesh[] = [];
  private readonly materials: THREE.MeshBasicMaterial[] = [];
  private readonly age: number[] = [];
  private readonly duration: number[] = [];
  private readonly radius: number[] = [];
  private readonly colors: THREE.Color[] = [];
  private cursor = 0;

  constructor(scene: THREE.Scene, capacity: number) {
    const geo = new THREE.RingGeometry(0.9, 1, 64);
    for (let i = 0; i < capacity; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.position.z = 0.6;
      this.meshes.push(mesh);
      this.materials.push(mat);
      this.age.push(0);
      this.duration.push(0);
      this.radius.push(1);
      this.colors.push(new THREE.Color());
      scene.add(mesh);
    }
  }

  spawn(x: number, y: number, color: THREE.Color, radius: number, duration: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.meshes.length;
    this.meshes[i].position.x = x;
    this.meshes[i].position.y = y;
    this.meshes[i].visible = true;
    this.age[i] = 0;
    this.duration[i] = duration;
    this.radius[i] = radius;
    this.colors[i].copy(color);
  }

  update(dt: number): void {
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i];
      if (!mesh.visible) continue;
      this.age[i] += dt;
      const t = this.age[i] / this.duration[i];
      if (t >= 1) {
        mesh.visible = false;
        continue;
      }
      mesh.scale.setScalar(0.2 + easeOutCubic(t) * this.radius[i]);
      this.materials[i].color.copy(this.colors[i]).multiplyScalar((1 - t) * (1 - t) * 0.45);
    }
  }
}

// ------------------------------------------------------------ impact flashes

/** Pooled soft glow sprites: a faint warm bloom at the point of an impact. */
export class ImpactFlashPool {
  private readonly sprites: THREE.Sprite[] = [];
  private readonly materials: THREE.SpriteMaterial[] = [];
  private readonly age: number[] = [];
  private readonly life: number[] = [];
  private readonly size: number[] = [];
  private readonly gain: number[] = [];
  private cursor = 0;

  constructor(scene: THREE.Scene, texture: THREE.Texture, capacity: number) {
    for (let i = 0; i < capacity; i++) {
      const mat = new THREE.SpriteMaterial({
        map: texture,
        color: 0xffffff,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 4;
      this.sprites.push(sprite);
      this.materials.push(mat);
      this.age.push(0);
      this.life.push(1);
      this.size.push(1);
      this.gain.push(1);
      scene.add(sprite);
    }
  }

  spawn(x: number, y: number, size: number, life = 0.32, gain = 2.2): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.sprites.length;
    const s = this.sprites[i];
    // Behind the ball (depth-tested), so impact glows never cover it.
    s.position.set(x, y, -0.6);
    s.visible = true;
    this.materials[i].rotation = Math.random() * Math.PI;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.gain[i] = gain;
  }

  update(dt: number): void {
    for (let i = 0; i < this.sprites.length; i++) {
      const s = this.sprites[i];
      if (!s.visible) continue;
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) {
        s.visible = false;
        continue;
      }
      // Soft swell and smooth fade (no instant full-brightness pop).
      const grow = clamp(t / 0.3, 0, 1);
      s.scale.setScalar(this.size[i] * (0.6 + 0.4 * easeOutCubic(grow)));
      const fade = Math.sin(Math.PI * Math.min(1, t * 1.6 + 0.08)) * (1 - t);
      this.materials[i].color.setRGB(1, 0.92, 0.8).multiplyScalar(this.gain[i] * Math.max(0, fade));
    }
  }
}

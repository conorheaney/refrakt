import * as THREE from 'three';
import { PADDLE, POWER_WARN, POWERUPS } from '../config';
import { damp } from '../../engine/core/math';
import { canvas2d } from '../../engine/render/textures';
import { PowerUpKind } from '../types';
import type { World } from '../World';

/** Timed power-ups that act on the paddle; their countdowns live on its front face (PaddlePowers). */
export const PADDLE_POWERS: readonly PowerUpKind[] = [PowerUpKind.Expand, PowerUpKind.Laser, PowerUpKind.Magnet];

/** The display band across the paddle's front face: this much narrower than the paddle, centred at BAND_Y. */
export const BAND_INSET = 1.1;
export const BAND_Y = -0.03;
export const BAND_H = 0.44;
/** Glyph size, rail thickness, and the gap between a glyph and its rails (world units). */
const GLYPH = 0.36;
const RAIL_H = 0.065;
const RAIL_GAP = 0.06;
/** Seconds of the expiry burst. */
const DIE_TIME = 0.4;
/** Seconds the light glint takes to sweep across the band when a power starts or is refreshed. */
const SWEEP_TIME = 0.38;

/**
 * Light rail: a thin line of the power's colour with a bright tip at its outer end, energy pulses flowing
 * in toward the glyph as the time is used up. u runs 0 (at the glyph) to 1 (the tip); uLen is its length.
 */
const RAIL_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const RAIL_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uLen;
  uniform float uBright;
  void main() {
    float v = vUv.y * 2.0 - 1.0;
    float core = exp(-v * v * 9.0);
    float d = vUv.x * uLen;
    float pulse = pow(0.5 + 0.5 * sin(d * 10.0 + uTime * 11.0), 6.0);
    float tip = exp(-(uLen - d) * 16.0);
    float root = smoothstep(0.0, 0.05, d);
    vec3 c = uColor * core * (1.0 + 0.8 * pulse) + mix(uColor, vec3(1.0), 0.75) * tip * core * 2.2;
    gl_FragColor = vec4(c * uBright * root, 1.0);
  }
`;

type GlyphDraw = (ctx: CanvasRenderingContext2D) => void;

/** Minimal monochrome glyphs (white on transparent, 128 px), tinted by each power's colour. */
const GLYPHS: Partial<Record<PowerUpKind, GlyphDraw>> = {
  // Two arrowheads pushing outward along a bar: wider.
  [PowerUpKind.Expand]: (ctx) => {
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(34, 64);
    ctx.lineTo(94, 64);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(12, 64);
    ctx.lineTo(42, 40);
    ctx.lineTo(42, 88);
    ctx.closePath();
    ctx.moveTo(116, 64);
    ctx.lineTo(86, 40);
    ctx.lineTo(86, 88);
    ctx.closePath();
    ctx.fill();
  },
  // Twin beams firing upward: the paddle's two cannons.
  [PowerUpKind.Laser]: (ctx) => {
    ctx.lineWidth = 13;
    for (const x of [40, 88]) {
      ctx.beginPath();
      ctx.moveTo(x, 116);
      ctx.lineTo(x, 56);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, 6);
      ctx.lineTo(x + 21, 52);
      ctx.lineTo(x - 21, 52);
      ctx.closePath();
      ctx.fill();
    }
  },
  // A horseshoe magnet, poles up.
  [PowerUpKind.Magnet]: (ctx) => {
    ctx.lineWidth = 17;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(36, 30);
    ctx.lineTo(36, 68);
    ctx.arc(64, 68, 28, Math.PI, 0, true);
    ctx.lineTo(92, 30);
    ctx.stroke();
    ctx.fillRect(25, 12, 22, 14);
    ctx.fillRect(81, 12, 22, 14);
  },
};

function glyphTexture(draw: GlyphDraw): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(128);
  ctx.strokeStyle = ctx.fillStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function haloTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function additive(map: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide });
}

interface Module {
  readonly kind: PowerUpKind;
  readonly group: THREE.Group;
  readonly glyph: THREE.Mesh;
  readonly glyphMat: THREE.MeshBasicMaterial;
  readonly halo: THREE.Mesh;
  readonly haloMat: THREE.MeshBasicMaterial;
  readonly railL: THREE.Mesh;
  readonly railR: THREE.Mesh;
  readonly rail: { uColor: { value: THREE.Color }; uTime: { value: number }; uLen: { value: number }; uBright: { value: number } };
  readonly color: THREE.Color;
  active: boolean;
  /** Centre along the band (paddle-local x), eased when the modules reflow. */
  x: number;
  /** Drawn rail fill 0-1: shoots out when the power starts, then tracks the time left. */
  shown: number;
  /** Seconds since the power started or was refreshed (drives the pop-in). */
  pop: number;
  lastLeft: number;
  /** Seconds into the expiry burst, or -1. */
  dying: number;
  blink: number;
}

const WHITE = new THREE.Color(1, 1, 1);

/**
 * Countdowns for the paddle's timed powers (Expand, Laser, Magnet) on its front face, facing the player:
 * one module per running power, side by side across a dark glass band. Each is a clean glyph in the
 * power's colour with light rails either side that drain in toward it as the time runs down. A pickup
 * (or refresh) pops the glyph in and sweeps a glint across the band; in the last POWER_WARN seconds the
 * module strobes white-hot, faster and faster; when it runs out the glyph bursts and is gone.
 */
export class PaddlePowers {
  readonly group = new THREE.Group();
  private readonly modules: Module[] = [];
  private readonly sweep: THREE.Mesh;
  private readonly sweepMat: THREE.MeshBasicMaterial;
  private sweepT = 1;
  private time = 0;
  /** Modules on show (running or bursting); the paddle hides its plain light bar while there are any. */
  shownCount = 0;

  constructor(faceZ: number) {
    this.group.position.set(0, BAND_Y, faceZ);
    const halo = haloTexture();
    const glyphGeo = new THREE.PlaneGeometry(GLYPH, GLYPH);
    const haloGeo = new THREE.PlaneGeometry(GLYPH * 2.6, GLYPH * 2.2);
    const railGeo = new THREE.PlaneGeometry(1, RAIL_H);
    railGeo.translate(0.5, 0, 0);

    for (const kind of PADDLE_POWERS) {
      const draw = GLYPHS[kind];
      if (!draw) continue;
      const group = new THREE.Group();
      const glyphMat = additive(glyphTexture(draw));
      const glyph = new THREE.Mesh(glyphGeo, glyphMat);
      glyph.position.z = 0.004;
      const haloMat = additive(halo);
      const haloMesh = new THREE.Mesh(haloGeo, haloMat);
      const rail = { uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uLen: { value: 1 }, uBright: { value: 1 } };
      const railMat = new THREE.ShaderMaterial({
        uniforms: rail,
        vertexShader: RAIL_VERTEX,
        fragmentShader: RAIL_FRAGMENT,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const railL = new THREE.Mesh(railGeo, railMat);
      const railR = new THREE.Mesh(railGeo, railMat);
      railL.position.z = railR.position.z = 0.002;
      group.add(haloMesh, railL, railR, glyph);
      group.visible = false;
      for (const m of group.children) m.renderOrder = 3;
      this.group.add(group);
      this.modules.push({
        kind,
        group,
        glyph,
        glyphMat,
        halo: haloMesh,
        haloMat,
        railL,
        railR,
        rail,
        color: new THREE.Color(POWERUPS[kind].color).multiplyScalar(2.8),
        active: false,
        x: 0,
        shown: 0,
        pop: 99,
        lastLeft: 0,
        dying: -1,
        blink: 0,
      });
    }

    this.sweepMat = additive(halo);
    this.sweep = new THREE.Mesh(new THREE.PlaneGeometry(0.16, BAND_H * 1.3), this.sweepMat);
    this.sweep.position.z = 0.006;
    this.sweep.renderOrder = 3;
    this.sweep.visible = false;
    this.group.add(this.sweep);
  }

  /** Where a power's module sits along the paddle (paddle-local x), for effects that come off it. */
  slotX(kind: PowerUpKind): number {
    return this.modules.find((m) => m.kind === kind)?.x ?? 0;
  }

  update(world: World, paddleWidth: number, dt: number): void {
    this.time += dt;
    const bandW = (PADDLE.width - BAND_INSET) * (paddleWidth / PADDLE.width);
    let count = 0;
    for (const m of this.modules) if (world.effectTime[m.kind] > 0) count++;
    const slot = count > 0 ? bandW / count : bandW;
    const railMax = Math.max(0, slot / 2 - GLYPH / 2 - RAIL_GAP - 0.07);

    let index = 0;
    this.shownCount = 0;
    for (const m of this.modules) {
      const left = world.effectTime[m.kind];
      if (left > 0) {
        const target = -bandW / 2 + slot * (index + 0.5);
        index++;
        if (!m.active || m.dying >= 0) {
          // Just picked up: appear in place with empty rails that shoot out.
          m.x = target;
          m.shown = 0;
          this.start(m);
        } else if (left > m.lastLeft + 0.25) {
          this.start(m); // refreshed by another pickup
        }
        m.active = true;
        m.dying = -1;
        m.x = damp(m.x, target, 14, dt);
        const frac = Math.min(1, left / POWERUPS[m.kind].duration);
        m.shown = frac > m.shown ? damp(m.shown, frac, 9, dt) : frac;
        this.drawRunning(m, left, railMax, dt);
      } else if (m.active) {
        m.active = false;
        m.dying = 0;
      }
      if (!m.active && m.dying >= 0) this.drawDying(m, dt);
      m.lastLeft = left;
      if (m.group.visible) this.shownCount++;
    }

    if (this.sweepT < 1) {
      this.sweepT = Math.min(1, this.sweepT + dt / SWEEP_TIME);
      const e = 1 - (1 - this.sweepT) * (1 - this.sweepT);
      this.sweep.position.x = (e - 0.5) * (bandW + 0.2);
      this.sweepMat.opacity = Math.sin(this.sweepT * Math.PI);
    }
    this.sweep.visible = this.sweepT < 1;
  }

  private start(m: Module): void {
    m.pop = 0;
    m.blink = 0;
    this.sweepT = 0;
    this.sweepMat.color.copy(m.color).lerp(WHITE, 0.5).multiplyScalar(1.6);
  }

  private drawRunning(m: Module, left: number, railMax: number, dt: number): void {
    m.pop += dt;
    // Pop-in: a springy overshoot and a flash that settles in a few tenths of a second.
    const flash = Math.exp(-m.pop * 6);
    let scale = 1 + 0.55 * Math.exp(-m.pop * 8) * Math.cos(m.pop * 20);
    let bright = 1;
    let white = flash * 0.6;
    if (left < POWER_WARN) {
      // Running out: a strobe that quickens toward zero, each flash hotter and whiter.
      const urgency = 1 - left / POWER_WARN;
      m.blink += dt * (2.2 + urgency * 5.5);
      const on = m.blink % 1 < 0.55;
      bright = on ? 1.3 : 0.18;
      white += on ? 0.2 + urgency * 0.45 : 0;
      if (on) scale *= 1.06;
    }
    const c = m.rail.uColor.value.copy(m.color).lerp(WHITE, Math.min(1, white));
    m.glyphMat.color.copy(c).multiplyScalar(bright * (1 + flash * 1.5));
    m.haloMat.color.copy(c).multiplyScalar(bright * (0.22 + flash * 0.9));
    m.glyph.scale.setScalar(scale);
    m.halo.scale.setScalar(0.9 + flash * 0.6);

    const len = Math.max(0.001, railMax * m.shown);
    const off = GLYPH / 2 + RAIL_GAP;
    m.railR.position.x = m.x + off;
    m.railL.position.x = m.x - off;
    m.railR.scale.x = len;
    m.railL.scale.x = -len;
    m.railL.visible = m.railR.visible = railMax * m.shown > 0.01;
    m.rail.uLen.value = len;
    m.rail.uTime.value = this.time;
    m.rail.uBright.value = bright * (1 + flash);
    m.glyph.position.x = m.halo.position.x = m.x;
    m.group.visible = true;
  }

  /** Ran out: the glyph flares white and bursts outward as it fades. */
  private drawDying(m: Module, dt: number): void {
    m.dying += dt;
    const t = m.dying / DIE_TIME;
    if (t >= 1) {
      m.dying = -1;
      m.group.visible = false;
      return;
    }
    const fade = (1 - t) * (1 - t);
    m.railL.visible = m.railR.visible = false;
    const c = m.glyphMat.color.copy(m.color).lerp(WHITE, 0.7).multiplyScalar(fade * 2.2);
    m.haloMat.color.copy(c).multiplyScalar(0.6);
    m.glyph.scale.setScalar(1 + t * 1.3);
    m.halo.scale.setScalar(1 + t * 2.4);
  }
}

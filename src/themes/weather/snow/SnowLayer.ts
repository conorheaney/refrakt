import * as THREE from 'three';
import { GRID, PADDLE } from '../../../gameplay/config';
import type { World } from '../../../gameplay/World';
import type { ParticleSystem } from '../../../engine/render/ParticleSystem';
import { PADDLE_HALF_D } from '../../../gameplay/entities/EntityViews';
import { FRONT_FADE, weatherDepth } from '../weatherDepth';

/** Volume the flakes drift through. Wide enough that a gust never blows the edge of it into the frame. */
const X_MIN = -34;
const WIDTH = 68;
const Y_MIN = -16;
const HEIGHT = 34;
/** Flakes fall both in front of the bricks (larger and softer, being nearer) and behind them (themes/weather/weatherDepth.ts). */
const Z_MIN = -7;
const Z_MAX = 3.5;

const FLAKES = 2200;
/** Fall speed in world units per second (each flake varies; bigger, nearer flakes fall a little faster). */
const FALL = 1.6;
/** Flake diameter in world units, before per-flake variation. */
const SIZE = 0.16;
/** Overall strength. Kept low enough that the ball always reads clearly through the snow. */
const OPACITY = 0.85;

/** Wind, in world units per second of sideways drift. Negative blows from right to left. */
const WIND = {
  /** The steady breeze between gusts. */
  base: -0.5,
  /** Added at the peak of a full-strength gust. */
  gust: -9,
  /** The first gust comes soon after entering the world so it is noticed... */
  firstMin: 6,
  firstMax: 11,
  /** ...then they space out (measured from the start of the second gust of a pair). */
  intervalMin: 14,
  intervalMax: 28,
  /** Gusts come in pairs: the second follows this long after the first has died away... */
  pairGapMin: 2,
  pairGapMax: 4,
  /** ...a little weaker, as this fraction of the first's strength. */
  pairEchoMin: 0.7,
  pairEchoMax: 0.95,
  /** Gust envelope, seconds: swell up, hold near the peak, die away. */
  rise: 2.4,
  holdMin: 1.5,
  holdMax: 4,
  fall: 3.5,
} as const;

/** Spindrift lifted off exposed top surfaces at the peak of a full gust, per world unit of width per second. */
const SPINDRIFT_RATE = 7;

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uFall;
uniform float uDrift;
uniform float uGust;
uniform float uXMin;
uniform float uWidth;
uniform float uYMin;
uniform float uHeight;
uniform float uSize;
uniform float uScale;
attribute float aRand;
attribute float aPhase;
varying float vAlpha;
varying float vSoft;

void main() {
  // Near flakes (high z) move faster across the screen than far ones: parallax sells the depth.
  float near = clamp((position.z + 7.0) / 10.5, 0.0, 1.0);
  float speed = uFall * (0.6 + 0.5 * aRand + 0.5 * near);
  float s = mod(position.y - uYMin - uTime * speed, uHeight);
  // Each flake tumbles side to side on its own rhythm; gusts flatten the tumble into a straight streak.
  float sway = (0.35 + 0.45 * aRand) * (1.0 - 0.6 * uGust);
  float wobble = sin(uTime * (0.7 + 0.9 * aRand) + aPhase) * sway
               + sin(uTime * (1.9 + 1.3 * aPhase / 6.2832) + aPhase * 2.0) * sway * 0.3;
  float drift = uDrift * (0.55 + 0.45 * near + 0.25 * aRand);
  float x = uXMin + mod(position.x - uXMin + drift + wobble, uWidth);
  vec3 p = vec3(x, uYMin + s, position.z);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float size = uSize * (0.55 + 0.9 * aRand) * (0.8 + 0.7 * near * near);
  gl_PointSize = max(1.0, size * uScale / -mv.z);
  // Fade in at the top and out at the bottom so wrapping never pops; flakes in front of the bricks are a
  // little fainter and softer so they never hide the ball.
  float edge = smoothstep(0.0, 3.0, s) * smoothstep(uHeight, uHeight - 3.0, s);
  float front = position.z > 0.0 ? ${FRONT_FADE.toFixed(2)} : 1.0;
  float twinkle = 0.85 + 0.15 * sin(uTime * (2.0 + 3.0 * aRand) + aPhase * 5.0);
  vAlpha = edge * front * twinkle * (0.45 + 0.55 * aRand);
  vSoft = 0.15 + 0.6 * near;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
varying float vSoft;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  // Far flakes are crisp dots; near ones are out of focus and blur into soft discs.
  float a = 1.0 - smoothstep(1.0 - vSoft, 1.0, d);
  a *= vAlpha * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

/**
 * Falling snow for worlds with WorldDef.weather === 'snow': soft round flakes in one draw call, animated on
 * the GPU. They tumble as they fall, and every so often a gust of wind sweeps them sideways and lifts
 * spindrift off the tops of the bricks and paddle. `gust` (0-1) lets the wind sound follow what is seen.
 * Normal (not additive) blending, so the flakes stay white against a pale, snowy backdrop.
 */
export class SnowLayer {
  readonly object: THREE.Points;
  private readonly uniforms = {
    uTime: { value: 0 },
    uFall: { value: FALL },
    uDrift: { value: 0 },
    uGust: { value: 0 },
    uXMin: { value: X_MIN },
    uWidth: { value: WIDTH },
    uYMin: { value: Y_MIN },
    uHeight: { value: HEIGHT },
    uSize: { value: SIZE },
    uScale: { value: 600 },
    uColor: { value: new THREE.Color(0xf4f8ff) },
    uOpacity: { value: OPACITY },
  };
  private time = 0;
  /** Sideways distance the wind has carried the snow so far (wrapped to the volume width). */
  private drift = 0;
  /** Strength of the current gust, 0 (calm) to 1. */
  private gustNow = 0;
  /** Peak of the current gust; 0 between gusts. */
  private gustPeak = 0;
  /** Seconds since the current gust began; -1 between gusts. */
  private gustAge = -1;
  private gustHold = 0;
  /** The current gust is the first of a pair, so another follows it. */
  private pairOpen = false;
  private untilGust = WIND.firstMin + Math.random() * (WIND.firstMax - WIND.firstMin);

  constructor(scene: THREE.Scene) {
    const position = new Float32Array(FLAKES * 3);
    const rand = new Float32Array(FLAKES);
    const phase = new Float32Array(FLAKES);
    for (let i = 0; i < FLAKES; i++) {
      const z = weatherDepth(Z_MIN, Z_MAX);
      position.set([X_MIN + Math.random() * WIDTH, Y_MIN + Math.random() * HEIGHT, z], i * 3);
      rand[i] = Math.random();
      phase[i] = Math.random() * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    this.object = new THREE.Points(geometry, material);
    // Flakes are placed in the vertex shader, so the geometry's bounds say nothing about what is on screen.
    this.object.frustumCulled = false;
    this.object.renderOrder = 10;
    this.object.visible = false;
    scene.add(this.object);
  }

  get active(): boolean {
    return this.object.visible;
  }

  /** How strong the wind is gusting right now, 0 (calm) to 1. */
  get gust(): number {
    return this.object.visible ? this.gustNow : 0;
  }

  /** Shown or hidden with the world; it changes only between worlds, behind the level transition. */
  setActive(on: boolean): void {
    if (on && !this.object.visible) {
      this.untilGust = WIND.firstMin + Math.random() * (WIND.firstMax - WIND.firstMin);
    }
    if (!on) {
      this.gustAge = -1;
      this.gustNow = 0;
      this.pairOpen = false;
    }
    this.object.visible = on;
  }

  /** Keeps flake sizes in world units for the current viewport (as ParticleSystem.setViewport). */
  setViewport(heightPx: number, fovDeg: number): void {
    this.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /**
   * @param realDt wall-clock time: the snow keeps falling and blowing in menus and pauses, like the rain.
   */
  update(realDt: number): void {
    if (!this.object.visible) return;
    // Wrap before float32 loses precision in the shader.
    this.time = (this.time + realDt) % 3600;
    this.uniforms.uTime.value = this.time;

    this.untilGust -= realDt;
    if (this.untilGust <= 0 && this.gustAge < 0) this.startGust();
    this.gustNow = 0;
    if (this.gustAge >= 0) {
      this.gustAge += realDt;
      this.gustNow = this.gustPeak * gustEnvelope(this.gustAge, this.gustHold);
      if (this.gustAge > WIND.rise + this.gustHold + WIND.fall) this.gustAge = -1;
    }
    // A slow, gentle breathing in the breeze so the calm between gusts never looks mechanical.
    const breeze = WIND.base * (1 + 0.35 * Math.sin(this.time * 0.21) + 0.2 * Math.sin(this.time * 0.53 + 1.3));
    this.drift = (this.drift + (breeze + WIND.gust * this.gustNow) * realDt) % WIDTH;
    this.uniforms.uDrift.value = this.drift;
    this.uniforms.uGust.value = this.gustNow;
  }

  /** Gusts come in pairs: a first one, then a slightly weaker second soon after it dies away. */
  private startGust(): void {
    const second = this.pairOpen;
    this.gustHold = WIND.holdMin + Math.random() * (WIND.holdMax - WIND.holdMin);
    this.gustPeak = second
      ? this.gustPeak * (WIND.pairEchoMin + Math.random() * (WIND.pairEchoMax - WIND.pairEchoMin))
      : 0.55 + Math.random() * 0.45;
    this.gustAge = 0;
    this.pairOpen = !second;
    this.untilGust = second
      ? WIND.intervalMin + Math.random() * (WIND.intervalMax - WIND.intervalMin)
      : WIND.rise + this.gustHold + WIND.fall + WIND.pairGapMin + Math.random() * (WIND.pairGapMax - WIND.pairGapMin);
  }

  /**
   * Gusts lift fine snow off the bricks with nothing above them and off the paddle, and blow it downwind.
   * Uses simulation time: spindrift freezes with everything else in pauses and hit-stop.
   */
  spindrift(dt: number, world: World, particles: ParticleSystem): void {
    if (!this.object.visible || dt <= 0 || this.gustNow < 0.2) return;
    const strength = (this.gustNow - 0.2) / 0.8;
    const grid = world.grid;
    for (const brick of world.bricks) {
      if (!brick.alive || !brick.solid) continue;
      const above = brick.row > 0 ? world.bricks[brick.index - GRID.cols] : null;
      if (above && above.alive && above.solid) continue;
      this.liftFrom(particles, brick.x, brick.y + grid.halfH, grid.halfW, grid.depth / 2, strength, dt);
    }
    const paddle = world.paddle;
    this.liftFrom(particles, paddle.x, paddle.y + PADDLE.halfH, paddle.width / 2, PADDLE_HALF_D, strength, dt);
  }

  /** Wisps from one top surface centred on (x, y), `halfW` wide and `halfD` deep. */
  private liftFrom(
    particles: ParticleSystem,
    x: number,
    y: number,
    halfW: number,
    halfD: number,
    strength: number,
    dt: number,
  ): void {
    // Expected count this frame, rounded up or down at random so low rates still average out.
    const count = Math.floor(SPINDRIFT_RATE * strength * halfW * 2 * dt + Math.random());
    const wind = Math.sign(WIND.gust);
    for (let n = 0; n < count; n++) {
      const g = 0.5 + 0.5 * strength;
      particles.emit(
        x + (Math.random() * 2 - 1) * halfW * 0.95,
        y + 0.06,
        (Math.random() * 2 - 1) * halfD * 0.85,
        wind * (2.5 + Math.random() * 3.5) * g,
        0.4 + Math.random() * 1.1,
        (Math.random() - 0.5) * 0.6,
        // Additive particles: kept dim, so the wisps read as fine powder rather than sparks.
        0.42 * g,
        0.47 * g,
        0.55 * g,
        0.1 + Math.random() * 0.12,
        0.5 + Math.random() * 0.6,
        0.8,
        1.2,
      );
    }
  }
}

/** Gust strength (0-1) `age` seconds into a gust held near its peak for `hold` seconds. */
export function gustEnvelope(age: number, hold: number): number {
  if (age < 0) return 0;
  if (age < WIND.rise) return smooth(age / WIND.rise);
  if (age < WIND.rise + hold) return 1;
  const t = (age - WIND.rise - hold) / WIND.fall;
  return t >= 1 ? 0 : 1 - smooth(t);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

import * as THREE from 'three';
import { GRID, PADDLE } from '../../../gameplay/config';
import type { World } from '../../../gameplay/World';
import type { ParticleSystem } from '../../../engine/render/ParticleSystem';
import { PADDLE_HALF_D } from '../../../gameplay/entities/EntityViews';
import { FRONT_FADE, weatherDepth } from '../weatherDepth';

/** Splashes per world unit of exposed top surface width per second (paddle and uncovered bricks). */
const SPLASH_RATE = 5;
/** Droplet tint; drawn additively, so this is also its brightness. */
const SPLASH_R = 0.8;
const SPLASH_G = 0.92;
const SPLASH_B = 1;

/** Volume the drops fall through. Wide and tall enough to fill the frame at 16:9 in every camera mode. */
const X_MIN = -30;
const X_MAX = 30;
const Y_MIN = -16;
const HEIGHT = 34;
/** Drops fall both in front of the bricks and behind them (themes/weather/weatherDepth.ts). */
const Z_MIN = -5;
const Z_MAX = 3;

const DROPS = 3000;
/** Fall speed in world units per second (each drop varies ±20%). */
const SPEED = 30;
/** Streak length in world units (each drop varies). */
const LENGTH = 2.2;
/** Horizontal drift per unit of fall: a light wind from the right. */
const SLANT = -0.1;
/** Overall strength. Kept low so the ball always reads clearly through the rain. */
const OPACITY = 0.5;

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uLength;
uniform float uSlant;
uniform float uYMin;
uniform float uHeight;
attribute float aTail;
attribute float aRand;
varying float vAlpha;

void main() {
  float speed = uSpeed * (0.8 + 0.4 * aRand);
  // Height above the bottom of the volume; wraps so each drop falls forever.
  float s = mod(position.y - uYMin - uTime * speed, uHeight);
  float len = uLength * (0.6 + 0.8 * aRand);
  vec3 p = vec3(position.x + uSlant * s, uYMin + s, position.z);
  // The tail trails up-wind of the head along the direction of fall.
  p.xy += aTail * len * vec2(uSlant, 1.0);
  // Fade in at the top and out at the bottom so wrapping never pops; drops in front of the bricks are a little fainter.
  float edge = smoothstep(0.0, 3.0, s) * smoothstep(uHeight, uHeight - 3.0, s);
  float front = position.z > 0.0 ? ${FRONT_FADE.toFixed(2)} : 1.0;
  vAlpha = (1.0 - aTail) * (0.45 + 0.55 * aRand) * edge * front;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;

void main() {
  float a = vAlpha * uOpacity;
  gl_FragColor = vec4(uColor * a, a);
}
`;

/**
 * Falling rain for worlds with WorldDef.weather === 'rain': thin, faint streaks in one draw call, animated
 * entirely on the GPU. Drawn additively without writing depth, so bricks and the ball stay on top of the
 * drops behind them and the backdrop shows through.
 */
export class RainLayer {
  readonly object: THREE.LineSegments;
  private readonly uniforms = {
    uTime: { value: 0 },
    uSpeed: { value: SPEED },
    uLength: { value: LENGTH },
    uSlant: { value: SLANT },
    uYMin: { value: Y_MIN },
    uHeight: { value: HEIGHT },
    uColor: { value: new THREE.Color(0xb8d4e6) },
    uOpacity: { value: OPACITY },
  };
  private time = 0;

  constructor(scene: THREE.Scene) {
    const position = new Float32Array(DROPS * 2 * 3);
    const tail = new Float32Array(DROPS * 2);
    const rand = new Float32Array(DROPS * 2);
    for (let i = 0; i < DROPS; i++) {
      const x = X_MIN + Math.random() * (X_MAX - X_MIN);
      const y = Y_MIN + Math.random() * HEIGHT;
      const z = weatherDepth(Z_MIN, Z_MAX);
      const r = Math.random();
      for (let v = 0; v < 2; v++) {
        const k = i * 2 + v;
        position.set([x, y, z], k * 3);
        tail[k] = v;
        rand[k] = r;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aTail', new THREE.BufferAttribute(tail, 1));
    geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.object = new THREE.LineSegments(geometry, material);
    // Drops are placed in the vertex shader, so the geometry's bounds say nothing about what is on screen.
    this.object.frustumCulled = false;
    this.object.renderOrder = 10;
    this.object.visible = false;
    scene.add(this.object);
  }

  get active(): boolean {
    return this.object.visible;
  }

  /** Shown or hidden with the world; it changes only between worlds, behind the level transition. */
  setActive(on: boolean): void {
    if (on && !this.object.visible) {
      this.untilStrike = LIGHTNING.firstMin + Math.random() * (LIGHTNING.firstMax - LIGHTNING.firstMin);
    }
    if (!on) {
      this.strikeAge = -1;
      this.flash = 0;
    }
    this.object.visible = on;
  }

  /**
   * Rain landing on the paddle and on bricks with nothing above them. The streaks live only on the GPU, so
   * splashes are spawned at the rate rain would hit each top surface rather than where a drawn drop lands.
   * Uses simulation time: splash particles freeze with everything else in pauses and hit-stop.
   */
  splash(dt: number, world: World, particles: ParticleSystem): void {
    if (!this.object.visible || dt <= 0) return;
    const grid = world.grid;
    for (const brick of world.bricks) {
      if (!brick.alive || !brick.solid) continue;
      const above = brick.row > 0 ? world.bricks[brick.index - GRID.cols] : null;
      if (above && above.alive && above.solid) continue;
      this.splashOn(particles, brick.x, brick.y + grid.halfH, grid.halfW, grid.depth / 2, dt);
    }
    const paddle = world.paddle;
    this.splashOn(particles, paddle.x, paddle.y + PADDLE.halfH, paddle.width / 2, PADDLE_HALF_D, dt);
  }

  /** Splashes on one top surface centred on (x, y), `halfW` wide and `halfD` deep. */
  private splashOn(particles: ParticleSystem, x: number, y: number, halfW: number, halfD: number, dt: number): void {
    // Expected count this frame, rounded up or down at random so low rates still average out.
    const count = Math.floor(SPLASH_RATE * halfW * 2 * dt + Math.random());
    // Just above the surface, so the surface itself does not hide half of each point.
    const sy = y + 0.08;
    for (let n = 0; n < count; n++) {
      const sx = x + (Math.random() * 2 - 1) * halfW * 0.92;
      const sz = (Math.random() * 2 - 1) * halfD * 0.85;
      // A brief bright point where the drop lands...
      particles.emit(sx, sy, sz, 0, 0, 0, SPLASH_R, SPLASH_G, SPLASH_B, 0.42, 0.12, 0, 0);
      // ...and two or three droplets thrown up and out, falling back under gravity.
      const droplets = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (let d = 0; d < droplets; d++) {
        particles.emit(
          sx,
          sy,
          sz,
          (Math.random() - 0.5) * 2.4 + SLANT * 4,
          2 + Math.random() * 2.2,
          (Math.random() - 0.5) * 1.2,
          SPLASH_R,
          SPLASH_G,
          SPLASH_B,
          0.16 + Math.random() * 0.1,
          0.24 + Math.random() * 0.14,
          1,
          14,
        );
      }
    }
  }

  /**
   * @param realDt wall-clock time: the streaks keep falling in menus and pauses, and a flash already under
   *               way always plays out at normal speed.
   * @param simDt  simulation time: the wait before the next strike only runs while the game does, so no
   *               lightning starts in a pause or on the power-up screen.
   */
  update(realDt: number, simDt: number): void {
    if (!this.object.visible) return;
    // Wrap before float32 loses precision in the shader. The drops reshuffle once an hour, which reads as rain.
    this.time = (this.time + realDt) % 3600;
    this.uniforms.uTime.value = this.time;

    this.untilStrike -= simDt;
    if (this.untilStrike <= 0) this.strike();
    this.flash = 0;
    if (this.strikeAge < 0) return;
    this.strikeAge += realDt;
    for (const pulse of this.pulses) {
      const t = this.strikeAge - pulse.at;
      if (t >= 0) this.flash += pulse.strength * Math.exp(-t / LIGHTNING.decay);
    }
    if (this.strikeAge > 2) this.strikeAge = -1;
  }

  /**
   * How bright the current lightning flash is, 0 (none) to 1. Environment turns it into backdrop brightness
   * and a cold light on the playfield.
   */
  flash = 0;
  /** Called on each strike: start the thunder `delay` seconds later; `strength` 0-1 (closer is louder). */
  onThunder: (delay: number, strength: number) => void = () => {};

  private untilStrike = LIGHTNING.firstMin + Math.random() * (LIGHTNING.firstMax - LIGHTNING.firstMin);
  /** Seconds since the current strike began; -1 between strikes. */
  private strikeAge = -1;
  private readonly pulses = [
    { at: 0, strength: 0 },
    { at: 0, strength: 0 },
  ];

  /**
   * A strike is one bright flash and a slightly weaker second one. Two flashes at least 0.35 s apart and
   * strikes many seconds apart stay well under the WCAG limit of three flashes in any one second. With
   * reduced motion requested, the flash is a single soft brightening.
   */
  private strike(): void {
    this.untilStrike = LIGHTNING.intervalMin + Math.random() * (LIGHTNING.intervalMax - LIGHTNING.intervalMin);
    // Every strike is a full one, close overhead; the little variation left keeps them from feeling stamped out.
    const strength = 0.92 + Math.random() * 0.08;
    const calm = reducedMotion();
    this.pulses[0].at = 0;
    this.pulses[0].strength = strength * (calm ? 0.25 : 1);
    this.pulses[1].at = 0.35 + Math.random() * 0.2;
    this.pulses[1].strength = calm ? 0 : strength * 0.75;
    this.strikeAge = 0;
    // Sound is slower than light (about 3 s per kilometre): the closest strikes crack almost with the flash,
    // and every strike here is close, so the thunder follows within about a second.
    this.onThunder(0.3 + Math.pow(1 - strength, 1.5) * 22, strength);
  }
}

/** Lightning timing (seconds). */
const LIGHTNING = {
  /** The first strike comes soon after entering the world so it is noticed... */
  firstMin: 5,
  firstMax: 10,
  /** ...then they space out. */
  intervalMin: 18,
  intervalMax: 38,
  /** How fast each flash fades. */
  decay: 0.2,
} as const;

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

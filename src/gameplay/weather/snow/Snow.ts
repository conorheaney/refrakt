import * as THREE from 'three';
import { GRID, PADDLE } from '../../config';
import type { World } from '../../World';
import { PADDLE_HALF_D } from '../../entities/EntityViews';
import {
  between,
  envelope,
  FRONT_FADE,
  PATH_GLSL,
  particleDepth,
  Weather,
  type WeatherContext,
  type WeatherFrame,
} from '../Weather';
import winterStorm from './sfx/winter-storm.mp3';
import { SNOW } from './snowInfo';

/** Flakes fall both in front of the bricks (larger and softer, being nearer) and behind them (see particleDepth). */
const Z_MIN = -7;
const Z_MAX = 3.5;
/** Flakes fall from their path to this far down (on the paths' plane; further at greater depths). */
const BOTTOM = -16;
/**
 * Flakes per world unit of width the snow covers, and the most there can be. Each path's snow blows about
 * within a band `BAND` wider than the path at either end (wrapping round from one side to the other).
 */
const FLAKES_PER_UNIT = 44;
const MAX_FLAKES = 2400;
const BAND = 3;
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
  /** A storm is a pair of gusts: the second follows this long after the first has died away... */
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

/** Gain of a gust's howl (before the ambience slider): a clear howl, still under the music. */
const GUST_LEVEL = 1;
/** Length of the wind recording (sfx/winter-storm.mp3) in seconds, and of each gust's stretch of it. */
const RECORDING = 61;
const GUST_SOUND: readonly [number, number] = [11, 15];
/** Seconds of play before the first distant ice creak, and between creaks after that. */
const CREAK_FIRST: readonly [number, number] = [14, 24];
const CREAK: readonly [number, number] = [28, 55];

const VERTEX = /* glsl */ `
${PATH_GLSL}
uniform float uTime;
uniform float uFall;
uniform float uDrift;
uniform float uGust;
uniform float uBottom;
uniform float uSize;
uniform float uScale;
attribute vec2 aBand;
attribute float aRand;
attribute float aPhase;
attribute float aSeed;
varying float vAlpha;
varying float vSoft;

void main() {
  float z = position.z;
  // Near flakes (high z) move faster across the screen than far ones: parallax sells the depth.
  float near = clamp((z + 7.0) / 10.5, 0.0, 1.0);
  float speed = uFall * (0.6 + 0.5 * aRand + 0.5 * near);
  // Each flake leaves its path (position.xy) and falls to the bottom, then starts again from the path.
  float k = depthScale(z);
  vec3 start = fromPath(position.xy, z);
  float h = max(start.y - (uCam.y + (uBottom - uCam.y) * k), 1.0);
  float s = mod(aSeed * h + uTime * speed, h);
  // Each flake tumbles side to side on its own rhythm; gusts flatten the tumble into a straight streak.
  float sway = (0.35 + 0.45 * aRand) * (1.0 - 0.6 * uGust);
  float wobble = sin(uTime * (0.7 + 0.9 * aRand) + aPhase) * sway
               + sin(uTime * (1.9 + 1.3 * aPhase / 6.2832) + aPhase * 2.0) * sway * 0.3;
  // The wind carries it along its path's band, wrapping round from one end to the other.
  float drift = uDrift * (0.55 + 0.45 * near + 0.25 * aRand);
  float left = uCam.x + (aBand.x - uCam.x) * k;
  float width = aBand.y * k;
  float u = mod(start.x - left + drift + wobble, width);
  vec4 mv = modelViewMatrix * vec4(left + u, start.y - s, z, 1.0);
  float size = uSize * (0.55 + 0.9 * aRand) * (0.8 + 0.7 * near * near);
  gl_PointSize = max(1.0, size * uScale / -mv.z);
  // Fades in as it leaves the path and out at the bottom and the band's ends, so wrapping never pops; flakes in
  // front of the bricks are a little fainter and softer so they never hide the ball.
  float edge = smoothstep(0.0, 1.5, s) * smoothstep(h, h - 3.0, s) * smoothstep(0.0, 1.5, u) * smoothstep(width, width - 1.5, u);
  float front = z > 0.0 ? ${FRONT_FADE.toFixed(2)} : 1.0;
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
 * Snow: soft round flakes falling from the snow's paths, tumbling as they fall and drifting on a light breeze,
 * in one draw call animated on the GPU. Normal (not additive) blending, so the flakes stay white against a pale,
 * snowy backdrop. Its storm is a pair of gusts that sweep the snow sideways, lift spindrift off the tops of the
 * bricks and paddle under it, and howl (each gust a different stretch of a stereo recording of a winter storm,
 * leaning right to left the way the snow blows); the calm between is quiet but for ice creaking far off now and
 * then. The world's ice chimes are part of its soundtrack ('crystal' in app/audio/Music.ts), where they keep time.
 */
export class Snow extends Weather {
  static readonly info = SNOW;
  static readonly samples = { winterStorm };

  private readonly points: THREE.Points;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly starts = new Float32Array(MAX_FLAKES * 3);
  private readonly band = new Float32Array(MAX_FLAKES * 2);
  private readonly startAttr = new THREE.BufferAttribute(this.starts, 3);
  private readonly bandAttr = new THREE.BufferAttribute(this.band, 2);
  private readonly uniforms = {
    ...this.pathUniforms,
    uTime: { value: 0 },
    uFall: { value: FALL },
    uDrift: { value: 0 },
    uGust: { value: 0 },
    uBottom: { value: BOTTOM },
    uSize: { value: SIZE },
    uScale: { value: 600 },
    uColor: { value: new THREE.Color(0xf4f8ff) },
    uOpacity: { value: OPACITY },
  };
  private time = 0;
  /** Sideways distance the wind has carried the snow so far. */
  private drift = 0;
  /** Strength of the current gust, 0 (calm) to 1. */
  private gustNow = 0;
  /** Peak of the current gust; 0 between gusts. */
  private gustPeak = 0;
  /** Seconds since the current gust began; -1 between gusts. */
  private gustAge = -1;
  private gustHold = 0;
  /** Seconds until the second gust of a pair (-1: none to come). */
  private untilEcho = -1;
  private untilCreak = between(...CREAK_FIRST);
  private lastSoundOffset = -RECORDING;

  constructor(ctx: WeatherContext) {
    super(ctx, SNOW, Snow.samples);
    const rand = new Float32Array(MAX_FLAKES);
    const phase = new Float32Array(MAX_FLAKES);
    const seed = new Float32Array(MAX_FLAKES);
    for (let i = 0; i < MAX_FLAKES; i++) {
      this.starts[i * 3 + 2] = particleDepth(Z_MIN, Z_MAX);
      rand[i] = Math.random();
      phase[i] = Math.random() * Math.PI * 2;
      seed[i] = Math.random();
    }
    const geometry = this.geometry;
    geometry.setAttribute('position', this.startAttr);
    geometry.setAttribute('aBand', this.bandAttr);
    geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geometry, material);
    // Flakes are placed in the vertex shader, so the geometry's bounds say nothing about what is on screen.
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.group.add(this.points);
  }

  /** How strong the wind is gusting right now, 0 (calm) to 1. */
  get gust(): number {
    return this.active ? this.gustNow : 0;
  }

  /** How many flakes are falling (more for wider paths). */
  get flakes(): number {
    return this.geometry.drawRange.count;
  }

  /** Where flake `i` leaves its path, and the band (left, width) it blows about in. */
  flake(i: number): { x: number; y: number; left: number; width: number } {
    return { x: this.starts[i * 3], y: this.starts[i * 3 + 1], left: this.band[i * 2], width: this.band[i * 2 + 1] };
  }

  protected onStart(fresh: boolean): void {
    // Each flake starts somewhere along the paths and blows about within its path's band.
    let width = 0;
    for (let p = 0; p < this.pathCount; p++) {
      const [left, right] = this.pathSpan(p);
      width += right - left + 2 * BAND;
    }
    const count = Math.min(MAX_FLAKES, Math.round(width * FLAKES_PER_UNIT));
    for (let i = 0; i < count; i++) {
      const at = this.pointOnPaths();
      const [left, right] = this.pathSpan(at.path);
      this.starts[i * 3] = at.x;
      this.starts[i * 3 + 1] = at.y;
      this.band[i * 2] = left - BAND;
      this.band[i * 2 + 1] = right - left + 2 * BAND;
    }
    this.geometry.setDrawRange(0, count);
    this.startAttr.needsUpdate = true;
    this.bandAttr.needsUpdate = true;
    if (fresh) {
      this.drift = 0;
      this.untilCreak = between(...CREAK_FIRST);
    }
  }

  protected onStop(): void {
    this.gustAge = -1;
    this.gustNow = 0;
    this.untilEcho = -1;
  }

  /** A storm: a gust, then a slightly weaker second one soon after it dies away. */
  protected onStorm(): void {
    if (this.gustAge >= 0 || this.untilEcho >= 0) return;
    this.blow(0.55 + Math.random() * 0.45);
    this.untilEcho = WIND.rise + this.gustHold + WIND.fall + between(WIND.pairGapMin, WIND.pairGapMax);
  }

  protected override onViewport(pointScale: number): void {
    this.uniforms.uScale.value = pointScale;
  }

  protected onFrame(frame: WeatherFrame): void {
    const dt = frame.realDt;
    // Wrap before float32 loses precision in the shader.
    this.time = (this.time + dt) % 3600;
    this.uniforms.uTime.value = this.time;

    // Gusts play out on the wall clock, like the snow itself.
    if (this.untilEcho >= 0) {
      this.untilEcho -= dt;
      if (this.untilEcho < 0) this.blow(this.gustPeak * between(WIND.pairEchoMin, WIND.pairEchoMax));
    }
    this.gustNow = 0;
    if (this.gustAge >= 0) {
      this.gustAge += dt;
      this.gustNow = this.gustPeak * envelope(this.gustAge, WIND.rise, this.gustHold, WIND.fall);
      if (this.gustAge > WIND.rise + this.gustHold + WIND.fall) this.gustAge = -1;
    }
    // A slow, gentle breathing in the breeze so the calm between gusts never looks mechanical.
    const breeze = WIND.base * (1 + 0.35 * Math.sin(this.time * 0.21) + 0.2 * Math.sin(this.time * 0.53 + 1.3));
    this.drift += (breeze + WIND.gust * this.gustNow) * dt;
    this.uniforms.uDrift.value = this.drift;
    this.uniforms.uGust.value = this.gustNow;

    this.spindrift(frame.simDt, frame.world);
    // Ice creaking far off: only while the game runs.
    if (frame.simDt > 0) {
      this.untilCreak -= frame.simDt;
      if (this.untilCreak <= 0) {
        this.untilCreak = between(...CREAK);
        this.creak();
      }
    }
  }

  /** One gust of `peak` strength, heard as a howl swept from right to left. */
  private blow(peak: number): void {
    this.gustPeak = peak;
    this.gustHold = between(WIND.holdMin, WIND.holdMax);
    this.gustAge = 0;
    const sound = this.sound;
    if (!sound) return;
    // A random stretch of the recording, well away from the last one; it runs a little past the gust on screen.
    const dur = between(...GUST_SOUND);
    let offset = Math.random() * (RECORDING - dur);
    if (Math.abs(offset - this.lastSoundOffset) < dur) offset = (offset + RECORDING / 2) % (RECORDING - dur);
    this.lastSoundOffset = offset;
    // The recording is already stereo, so the drift is only a gentle lean of its balance.
    const from = 0.25 + Math.random() * 0.15;
    sound.audio.sample('winterStorm', {
      vol: GUST_LEVEL * (0.8 + Math.random() * 0.3),
      offset,
      dur,
      fadeIn: 2.5,
      fadeOut: 4.5,
      pan: from,
      panTo: -from,
      when: sound.now,
      bus: 'ambience',
    });
  }

  /**
   * Gusts lift fine snow off the bricks with nothing above them and off the paddle (wherever it snows), and blow
   * it downwind. Uses simulation time: spindrift freezes with everything else in pauses and hit-stop.
   */
  private spindrift(dt: number, world: World): void {
    if (dt <= 0 || this.gustNow < 0.2) return;
    const strength = (this.gustNow - 0.2) / 0.8;
    const grid = world.grid;
    for (const brick of world.bricks) {
      if (!brick.alive || !brick.solid || !this.underPaths(brick.x, BAND)) continue;
      const above = brick.row > 0 ? world.bricks[brick.index - GRID.cols] : null;
      if (above && above.alive && above.solid) continue;
      this.liftFrom(brick.x, brick.y + grid.halfH, grid.halfW, grid.depth / 2, strength, dt);
    }
    const paddle = world.paddle;
    if (this.underPaths(paddle.x, BAND))
      this.liftFrom(paddle.x, paddle.y + PADDLE.halfH, paddle.width / 2, PADDLE_HALF_D, strength, dt);
  }

  /** Wisps from one top surface centred on (x, y), `halfW` wide and `halfD` deep. */
  private liftFrom(x: number, y: number, halfW: number, halfD: number, strength: number, dt: number): void {
    // Expected count this frame, rounded up or down at random so low rates still average out.
    const count = Math.floor(SPINDRIFT_RATE * strength * halfW * 2 * dt + Math.random());
    const wind = Math.sign(WIND.gust);
    for (let n = 0; n < count; n++) {
      const g = 0.5 + 0.5 * strength;
      this.ctx.particles.emit(
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

  /** Ice settling far off: a low groan with a dry crackle running through it (synthesised). */
  private creak(): void {
    const sound = this.sound;
    if (!sound) return;
    const { audio, now: t } = sound;
    const pan = (Math.random() - 0.5) * 1.4;
    const start = 55 + Math.random() * 25;
    audio.tone({
      freq: start,
      endFreq: start * 0.72,
      dur: 2.4,
      vol: 0.09,
      attack: 0.5,
      type: 'sawtooth',
      filter: 240,
      pan,
      when: t,
      bus: 'ambience',
    });
    audio.tone({
      freq: start * 1.5,
      endFreq: start * 1.15,
      dur: 1.8,
      vol: 0.035,
      attack: 0.4,
      type: 'sawtooth',
      filter: 400,
      pan,
      when: t + 0.15,
      bus: 'ambience',
    });
    const cracks = 4 + Math.floor(Math.random() * 6);
    let at = t + 0.3 + Math.random() * 0.4;
    for (let i = 0; i < cracks; i++) {
      audio.noise({
        dur: 0.025 + Math.random() * 0.04,
        vol: 0.05 + Math.random() * 0.07,
        filterType: 'bandpass',
        filter: 1400 + Math.random() * 2400,
        pan: pan + (Math.random() - 0.5) * 0.3,
        when: at,
        bus: 'ambience',
      });
      at += 0.03 + Math.random() * 0.16;
    }
  }
}

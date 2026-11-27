import * as THREE from 'three';
import { GRID, PADDLE } from '../../config';
import type { World } from '../../World';
import { PADDLE_HALF_D } from '../../entities/EntityViews';
import { reducedMotion } from '../../../engine/reducedMotion';
import { FRONT_FADE, PATH_GLSL, particleDepth, Ambience, type AmbienceContext, type AmbienceFrame } from '../Ambience';
import rainHeavy from './sfx/rain-heavy.mp3';
import thunderClose from './sfx/thunder-close.mp3';
import thunderDistant1 from './sfx/thunder-distant-1.mp3';
import thunderDistant2 from './sfx/thunder-distant-2.mp3';
import { RAIN } from './rainInfo';

/** Splashes per world unit of exposed top surface width per second (paddle and uncovered bricks). */
const SPLASH_RATE = 5;
/** Droplet tint; drawn additively, so this is also its brightness. */
const SPLASH_R = 0.8;
const SPLASH_G = 0.92;
const SPLASH_B = 1;

/** Drops fall both in front of the bricks and behind them (see particleDepth). */
const Z_MIN = -5;
const Z_MAX = 3;
/** Drops fall from their path to this far down (on the paths' plane; further at greater depths). */
const BOTTOM = -16;
/** Drops per world unit of path, and the most there can be. */
const DROPS_PER_UNIT = 50;
const MAX_DROPS = 3000;
/** Fall speed in world units per second (each drop varies ±20%). */
const SPEED = 30;
/** Streak length in world units (each drop varies). */
const LENGTH = 2.2;
/** Sideways drift per unit of fall: a light wind from the right. */
const SLANT = -0.1;
/** Overall strength. Kept low so the ball always reads clearly through the rain. */
const OPACITY = 0.5;

/** Lightning: how fast each flash fades (seconds), and how bright the playfield light and backdrop get. */
const FLASH_DECAY = 0.2;
const FLASH_LIGHT = 3.8;
const FLASH_BACKDROP = 1.15;
/** Gain of the rain loop (before the ambience slider): a bed under the music, never over it. */
const RAIN_LEVEL = 0.85;

const VERTEX = /* glsl */ `
${PATH_GLSL}
uniform float uTime;
uniform float uSpeed;
uniform float uLength;
uniform float uSlant;
uniform float uBottom;
attribute float aTail;
attribute float aRand;
attribute float aSeed;
varying float vAlpha;

void main() {
  float speed = uSpeed * (0.8 + 0.4 * aRand);
  // Each drop leaves its path (position.xy) and falls to the bottom, then starts again from the path.
  float k = depthScale(position.z);
  vec3 start = fromPath(position.xy, position.z);
  float h = max(start.y - (uCam.y + (uBottom - uCam.y) * k), 1.0);
  float s = mod(aSeed * h + uTime * speed, h);
  float len = uLength * (0.6 + 0.8 * aRand);
  vec3 p = vec3(start.x + uSlant * s, start.y - s, position.z);
  // The tail trails up-wind of the head, back along the way it fell.
  p.xy += aTail * len * vec2(-uSlant, 1.0);
  // Fades in as it leaves the path and out at the bottom; drops in front of the bricks are a little fainter.
  float edge = smoothstep(0.0, 3.0, s) * smoothstep(h, h - 3.0, s);
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
 * Rain: thin, faint streaks falling from the rain's paths in one draw call, animated entirely on the GPU, drawn
 * additively without writing depth so bricks and the ball stay on top of the drops behind them and the backdrop
 * shows through. Drops splash on the paddle and on bricks under the paths. A loop of heavy rain plays under the
 * music. Its pulse is a lightning strike: a bright flash and a weaker second one that light the playfield from
 * above and brighten the backdrop, then thunder.
 */
export class Rain extends Ambience {
  static readonly info = RAIN;
  static readonly samples = { rainHeavy, thunderClose, thunderDistant1, thunderDistant2 };

  private readonly lines: THREE.LineSegments;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly starts = new Float32Array(MAX_DROPS * 2 * 3);
  private readonly startAttr = new THREE.BufferAttribute(this.starts, 3);
  private readonly uniforms = {
    ...this.pathUniforms,
    uTime: { value: 0 },
    uSpeed: { value: SPEED },
    uLength: { value: LENGTH },
    uSlant: { value: SLANT },
    uBottom: { value: BOTTOM },
    uColor: { value: new THREE.Color(0xb8d4e6) },
    uOpacity: { value: OPACITY },
  };
  /** Cold light from above for lightning: always in the scene, dark until a strike. */
  private readonly lightning = new THREE.DirectionalLight(0xd8e6ff, 0);
  private time = 0;
  /** How bright the current lightning flash is, 0 (none) to about 1. */
  flash = 0;
  /** Seconds since the current strike began; -1 between strikes. */
  private strikeAge = -1;
  private readonly pulses = [
    { at: 0, strength: 0 },
    { at: 0, strength: 0 },
  ];

  constructor(ctx: AmbienceContext) {
    super(ctx, RAIN, Rain.samples);
    const tail = new Float32Array(MAX_DROPS * 2);
    const rand = new Float32Array(MAX_DROPS * 2);
    const seed = new Float32Array(MAX_DROPS * 2);
    for (let i = 0; i < MAX_DROPS; i++) {
      const z = particleDepth(Z_MIN, Z_MAX);
      const r = Math.random();
      const s = Math.random();
      for (let v = 0; v < 2; v++) {
        const k = i * 2 + v;
        this.starts[k * 3 + 2] = z;
        tail[k] = v;
        rand[k] = r;
        seed[k] = s;
      }
    }
    const geometry = this.geometry;
    geometry.setAttribute('position', this.startAttr);
    geometry.setAttribute('aTail', new THREE.BufferAttribute(tail, 1));
    geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.lines = new THREE.LineSegments(geometry, material);
    // Drops are placed in the vertex shader, so the geometry's bounds say nothing about what is on screen.
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    this.group.add(this.lines);
    this.lightning.position.set(-8, 20, 14);
    this.addLight(this.lightning);
  }

  /** How many drops are falling (more for longer paths). */
  get drops(): number {
    return this.geometry.drawRange.count / 2;
  }

  /** Where drop `i` leaves its path. */
  drop(i: number): { x: number; y: number } {
    return { x: this.starts[i * 6], y: this.starts[i * 6 + 1] };
  }

  protected onStart(): void {
    const count = Math.min(MAX_DROPS, Math.round(this.pathLength * DROPS_PER_UNIT));
    for (let i = 0; i < count; i++) {
      const at = this.pointOnPaths();
      for (let v = 0; v < 2; v++) {
        this.starts[(i * 2 + v) * 3] = at.x;
        this.starts[(i * 2 + v) * 3 + 1] = at.y;
      }
    }
    this.geometry.setDrawRange(0, count * 2);
    this.startAttr.needsUpdate = true;
  }

  protected onStop(): void {
    this.strikeAge = -1;
    this.flash = 0;
    this.lightning.intensity = 0;
    this.brightenBackdrop(0);
  }

  protected override onSound(on: boolean): void {
    this.ctx.audio?.setLoop('rainHeavy', on ? RAIN_LEVEL : 0, on ? 2.5 : 1);
  }

  /**
   * A strike is one bright flash and a slightly weaker second one. Two flashes at least 0.35 s apart and strikes
   * many seconds apart stay well under the WCAG limit of three flashes in any one second. With reduced motion
   * requested, the flash is a single soft brightening.
   */
  protected onPulse(): void {
    if (this.strikeAge >= 0) return;
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
    this.thunder(0.3 + Math.pow(1 - strength, 1.5) * 22, strength);
  }

  protected onFrame(frame: AmbienceFrame): void {
    // Wrap before float32 loses precision in the shader. The drops reshuffle once an hour, which reads as rain.
    this.time = (this.time + frame.realDt) % 3600;
    this.uniforms.uTime.value = this.time;
    this.splash(frame.simDt, frame.world);
    // A flash under way always plays out at normal speed.
    this.flash = 0;
    if (this.strikeAge >= 0) {
      this.strikeAge += frame.realDt;
      for (const pulse of this.pulses) {
        const t = this.strikeAge - pulse.at;
        if (t >= 0) this.flash += pulse.strength * Math.exp(-t / FLASH_DECAY);
      }
      if (this.strikeAge > 2) this.strikeAge = -1;
    }
    // Kept moderate so the ball still stands out at the peak of a flash.
    this.lightning.intensity = this.flash * FLASH_LIGHT;
    this.brightenBackdrop(this.flash * FLASH_BACKDROP);
  }

  /**
   * Rain landing on the paddle and on bricks with nothing above them, under the paths. The streaks live only on
   * the GPU, so splashes are spawned at the rate rain would hit each top surface rather than where a drawn drop
   * lands. Uses simulation time: splash particles freeze with everything else in pauses and hit-stop.
   */
  private splash(dt: number, world: World): void {
    if (dt <= 0) return;
    const grid = world.grid;
    for (const brick of world.bricks) {
      if (!brick.alive || !brick.solid || !this.underPaths(brick.x)) continue;
      const above = brick.row > 0 ? world.bricks[brick.index - GRID.cols] : null;
      if (above && above.alive && above.solid) continue;
      this.splashOn(brick.x, brick.y + grid.halfH, grid.halfW, grid.depth / 2, dt);
    }
    const paddle = world.paddle;
    if (this.underPaths(paddle.x))
      this.splashOn(paddle.x, paddle.y + PADDLE.halfH, paddle.width / 2, PADDLE_HALF_D, dt);
  }

  /** Splashes on one top surface centred on (x, y), `halfW` wide and `halfD` deep. */
  private splashOn(x: number, y: number, halfW: number, halfD: number, dt: number): void {
    const particles = this.ctx.particles;
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
   * Thunder for a strike, starting `delay` seconds after the flash; `strength` 0-1 scales loudness. Every strike
   * is a sharp crack (the close recording) with a long rolling rumble (one of the distant recordings) laid in
   * just behind it, both slowed a little so they are deeper and longer, and a synthesised rumble swelling
   * underneath that carries on after them (or, until the recordings load, a synthesised crack and roll). The
   * crack and rumble together trip the master compressor, which ducks the music for a moment; that is accepted
   * as part of the pulse.
   */
  private thunder(delay: number, strength: number): void {
    const sound = this.sound;
    if (!sound) return;
    const audio = sound.audio;
    const t = sound.now + delay;
    // Kept near the centre: thunder panned far to one side sounds further away.
    const pan = (Math.random() - 0.5) * 0.4;
    const rate = 0.86 + Math.random() * 0.06;
    const played = audio.sample('thunderClose', { vol: 1.5 * strength, pan, when: t, rate, bus: 'ambience' });
    audio.sample(Math.random() < 0.5 ? 'thunderDistant1' : 'thunderDistant2', {
      vol: 1.1 * strength,
      pan: -pan,
      when: t + 0.5,
      rate: rate * 0.95,
      bus: 'ambience',
    });
    // The long rolling tail, under the recordings or the synthesised fallback alike. Its top reaches about
    // 300 Hz so small speakers and headphones still carry it, not only a subwoofer.
    audio.swell({
      source: 'noise',
      filter: 320,
      endFilter: 60,
      vol: 0.5 * strength,
      attack: 0.8,
      hold: 2.5,
      release: 5,
      pan: -pan,
      when: t + 0.3,
      bus: 'ambience',
    });
    audio.swell({
      source: 'noise',
      filter: 220,
      endFilter: 50,
      vol: 0.4 * strength,
      attack: 1.5,
      hold: 2,
      release: 6,
      tremolo: { rate: 2.3, depth: 0.5 },
      pan,
      when: t + 1.2,
      bus: 'ambience',
    });
    if (played) return;
    audio.noise({ dur: 0.6, vol: 0.34 * strength, filter: 2600, endFilter: 300, pan, when: t, bus: 'ambience' });
    audio.noise({ dur: 4.5, vol: 0.85 * strength, filter: 240, endFilter: 70, pan, when: t + 0.05, bus: 'ambience' });
    audio.noise({
      dur: 3.8,
      vol: 0.6 * strength,
      filter: 170,
      endFilter: 55,
      pan: -pan,
      when: t + 0.4,
      bus: 'ambience',
    });
    audio.noise({ dur: 3.2, vol: 0.4 * strength, filter: 130, endFilter: 45, pan, when: t + 1, bus: 'ambience' });
  }
}

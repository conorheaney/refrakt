import * as THREE from 'three';
import type { AudioEngine, NoiseBed } from '../../../engine/audio/AudioEngine';
import { reducedMotion } from '../../../engine/reducedMotion';
import {
  between,
  envelope,
  FRONT_FADE,
  PATH_GLSL,
  particleDepth,
  Ambience,
  type AmbienceContext,
  type AmbienceFrame,
} from '../Ambience';
import stoneGate from './sfx/stone-gate.mp3';
import { DUST_Z, DUST } from './dustInfo';

/**
 * Where the light comes from in the Pharoughs Tomb painting, in pixels of the 1600 x 900 artwork (y down).
 * The backdrop is drawn in screen space (Environment.resizeBackdrop), so the beam and torch glows are worked
 * out in the same space and stay on the painted light whatever the camera or stage aspect does.
 */
const ART = {
  width: 1600,
  height: 900,
  /** The shaft of daylight coming down from the top right: where it enters and which way it falls. */
  beamFrom: [1185, 135],
  beamTo: [800, 480],
  /** The two wall torches, either side about half way up (centre of each flame). */
  torchLeft: [60, 305],
  torchRight: [1540, 305],
} as const;

/** Share of the falling grains that pour in veils from the paths' cracks (the rest are specks and grit). */
const VEIL_SHARE = 0.62;

/** Floating dust: a slow cloud of motes that only really shows in the light. */
const MOTES = 1500;
const MOTE_MIN = new THREE.Vector3(-26, -14, -7);
const MOTE_SIZE = new THREE.Vector3(52, 30, 11);
const MOTE_DIAMETER = 0.09;

/** A pulse: the stone gate grinds, then the tomb shakes and dust pours from the paths (seconds). */
const PULSE = {
  /** The gate grinds and the stone groans this long before the shake and the dust start. */
  lead: 1,
  rise: 0.4,
  holdMin: 2.4,
  holdMax: 3.6,
  fall: 1.6,
  /** Grains shaken loose (fine sifting dust and some grit), and how many cracks the veils pour from. */
  dust: 6000,
  sifts: 26,
} as const;

/** Torch flares: one torch (sometimes both) flares up, brightening the beam and making the dust glitter. */
const FLARE = {
  firstMin: 5,
  firstMax: 8,
  intervalMin: 15,
  intervalMax: 25,
  rise: 0.35,
  holdMin: 1.2,
  holdMax: 2.2,
  fall: 1.8,
  /** How much a full flare adds to its torch's light (normal flicker is about 0.6) and to the beam. */
  torch: 0.6,
  beam: 0.35,
  /** How much brighter, and how much faster, the lit dust twinkles in a full flare. */
  glitter: 0.5,
  glitterSpeed: 2.5,
} as const;

/** Overall strengths, kept in one place so the ball always reads clearly. */
const LOOK = {
  /** Extra light the animated beam adds over the painted one. */
  beam: 0.13,
  /** Glow round each torch flame per unit of its light squared (normal flicker is about 0.6, a flare up to 1.4). */
  torch: 0.24,
  /** Motes in shadow, and how much the beam and torches light them. */
  moteShadow: 0.2,
  moteLit: 1.7,
  ceilingDust: 0.85,
} as const;

/** Wall-torch light per unit of flicker: kept low so bricks keep their colours. */
const TORCH_LIGHT = 90;
/** Sound levels before the ambience slider, all kept well under the music: the room tone. */
const ROOM_LEVEL = 0.05;
/** Seconds between torch crackles (each torch on its own), and faster while it flares. */
const CRACKLE: readonly [number, number] = [0.12, 0.9];

const ART_GLSL = /* glsl */ `
uniform vec2 uArtRepeat;
uniform vec2 uArtOffset;
uniform float uBeam;
uniform vec2 uTorch;
uniform float uFlare;
uniform float uClock;

const vec2 ART_SIZE = vec2(${ART.width.toFixed(1)}, ${ART.height.toFixed(1)});
const vec2 BEAM_FROM = vec2(${ART.beamFrom[0].toFixed(1)}, ${ART.beamFrom[1].toFixed(1)});
const vec2 BEAM_TO = vec2(${ART.beamTo[0].toFixed(1)}, ${ART.beamTo[1].toFixed(1)});
const vec2 TORCH_L = vec2(${ART.torchLeft[0].toFixed(1)}, ${ART.torchLeft[1].toFixed(1)});
const vec2 TORCH_R = vec2(${ART.torchRight[0].toFixed(1)}, ${ART.torchRight[1].toFixed(1)});

/** A point on screen (0-1, y up) in pixels of the painting (y down), matching the backdrop's cover fit. */
vec2 artPx(vec2 screen) {
  vec2 uv = uArtOffset + screen * uArtRepeat;
  return vec2(uv.x, 1.0 - uv.y) * ART_SIZE;
}

/** The shaft of light, 0-1 (times uBeam): soft edges, widening as it falls, broken into slowly drifting rays. */
float beamLight(vec2 p) {
  vec2 dir = normalize(BEAM_TO - BEAM_FROM);
  vec2 d = p - BEAM_FROM;
  float along = dot(d, dir);
  // The shaft rocks a little about where it enters, as if the gap it shines through shifts.
  float across = dot(d, vec2(-dir.y, dir.x)) + along * 0.045 * sin(uClock * 0.21) + along * 0.02 * sin(uClock * 0.53 + 1.0);
  float w = 42.0 + along * 0.3;
  float body = 1.0 - smoothstep(0.15 * w, w, abs(across));
  float len = smoothstep(-40.0, 50.0, along) * (1.0 - smoothstep(260.0, 680.0, along));
  float rays = 0.55 + 0.45 * sin(across * 0.085 + 1.4 * sin(uClock * 0.37)) * sin(across * 0.029 - uClock * 0.16 + 1.0);
  return body * len * rays * uBeam;
}

/**
 * Warm light round the torch flames, falling off over about \`radius\` pixels. A brighter torch (a flare)
 * throws its light further as well as harder.
 */
float torchLight(vec2 p, float radius) {
  float l = length(p - TORCH_L) / (radius * (0.7 + 0.45 * uTorch.x));
  float r = length(p - TORCH_R) / (radius * (0.7 + 0.45 * uTorch.y));
  return exp(-l * l) * uTorch.x * uTorch.x + exp(-r * r) * uTorch.y * uTorch.y;
}
`;

const GLOW_VERTEX = /* glsl */ `
varying vec2 vScreen;
void main() {
  vScreen = position.xy * 0.5 + 0.5;
  // Pinned to the far plane: drawn over the backdrop, under every brick, ball and wall.
  gl_Position = vec4(position.xy, 0.99999, 1.0);
}
`;

const GLOW_FRAGMENT = /* glsl */ `
${ART_GLSL}
varying vec2 vScreen;
void main() {
  vec2 p = artPx(vScreen);
  vec3 c = vec3(1.0, 0.74, 0.42) * beamLight(p) * ${LOOK.beam.toFixed(3)}
         + vec3(1.0, 0.55, 0.22) * torchLight(p, 130.0) * ${LOOK.torch.toFixed(3)};
  gl_FragColor = vec4(c, 1.0);
}
`;

const MOTE_VERTEX = /* glsl */ `
${ART_GLSL}
uniform vec3 uMin;
uniform vec3 uSize;
uniform vec2 uBall;
uniform vec3 uPaddle;
uniform float uSizePx;
uniform float uScale;
attribute float aRand;
attribute float aPhase;
varying float vAlpha;

void main() {
  float t = uClock;
  vec3 p = position;
  // Dust settles slowly and drifts on a faint draught, both wrapping round the volume...
  p.y = uMin.y + mod(p.y - uMin.y - t * (0.05 + 0.12 * aRand), uSize.y);
  p.x = uMin.x + mod(p.x - uMin.x + t * (0.05 + 0.08 * aRand) + sin(t * (0.16 + 0.24 * aRand) + aPhase) * 1.6, uSize.x);
  // ...and is carried round in slow, lazy eddies that differ from place to place, so neighbouring motes
  // wander apart rather than marching in step.
  p.x += sin(p.y * 0.45 + t * (0.35 + 0.2 * aRand) + aPhase) * 0.7;
  p.y += sin(t * (0.22 + 0.3 * aRand) + aPhase * 1.7) * 0.6 + cos(p.x * 0.38 - t * 0.3 + aPhase) * 0.45;
  p.z += sin(t * (0.12 + 0.15 * aRand) + aPhase * 2.3) * 0.25;
  // Motes near the play plane are pushed aside by the ball and paddle, so moving through the light stirs it.
  float plane = 1.0 - smoothstep(0.6, 1.8, abs(p.z));
  vec2 db = p.xy - uBall;
  float lb = length(db);
  p.xy += db / max(lb, 0.001) * 0.9 * (1.0 - smoothstep(0.0, 1.7, lb)) * plane;
  vec2 dp = vec2(sign(p.x - uPaddle.x) * max(abs(p.x - uPaddle.x) - uPaddle.z, 0.0), p.y - uPaddle.y);
  float lp = length(dp);
  p.xy += dp / max(lp, 0.001) * 0.6 * (1.0 - smoothstep(0.0, 1.1, lp)) * plane;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec4 clip = projectionMatrix * mv;
  vec2 art = artPx(clip.xy / clip.w * 0.5 + 0.5);
  float lit = beamLight(art) + torchLight(art, 230.0) * 0.55;
  // In a flare the lit dust glitters: a faster, deeper twinkle.
  float speed = 1.3 + 2.2 * aRand + uFlare * ${FLARE.glitterSpeed.toFixed(2)};
  float twinkle = 0.7 + (0.3 + 0.2 * uFlare) * sin(t * speed + aPhase * 4.0);
  lit *= 1.0 + ${FLARE.glitter.toFixed(2)} * uFlare;
  float front = p.z > 0.0 ? ${FRONT_FADE.toFixed(2)} : 1.0;
  vAlpha = (${LOOK.moteShadow.toFixed(3)} + lit * ${LOOK.moteLit.toFixed(3)}) * twinkle * (0.35 + 0.65 * aRand) * front;
  gl_PointSize = max(1.0, uSizePx * (0.6 + 0.9 * aRand) * uScale / -mv.z);
  gl_Position = clip;
}
`;

const MOTE_FRAGMENT = /* glsl */ `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.2, 1.0, d)) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(1.0, 0.82, 0.55, a);
}
`;

const DUST_VERTEX = /* glsl */ `
${ART_GLSL}
${PATH_GLSL}
uniform float uTime;
uniform float uOn;
uniform float uOff;
uniform float uScale;
attribute float aRand;
attribute float aPhase;
attribute float aSift;
varying float vAlpha;
varying vec3 vColor;

float hash(float n) { return fract(sin(n * 12.9898 + 1.7) * 43758.5453); }

void main() {
  // Each grain loops on its own cycle and shows only if it was shaken loose during the pulse.
  float life = 2.4 + 0.8 * aRand;
  float age = mod(uTime + aPhase * life, life);
  float born = uTime - age;
  if (born < uOn || born > uOff) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    return;
  }
  // Three kinds: dust sifting down in thin veils from cracks all along the paths (most of it), fine specks
  // scattered between them, and grit that drops fast.
  float x;
  float fall;
  float size;
  float alpha;
  vec3 color = mix(vec3(0.55, 0.38, 0.18), vec3(0.86, 0.66, 0.4), aPhase);
  // position.xy is where the grain leaves the paths (its crack, for a veil; see onStart), moved to its depth.
  vec3 start = fromPath(position.xy, position.z);
  if (aRand < ${VEIL_SHARE.toFixed(2)}) {
    // Each crack pours on its own rhythm, so the veils start and stop unevenly.
    float pour = step(0.35, sin(born * (2.0 + 2.0 * hash(aSift)) + aSift * 5.0) * 0.5 + 0.5);
    x = start.x + (aPhase - 0.5) * (0.08 + 0.12 * age);
    fall = 0.8 * age + 0.5 * 5.5 * age * age;
    size = 0.035;
    alpha = 0.75 * pour;
  } else if (aRand < 0.9) {
    x = start.x + sin(age * 1.7 + aPhase * 6.0) * 0.15;
    fall = 1.6 * age + 0.5 * 1.2 * age * age;
    size = 0.03;
    alpha = 0.5;
  } else {
    x = start.x;
    fall = 0.5 * 14.0 * age * age;
    size = 0.06 + 0.05 * aPhase;
    alpha = 0.95;
    color = vec3(0.45, 0.3, 0.16);
  }
  vec3 p = vec3(x, start.y - fall, position.z);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec4 clip = projectionMatrix * mv;
  float lit = beamLight(artPx(clip.xy / clip.w * 0.5 + 0.5));
  vColor = color * (1.0 + 0.3 * lit);
  // Thins out as it falls and spreads.
  vAlpha = alpha * smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.45 * life, life, age));
  gl_PointSize = max(1.0, size * uScale / -mv.z);
  gl_Position = clip;
}
`;

const DUST_FRAGMENT = /* glsl */ `
uniform float uOpacity;
varying float vAlpha;
varying vec3 vColor;
void main() {
  // Hard-edged specks: dust that falls, not smoke that billows.
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  gl_FragColor = vec4(vColor, vAlpha * uOpacity);
}
`;

const NEVER = 1e9;

/**
 * Dust, made for the Pharoughs Tomb painting: fine dust motes drifting through the room that glow gold where
 * the painted shaft of light and the wall torches catch them, an animated beam and torch glow over the painting,
 * and warm light from the torches on the playfield. Now and then a torch flares up. It sounds like a still room
 * with the torches crackling either side. Its pulse: a stone gate grinds open, then the tomb shakes and dust and
 * grit pour from its paths (a lintel, an arch) while the beam flickers, with a deep stone rumble and small
 * stones falling. Everything is animated on the GPU in three draw calls; the falling dust uses normal blending,
 * as added light would vanish against the bright sandstone. All its sound but the gate is synthesised.
 */
export class Dust extends Ambience {
  static readonly info = DUST;
  static readonly samples = { stoneGate };

  private readonly glow: THREE.Mesh;
  private readonly motes: THREE.Points;
  private readonly ceilingDust: THREE.Points;
  /** Per falling grain: start position (x, y on the paths; z depth), kind (aRand) and crack (aSift). */
  private readonly dustPos = new Float32Array(PULSE.dust * 3);
  private readonly dustPosAttr = new THREE.BufferAttribute(this.dustPos, 3);
  private readonly dustRand = new Float32Array(PULSE.dust);
  private readonly dustSift = new Float32Array(PULSE.dust);
  private readonly art = {
    uArtRepeat: { value: new THREE.Vector2(1, 1) },
    uArtOffset: { value: new THREE.Vector2(0, 0) },
    uBeam: { value: 1 },
    uTorch: { value: new THREE.Vector2(0.6, 0.6) },
    uFlare: { value: 0 },
    uClock: { value: 0 },
  };
  private readonly moteUniforms = {
    ...this.art,
    uMin: { value: MOTE_MIN.clone() },
    uSize: { value: MOTE_SIZE.clone() },
    uBall: { value: new THREE.Vector2(999, 999) },
    uPaddle: { value: new THREE.Vector3(999, 999, 1) },
    uSizePx: { value: MOTE_DIAMETER },
    uScale: { value: 600 },
  };
  private readonly dustUniforms = {
    ...this.art,
    ...this.pathUniforms,
    uTime: { value: 0 },
    uOn: { value: NEVER },
    uOff: { value: NEVER },
    uScale: { value: 600 },
    uOpacity: { value: LOOK.ceilingDust },
  };
  /** Warm light from the wall torches either side: always in the scene, dark unless this is the ambience. */
  private readonly torchLeft = new THREE.PointLight(0xff8a3a, 0, 34, 2);
  private readonly torchRight = new THREE.PointLight(0xff8a3a, 0, 34, 2);

  private time = 0;
  private pulseAge = -1;
  private pulsePeak = 0;
  private pulseHold = 0;
  /** Seconds of warning (the gate, the groan) left before the pulse's shake and dust; 0 when none is coming. */
  private pulseLead = 0;
  /** How hard the tomb is shaking right now, 0-1. */
  rumble = 0;

  private untilFlare = between(FLARE.firstMin, FLARE.firstMax);
  private flareAge = -1;
  private flareHold = 0;
  private flareSide: -1 | 0 | 1 = 0;
  private flarePeak = 0;
  /** How bright the current torch flare is, 0-1. */
  flare = 0;
  /** Each torch's light right now (flicker plus flare), about 0.4-1.4: left, right. */
  readonly torches = new THREE.Vector2(0.6, 0.6);

  private room: NoiseBed | null = null;
  private readonly untilCrackle = [between(...CRACKLE), between(...CRACKLE)];
  /** How much each torch (left, right) is flaring, for its crackle, 0-1; set by a flare, decays on its own. */
  private readonly flaring = [0, 0];

  constructor(ctx: AmbienceContext) {
    super(ctx, DUST, Dust.samples);
    const glowMaterial = new THREE.ShaderMaterial({
      uniforms: this.art,
      vertexShader: GLOW_VERTEX,
      fragmentShader: GLOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), glowMaterial);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = -1;

    const position = new Float32Array(MOTES * 3);
    const rand = new Float32Array(MOTES);
    const phase = new Float32Array(MOTES);
    for (let i = 0; i < MOTES; i++) {
      const z = particleDepth(MOTE_MIN.z, MOTE_MIN.z + MOTE_SIZE.z);
      position.set([MOTE_MIN.x + Math.random() * MOTE_SIZE.x, MOTE_MIN.y + Math.random() * MOTE_SIZE.y, z], i * 3);
      rand[i] = Math.random();
      phase[i] = Math.random() * Math.PI * 2;
    }
    const moteGeometry = new THREE.BufferGeometry();
    moteGeometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    moteGeometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
    moteGeometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.motes = new THREE.Points(
      moteGeometry,
      new THREE.ShaderMaterial({
        uniforms: this.moteUniforms,
        vertexShader: MOTE_VERTEX,
        fragmentShader: MOTE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 10;

    const dPhase = new Float32Array(PULSE.dust);
    for (let i = 0; i < PULSE.dust; i++) {
      this.dustSift[i] = Math.floor(Math.random() * PULSE.sifts);
      // x and y: where on the paths it starts (onStart). z: behind the bricks (z = 0, half-depth 0.44), so it
      // never hides them or the ball.
      this.dustPos.set([0, 0, DUST_Z + (Math.random() - 0.5) * 1.8], i * 3);
      this.dustRand[i] = Math.random();
      dPhase[i] = Math.random();
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', this.dustPosAttr);
    dustGeometry.setAttribute('aRand', new THREE.BufferAttribute(this.dustRand, 1));
    dustGeometry.setAttribute('aPhase', new THREE.BufferAttribute(dPhase, 1));
    dustGeometry.setAttribute('aSift', new THREE.BufferAttribute(this.dustSift, 1));
    this.ceilingDust = new THREE.Points(
      dustGeometry,
      new THREE.ShaderMaterial({
        uniforms: this.dustUniforms,
        vertexShader: DUST_VERTEX,
        fragmentShader: DUST_FRAGMENT,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.ceilingDust.frustumCulled = false;
    this.ceilingDust.renderOrder = 9;

    this.group.add(this.glow, this.motes, this.ceilingDust);
    this.torchLeft.position.set(-17, 2.5, 3);
    this.torchRight.position.set(17, 2.5, 3);
    this.addLight(this.torchLeft);
    this.addLight(this.torchRight);
  }

  /** Where each falling grain leaves the paths, and whether it is a veil (from a crack) rather than a speck or grit. */
  grains(): { x: number; y: number; veil: boolean }[] {
    return Array.from(this.dustRand, (r, i) => ({
      x: this.dustPos[i * 3],
      y: this.dustPos[i * 3 + 1],
      veil: r < VEIL_SHARE,
    }));
  }

  /**
   * Puts every falling grain's start on the paths: the cracks (one per sift) at random places along them, each
   * veil grain at its crack, and specks and grit anywhere along them.
   */
  protected onStart(fresh: boolean): void {
    const cracks = Array.from({ length: PULSE.sifts }, () => this.pointOnPaths());
    for (let i = 0; i < PULSE.dust; i++) {
      const p = this.dustRand[i] < VEIL_SHARE ? cracks[this.dustSift[i]] : this.pointOnPaths();
      this.dustPos[i * 3] = p.x;
      this.dustPos[i * 3 + 1] = p.y;
    }
    this.dustPosAttr.needsUpdate = true;
    if (fresh) this.untilFlare = between(FLARE.firstMin, FLARE.firstMax);
  }

  protected onStop(): void {
    this.dustUniforms.uOn.value = NEVER;
    this.dustUniforms.uOff.value = NEVER;
    this.pulseAge = -1;
    this.pulseLead = 0;
    this.flareAge = -1;
    this.rumble = 0;
    this.flare = 0;
    this.torchLeft.intensity = 0;
    this.torchRight.intensity = 0;
    this.brightenBackdrop(0);
  }

  protected override onSound(on: boolean): void {
    if (on) return;
    this.room?.stop(1.5);
    this.room = null;
  }

  /** A pulse: the gate grinds and the stone groans, then (PULSE.lead later) the shake and the dust. */
  protected onPulse(): void {
    if (this.pulseLead > 0 || this.pulseAge >= 0) return;
    this.pulsePeak = 0.85 + Math.random() * 0.15;
    this.pulseHold = between(PULSE.holdMin, PULSE.holdMax);
    this.pulseLead = PULSE.lead;
    const sound = this.sound;
    if (!sound) return;
    this.gateSound(sound.audio, sound.now);
    this.rumbleSound(sound.audio, sound.now, this.pulsePeak, this.pulseHold);
  }

  protected override onViewport(pointScale: number, aspect: number): void {
    this.moteUniforms.uScale.value = pointScale;
    this.dustUniforms.uScale.value = pointScale;
    // Matches the backdrop's cover fit for the stage aspect (see Environment.resizeBackdrop).
    const imageAspect = ART.width / ART.height;
    const x = Math.min(1, aspect / imageAspect);
    const y = Math.min(1, imageAspect / aspect);
    this.art.uArtRepeat.value.set(x, y);
    this.art.uArtOffset.value.set((1 - x) / 2, (1 - y) / 2);
  }

  /**
   * The dust keeps drifting in menus and pauses, and a pulse or flare already under way plays out at normal speed
   * (wall-clock time); the wait for the next flare and the torches' crackle only run while the game does.
   */
  protected onFrame(frame: AmbienceFrame): void {
    const realDt = frame.realDt;
    this.time += realDt;
    // Wrap before float32 loses precision in the shaders, shifting every stored time with the clock.
    if (this.time > 3000) {
      this.time -= 3000;
      if (this.dustUniforms.uOn.value < NEVER) {
        this.dustUniforms.uOn.value -= 3000;
        this.dustUniforms.uOff.value -= 3000;
      }
    }
    this.art.uClock.value = this.time;
    this.dustUniforms.uTime.value = this.time;
    // Motes near the ball and paddle are pushed aside.
    const ball = frame.ball;
    const paddle = frame.world.paddle;
    this.moteUniforms.uBall.value.set(ball ? ball.x : 999, ball ? ball.y : 999);
    this.moteUniforms.uPaddle.value.set(frame.paddleX, paddle.y, paddle.width / 2);

    this.updatePulse(realDt);
    this.updateFlare(realDt, frame.simDt);

    // Torches flicker on their own rhythms; a flare lifts one or both.
    const t = this.time;
    const calm = reducedMotion() ? 0.4 : 1;
    const flickL =
      0.62 + calm * (0.1 * Math.sin(t * 9.3) + 0.07 * Math.sin(t * 15.7 + 1.1) + 0.05 * Math.sin(t * 3.1 + 2));
    const flickR =
      0.62 + calm * (0.1 * Math.sin(t * 8.1 + 0.7) + 0.07 * Math.sin(t * 13.9 + 2.4) + 0.05 * Math.sin(t * 2.7 + 0.3));
    const left = this.flareSide <= 0 ? this.flare : 0;
    const right = this.flareSide >= 0 ? this.flare : 0;
    this.torches.set(flickL + left * FLARE.torch, flickR + right * FLARE.torch);
    this.art.uTorch.value.copy(this.torches);
    this.art.uFlare.value = this.flare;
    this.torchLeft.intensity = this.torches.x * TORCH_LIGHT;
    this.torchRight.intensity = this.torches.y * TORCH_LIGHT;
    // A flare warms the backdrop a little.
    this.brightenBackdrop(this.flare * 0.05);
    // The beam dims and flickers while dust pours through it, and brightens with a flare.
    const flicker = 0.5 + 0.5 * Math.sin(t * 21) * Math.sin(t * 6.7);
    this.art.uBeam.value = 1 - 0.55 * this.rumble * flicker + FLARE.beam * this.flare;
    // The shaking keeps a light camera shake going while it lasts.
    if (this.rumble > 0.05) this.ctx.shake(0.42 * this.rumble);
    this.roomSound(realDt, frame.simDt);
  }

  private updatePulse(realDt: number): void {
    if (this.pulseLead > 0) {
      // The warning: the shake and dust follow once it has built.
      this.pulseLead -= realDt;
      if (this.pulseLead <= 0) {
        this.pulseLead = 0;
        this.pulseAge = 0;
        this.dustUniforms.uOn.value = this.time;
        this.dustUniforms.uOff.value = this.time + PULSE.rise + this.pulseHold;
      }
    }
    this.rumble = 0;
    if (this.pulseAge < 0) return;
    this.pulseAge += realDt;
    this.rumble = this.pulsePeak * envelope(this.pulseAge, PULSE.rise, this.pulseHold, PULSE.fall);
    if (this.pulseAge > PULSE.rise + this.pulseHold + PULSE.fall) this.pulseAge = -1;
  }

  private updateFlare(realDt: number, simDt: number): void {
    this.untilFlare -= simDt;
    if (this.untilFlare <= 0 && this.flareAge < 0) {
      this.untilFlare = between(FLARE.intervalMin, FLARE.intervalMax);
      // Keep the two big moments apart: no flare while a pulse is under way.
      if (this.pulseAge < 0 && this.pulseLead <= 0) {
        const roll = Math.random();
        this.flareSide = roll < 0.25 ? 0 : roll < 0.625 ? -1 : 1;
        this.flarePeak = (0.65 + Math.random() * 0.35) * (reducedMotion() ? 0.5 : 1);
        this.flareHold = between(FLARE.holdMin, FLARE.holdMax);
        this.flareAge = 0;
        this.flareSound(this.flareSide, this.flarePeak);
      }
    }
    this.flare = 0;
    if (this.flareAge < 0) return;
    this.flareAge += realDt;
    this.flare = this.flarePeak * envelope(this.flareAge, FLARE.rise, this.flareHold, FLARE.fall);
    if (this.flareAge > FLARE.rise + this.flareHold + FLARE.fall) this.flareAge = -1;
  }

  // ------------------------------------------------------------------ sound

  /** The low, still room tone, and each torch crackling on its own (busier while it flares); crackles pause with the game. */
  private roomSound(realDt: number, simDt: number): void {
    for (let side = 0; side < 2; side++) this.flaring[side] = Math.max(0, this.flaring[side] - realDt * 0.3);
    const sound = this.sound;
    if (!sound) return;
    // The bed needs a running audio context, so it starts on the first frame that has one.
    if (!this.room) {
      this.room = sound.audio.noiseBed({ filter: 150, q: 0.9, bus: 'ambience' });
      this.room?.setLevel(ROOM_LEVEL, 3);
    }
    if (simDt <= 0) return;
    for (let side = 0; side < 2; side++) {
      this.untilCrackle[side] -= simDt * (1 + this.flaring[side] * 3);
      if (this.untilCrackle[side] > 0) continue;
      this.untilCrackle[side] = between(...CRACKLE);
      this.crackle(sound.audio, sound.now, side === 0 ? -0.8 : 0.8, this.flaring[side]);
    }
  }

  /** One pop or snap from a torch, louder and brighter while it flares. */
  private crackle(audio: AudioEngine, t: number, pan: number, flaring: number): void {
    const pops = Math.random() < 0.3 ? 2 + Math.floor(Math.random() * 3) : 1;
    let at = t;
    for (let i = 0; i < pops; i++) {
      audio.noise({
        dur: 0.012 + Math.random() * 0.03,
        vol: (0.02 + Math.random() * 0.035) * (1 + flaring * 1.5),
        filterType: 'bandpass',
        filter: 1800 + Math.random() * 3200,
        pan: pan + (Math.random() - 0.5) * 0.2,
        when: at,
        bus: 'ambience',
      });
      at += 0.02 + Math.random() * 0.06;
    }
  }

  /** A torch catching as it flares (side -1 left, 1 right, 0 both; strength 0-1): a soft, low whoomp of air. */
  private flareSound(side: -1 | 0 | 1, strength: number): void {
    const sides = side === 0 ? [-1, 1] : [side];
    for (const s of sides) this.flaring[s < 0 ? 0 : 1] = strength;
    const sound = this.sound;
    if (!sound) return;
    const { audio, now: t } = sound;
    for (const s of sides) {
      const pan = s * 0.75;
      audio.noise({ dur: 0.9, vol: 0.16 * strength, filter: 700, endFilter: 160, pan, when: t, bus: 'ambience' });
      audio.tone({
        freq: 90,
        endFreq: 60,
        dur: 0.7,
        vol: 0.05 * strength,
        attack: 0.08,
        filter: 300,
        pan,
        when: t,
        bus: 'ambience',
      });
    }
  }

  /**
   * The tomb shifting (strength `s`, 0-1): a groan of stone from the first warning (PULSE.lead before the shake), a
   * grinding judder through the whole shake (PULSE.rise, `hold`, PULSE.fall), then grit pouring and small stones
   * falling that carry on after the dust has settled. It is all well above the deep sub-bass as well as in it, so
   * it is heard on laptop and phone speakers too.
   */
  private rumbleSound(audio: AudioEngine, t: number, s: number, hold: number): void {
    const { lead, rise, fall } = PULSE;
    const shake = t + lead;
    const bus = 'ambience' as const;
    // The groan: builds from the first warning, through the shake, and dies away after it.
    audio.swell({
      source: 'noise',
      filter: 420,
      endFilter: 160,
      q: 1.1,
      vol: 0.75 * s,
      attack: lead + rise,
      hold,
      release: fall + 1.2,
      tremolo: { rate: 6, depth: 0.45 },
      when: t,
      bus,
    });
    // Stone grinding on stone: a rough judder in the mid range, only while it shakes.
    audio.swell({
      source: 'noise',
      filterType: 'bandpass',
      filter: 650,
      endFilter: 380,
      q: 1.4,
      vol: 0.5 * s,
      attack: rise,
      hold,
      release: fall,
      tremolo: { rate: 13, depth: 0.7 },
      pan: -0.3,
      when: shake,
      bus,
    });
    // A low creak whose harmonics carry on small speakers, and the deep weight under everything.
    audio.swell({
      source: 'sawtooth',
      freq: 68,
      endFreq: 52,
      filter: 380,
      q: 2,
      vol: 0.12 * s,
      attack: lead + rise,
      hold,
      release: fall,
      tremolo: { rate: 8.5, depth: 0.6 },
      pan: 0.3,
      when: t,
      bus,
    });
    audio.swell({
      source: 'sine',
      freq: 44,
      endFreq: 33,
      filter: 200,
      vol: 0.3 * s,
      attack: lead + rise,
      hold,
      release: fall + 0.6,
      when: t,
      bus,
    });
    // Grit pouring as the dust falls, trailing off after.
    audio.swell({
      source: 'noise',
      filterType: 'bandpass',
      filter: 2800,
      endFilter: 1600,
      q: 0.8,
      vol: 0.16 * s,
      attack: rise + 0.3,
      hold,
      release: fall + 1,
      when: shake,
      bus,
    });
    // Small stones dropping all the way through and for a moment after.
    const until = shake + rise + hold + fall + 1.2;
    let at = shake + 0.2 + Math.random() * 0.2;
    while (at < until) {
      audio.noise({
        dur: 0.04 + Math.random() * 0.06,
        vol: (0.1 + Math.random() * 0.15) * s,
        filterType: 'bandpass',
        filter: 600 + Math.random() * 1600,
        pan: (Math.random() - 0.5) * 1.6,
        when: at,
        bus,
      });
      at += 0.08 + Math.random() * 0.3;
    }
  }

  /**
   * A huge stone gate grinding open as the pulse begins (the dust follows PULSE.lead in, while it carries on): the
   * recording (sfx/stone-gate.mp3, mixed from three CC0 Freesound clips: see src/app/audio/SOUND_CREDITS.md), on
   * the effects bus but softened, its harshest highs filtered off; synthesised (gateSynth) until it has loaded.
   */
  private gateSound(audio: AudioEngine, t: number): void {
    if (audio.sample('stoneGate', { vol: 0.5, filter: 2400, when: t })) return;
    this.gateSynth(audio, t, 3.5);
  }

  /** The gate synthesised: a juddering low grind, a scrape over it, sub-bass weight and grit, then a thud. */
  private gateSynth(audio: AudioEngine, t: number, duration: number): void {
    const end = t + duration;
    const hold = Math.max(0.2, duration - 1.1);
    // The grind: low, rough and juddering (an uneven tremolo: two rates beating).
    audio.swell({
      source: 'noise',
      filterType: 'bandpass',
      filter: 260,
      endFilter: 150,
      q: 1.6,
      vol: 0.9,
      attack: 0.5,
      hold,
      release: 0.6,
      tremolo: { rate: 7, depth: 0.75 },
      when: t,
    });
    audio.swell({
      source: 'noise',
      filterType: 'bandpass',
      filter: 190,
      endFilter: 120,
      q: 2.2,
      vol: 0.55,
      attack: 0.7,
      hold,
      release: 0.5,
      tremolo: { rate: 4.3, depth: 0.6 },
      pan: -0.25,
      when: t,
    });
    // The scrape: stone edges rasping, harsher, panned the other way.
    audio.swell({
      source: 'noise',
      filterType: 'bandpass',
      filter: 1300,
      endFilter: 800,
      q: 2.5,
      vol: 0.3,
      attack: 0.3,
      hold,
      release: 0.4,
      tremolo: { rate: 17, depth: 0.85 },
      pan: 0.3,
      when: t,
    });
    // The weight: sub-bass rumble, and a creaking groan whose harmonics carry on small speakers.
    audio.swell({
      source: 'sine',
      freq: 38,
      endFreq: 30,
      filter: 160,
      vol: 0.55,
      attack: 0.6,
      hold,
      release: 0.9,
      when: t,
    });
    audio.swell({
      source: 'sawtooth',
      freq: 58,
      endFreq: 44,
      filter: 320,
      q: 2.5,
      vol: 0.16,
      attack: 0.8,
      hold,
      release: 0.6,
      tremolo: { rate: 5.5, depth: 0.5 },
      when: t,
    });
    // It catches and slips: short loud grinds every so often, and grit pattering down throughout.
    for (let at = t + 0.35 + Math.random() * 0.3; at < end - 0.4; at += 0.35 + Math.random() * 0.55) {
      audio.noise({
        dur: 0.12 + Math.random() * 0.18,
        vol: 0.35 + Math.random() * 0.2,
        filterType: 'bandpass',
        filter: 320 + Math.random() * 300,
        endFilter: 160,
        pan: (Math.random() - 0.5) * 0.8,
        when: at,
      });
    }
    for (let at = t + 0.2; at < end + 0.6; at += 0.06 + Math.random() * 0.2) {
      audio.noise({
        dur: 0.03 + Math.random() * 0.05,
        vol: 0.06 + Math.random() * 0.08,
        filterType: 'bandpass',
        filter: 900 + Math.random() * 2200,
        pan: (Math.random() - 0.5) * 1.6,
        when: at,
      });
    }
    // The slab thuds home as the dust blows in.
    audio.tone({ freq: 72, endFreq: 34, dur: 0.9, vol: 0.6, when: end - 0.1 });
    audio.noise({ dur: 0.5, vol: 0.5, filterType: 'lowpass', filter: 500, endFilter: 120, when: end - 0.1 });
  }
}

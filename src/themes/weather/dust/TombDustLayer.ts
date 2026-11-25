import * as THREE from 'three';
import { FRONT_FADE, weatherDepth } from '../weatherDepth';
import type { ArenaBounds } from '../../../gameplay/arena/boundary';

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

/** The cracks the rumble shakes dust from are in the underside of the painted lintel, this far below the field top. */
const CEILING_BELOW_TOP = 1.15;

/** Floating dust: a slow cloud of motes that only really shows in the light. */
const MOTES = 1500;
const MOTE_MIN = new THREE.Vector3(-26, -14, -7);
const MOTE_SIZE = new THREE.Vector3(52, 30, 11);
const MOTE_DIAMETER = 0.09;

/** Rumbles: the tomb shifts and dust pours from the whole ceiling (seconds). */
const RUMBLE = {
  firstMin: 8,
  firstMax: 12,
  intervalMin: 20,
  intervalMax: 40,
  /** The groan is heard this long before the shake and the dust start. */
  lead: 0.7,
  rise: 0.4,
  holdMin: 1.6,
  holdMax: 2.6,
  fall: 1.6,
  /** Grains shaken from the ceiling (fine sifting dust and some grit), and how many places it sifts from. */
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
  /** A flare due this close to the next rumble waits until after it. */
  clearOfRumble: 4,
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
uniform float uTop;
uniform float uTime;
uniform float uOn;
uniform float uOff;
uniform float uScale;
uniform float uHalfWidth;
attribute float aRand;
attribute float aPhase;
attribute float aSift;
varying float vAlpha;
varying vec3 vColor;

float hash(float n) { return fract(sin(n * 12.9898 + 1.7) * 43758.5453); }

void main() {
  // Each grain loops on its own cycle and shows only if it was shaken loose during the rumble.
  float life = 2.4 + 0.8 * aRand;
  float age = mod(uTime + aPhase * life, life);
  float born = uTime - age;
  if (born < uOn || born > uOff) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    return;
  }
  // Three kinds: dust sifting down in thin veils from cracks all along the lintel (most of it), fine specks
  // scattered between them, and grit that drops fast.
  float x;
  float fall;
  float size;
  float alpha;
  vec3 color = mix(vec3(0.55, 0.38, 0.18), vec3(0.86, 0.66, 0.4), aPhase);
  if (aRand < 0.62) {
    // Each crack pours on its own rhythm, so the veils start and stop unevenly.
    float pour = step(0.35, sin(born * (2.0 + 2.0 * hash(aSift)) + aSift * 5.0) * 0.5 + 0.5);
    x = (hash(aSift + 0.5) * 2.0 - 1.0) * uHalfWidth + (aPhase - 0.5) * (0.08 + 0.12 * age);
    fall = 0.8 * age + 0.5 * 5.5 * age * age;
    size = 0.035;
    alpha = 0.75 * pour;
  } else if (aRand < 0.9) {
    x = position.x * uHalfWidth + sin(age * 1.7 + aPhase * 6.0) * 0.15;
    fall = 1.6 * age + 0.5 * 1.2 * age * age;
    size = 0.03;
    alpha = 0.5;
  } else {
    x = position.x * uHalfWidth;
    fall = 0.5 * 14.0 * age * age;
    size = 0.06 + 0.05 * aPhase;
    alpha = 0.95;
    color = vec3(0.45, 0.3, 0.16);
  }
  vec3 p = vec3(x, uTop - fall, position.z);
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
 * Tomb dust for worlds with WorldDef.weather === 'dust', made for the Pharoughs Tomb painting: fine dust
 * motes drifting through the room that glow gold where the painted shaft of light and the wall torches
 * catch them, and an animated beam and torch glow over the painting. Every so often the tomb rumbles (a
 * small shake, dust and grit sifting down from the whole lintel, the beam flickering) and now and then a
 * torch flares up. Everything is animated on the GPU in three draw calls. The falling dust uses normal
 * blending: added light would vanish against the bright sandstone.
 */
export class TombDustLayer {
  readonly group = new THREE.Group();
  private readonly glow: THREE.Mesh;
  private readonly motes: THREE.Points;
  private readonly ceilingDust: THREE.Points;
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
    uTop: { value: 9.2 },
    uTime: { value: 0 },
    uOn: { value: NEVER },
    uOff: { value: NEVER },
    uScale: { value: 600 },
    uHalfWidth: { value: 12.5 },
    uOpacity: { value: LOOK.ceilingDust },
  };

  private time = 0;

  private untilRumble = between(RUMBLE.firstMin, RUMBLE.firstMax);
  private rumbleAge = -1;
  private rumblePeak = 0;
  private rumbleHold = 0;
  /** Seconds of warning groan left before the next rumble's shake and dust; 0 when none is coming. */
  private rumbleLead = 0;
  /** How hard the tomb is rumbling right now, 0-1. */
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

  /**
   * Called as a rumble is coming (strength 0-1), for the sound: the shake and dust start `lead` seconds later
   * and swell over `rise`, hold for `hold` and die away over `fall`.
   */
  onRumble: (strength: number, lead: number, rise: number, hold: number, fall: number) => void = () => {};
  /**
   * Whether the tomb rumbles on its own every so often (a world without scarab nests). In a world with them,
   * the dust storms come only with the scarabs (see storm).
   */
  autoRumble = true;

  /**
   * A storm on cue (gameplay/hazards/scarabs/scarabs.ts startStorm): the gate grinds for `lead` seconds (the
   * warning sound), then the dust blows in at full strength and for longer than an ordinary rumble.
   */
  storm(lead: number): void {
    if (!this.group.visible || this.rumbleLead > 0) return;
    this.rumblePeak = 1;
    this.rumbleHold = RUMBLE.holdMax + 1;
    this.rumbleLead = lead;
    this.rumbleAge = -1;
    this.onRumble(this.rumblePeak, lead, RUMBLE.rise, this.rumbleHold, RUMBLE.fall);
  }
  /** Called as a torch flares: side -1 left, 1 right, 0 both; strength 0-1. */
  onFlare: (side: -1 | 0 | 1, strength: number) => void = () => {};

  constructor(scene: THREE.Scene) {
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
      const z = weatherDepth(MOTE_MIN.z, MOTE_MIN.z + MOTE_SIZE.z);
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

    const dPos = new Float32Array(RUMBLE.dust * 3);
    const dRand = new Float32Array(RUMBLE.dust);
    const dPhase = new Float32Array(RUMBLE.dust);
    const dSift = new Float32Array(RUMBLE.dust);
    for (let i = 0; i < RUMBLE.dust; i++) {
      dSift[i] = Math.floor(Math.random() * RUMBLE.sifts);
      // Spread along the lintel (-1 to 1, times the world's half width in the shader).
      // Behind the bricks (z = 0, half-depth 0.44), so it never hides them or the ball.
      dPos.set([Math.random() * 2 - 1, 0, -2.5 + Math.random() * 1.8], i * 3);
      dRand[i] = Math.random();
      dPhase[i] = Math.random();
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
    dustGeometry.setAttribute('aRand', new THREE.BufferAttribute(dRand, 1));
    dustGeometry.setAttribute('aPhase', new THREE.BufferAttribute(dPhase, 1));
    dustGeometry.setAttribute('aSift', new THREE.BufferAttribute(dSift, 1));
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
    this.group.visible = false;
    scene.add(this.group);
  }

  get active(): boolean {
    return this.group.visible;
  }

  /** Shown or hidden with the world; it changes only between worlds, behind the level transition. */
  /** `arena`: the extent of the world's ball area, which the dust fills. */
  setActive(on: boolean, arena: ArenaBounds): void {
    this.dustUniforms.uTop.value = arena.top - CEILING_BELOW_TOP;
    this.dustUniforms.uHalfWidth.value = Math.max(-arena.left, arena.right) - 1.5;
    if (on && !this.group.visible) {
      this.untilRumble = between(RUMBLE.firstMin, RUMBLE.firstMax);
      this.untilFlare = between(FLARE.firstMin, FLARE.firstMax);
    }
    if (!on) {
      this.dustUniforms.uOn.value = NEVER;
      this.dustUniforms.uOff.value = NEVER;
      this.rumbleAge = -1;
      this.rumbleLead = 0;
      this.flareAge = -1;
      this.rumble = 0;
      this.flare = 0;
    }
    this.group.visible = on;
  }

  /** Keeps point sizes in world units for the current viewport (as ParticleSystem.setViewport). */
  setViewport(heightPx: number, fovDeg: number): void {
    const scale = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.moteUniforms.uScale.value = scale;
    this.dustUniforms.uScale.value = scale;
  }

  /** Matches the backdrop's cover fit for the stage aspect (see Environment.resizeBackdrop). */
  setAspect(aspect: number): void {
    const imageAspect = ART.width / ART.height;
    const x = Math.min(1, aspect / imageAspect);
    const y = Math.min(1, imageAspect / aspect);
    this.art.uArtRepeat.value.set(x, y);
    this.art.uArtOffset.value.set((1 - x) / 2, (1 - y) / 2);
  }

  /** Where the ball (or null) and paddle are, so the dust near them is pushed aside. */
  setStirrers(ball: { x: number; y: number } | null, paddleX: number, paddleY: number, paddleHalfWidth: number): void {
    this.moteUniforms.uBall.value.set(ball ? ball.x : 999, ball ? ball.y : 999);
    this.moteUniforms.uPaddle.value.set(paddleX, paddleY, paddleHalfWidth);
  }

  /**
   * @param realDt wall-clock time: the dust keeps drifting in menus and pauses, and a rumble or
   *               flare already under way plays out at normal speed.
   * @param simDt  simulation time: the waits before the next rumble and flare only run while the game does.
   */
  update(realDt: number, simDt: number): void {
    if (!this.group.visible) return;
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

    this.updateRumble(realDt, simDt);
    this.updateFlare(realDt, simDt);

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
    // The beam dims and flickers while dust pours through it in a rumble, and brightens with a flare.
    const flicker = 0.5 + 0.5 * Math.sin(t * 21) * Math.sin(t * 6.7);
    this.art.uBeam.value = 1 - 0.55 * this.rumble * flicker + FLARE.beam * this.flare;
  }

  private updateRumble(realDt: number, simDt: number): void {
    if (this.autoRumble) this.untilRumble -= simDt;
    if (this.autoRumble && this.untilRumble <= 0 && this.rumbleAge < 0 && this.rumbleLead <= 0) {
      this.untilRumble = between(RUMBLE.intervalMin, RUMBLE.intervalMax);
      this.rumblePeak = 0.6 + Math.random() * 0.4;
      this.rumbleHold = between(RUMBLE.holdMin, RUMBLE.holdMax);
      this.rumbleLead = RUMBLE.lead;
      this.onRumble(this.rumblePeak, RUMBLE.lead, RUMBLE.rise, this.rumbleHold, RUMBLE.fall);
    }
    if (this.rumbleLead > 0) {
      // The warning groan: the shake and dust follow once it has built.
      this.rumbleLead -= realDt;
      if (this.rumbleLead <= 0) {
        this.rumbleLead = 0;
        this.rumbleAge = 0;
        this.dustUniforms.uOn.value = this.time;
        this.dustUniforms.uOff.value = this.time + RUMBLE.rise + this.rumbleHold;
      }
    }
    this.rumble = 0;
    if (this.rumbleAge < 0) return;
    this.rumbleAge += realDt;
    this.rumble = this.rumblePeak * envelope(this.rumbleAge, RUMBLE.rise, this.rumbleHold, RUMBLE.fall);
    if (this.rumbleAge > RUMBLE.rise + this.rumbleHold + RUMBLE.fall) this.rumbleAge = -1;
  }

  private updateFlare(realDt: number, simDt: number): void {
    this.untilFlare -= simDt;
    if (this.untilFlare <= 0 && this.flareAge < 0) {
      if (this.rumbleAge >= 0 || this.rumbleLead > 0 || this.untilRumble < FLARE.clearOfRumble) {
        // Keep the two big moments apart.
        this.untilFlare = this.untilRumble + RUMBLE.rise + RUMBLE.holdMax + RUMBLE.fall + 2;
      } else {
        this.untilFlare = between(FLARE.intervalMin, FLARE.intervalMax);
        const roll = Math.random();
        this.flareSide = roll < 0.25 ? 0 : roll < 0.625 ? -1 : 1;
        this.flarePeak = (0.65 + Math.random() * 0.35) * (reducedMotion() ? 0.5 : 1);
        this.flareHold = between(FLARE.holdMin, FLARE.holdMax);
        this.flareAge = 0;
        this.onFlare(this.flareSide, this.flarePeak);
      }
    }
    this.flare = 0;
    if (this.flareAge < 0) return;
    this.flareAge += realDt;
    this.flare = this.flarePeak * envelope(this.flareAge, FLARE.rise, this.flareHold, FLARE.fall);
    if (this.flareAge > FLARE.rise + this.flareHold + FLARE.fall) this.flareAge = -1;
  }
}

/** Swell up over `rise`, hold for `hold`, die away over `fall` (0-1). */
export function envelope(age: number, rise: number, hold: number, fall: number): number {
  if (age < 0) return 0;
  if (age < rise) return smooth(age / rise);
  if (age < rise + hold) return 1;
  const t = (age - rise - hold) / fall;
  return t >= 1 ? 0 : 1 - smooth(t);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function between(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

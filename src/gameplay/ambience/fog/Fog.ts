import * as THREE from 'three';
import { ambienceOption } from '../settings';
import { between, envelope, Ambience, type AmbienceContext, type AmbienceFrame } from '../Ambience';
import bellToll from './sfx/bell-toll.mp3';
import fogDrone from './sfx/fog-drone.mp3';
import foghornEcho from './sfx/foghorn-echo.mp3';
import foghornFar from './sfx/foghorn-far.mp3';
import whispers from './sfx/whispers.mp3';
import { FOG } from './fogInfo';

/**
 * The fog is a volume, drawn in two full-screen slices that sample one drifting 3D noise volume: one just in front
 * of the play and one just behind it, with the scene's depth test doing the rest (the bricks hide the slice behind
 * them, and the slice in front veils them). Each slice looks along the line of sight at two depths (its layers:
 * depth, and the slab of depth each stands for, nearest first), so nearer fog drifts past faster than farther fog
 * and the whole moves as one body with true parallax. Two slices is the fewest that can put fog both in front of the
 * bricks and behind them, and each full-screen slice is costly, so there are no more. Neither comes within 1.5 of
 * the play (z = 0, where the bricks are 0.44 deep and the paddle 1.15), so neither cuts through anything; the far
 * layer behind stands for the distance beyond the room as well, over the painted backdrop.
 */
const FRONT_Z = 1.6;
const FRONT_LAYERS: readonly (readonly [number, number])[] = [
  [3.0, 1.3],
  [1.9, 1.2],
];
const BEHIND_Z = -1.6;
const BEHIND_LAYERS: readonly (readonly [number, number])[] = [
  [-3.5, 4],
  [-9, 9],
];
/** The depth of fog in front of the play, which its visibility is worked out from. */
const FRONT_DEPTH = FRONT_LAYERS.reduce((sum, [, depth]) => sum + depth, 0);
/**
 * How much of the bricks, paddle and ball the fog in front of them covers on average (0-1), in the calm and in a
 * full fog bank, at normal thickness; and the most a thick patch covers anywhere, in the calm and in a full bank,
 * so the game stays playable. The fog behind the play is thinner per unit of depth (BEHIND), so the room reads as
 * deep but the painted scenery still shows through.
 */
const COVER_CALM = 0.35;
const COVER_BANK = 0.65;
const PATCH_MAX_CALM = 0.65;
const PATCH_MAX_BANK = 0.9;
const BEHIND = 0.3;
/** Density (per unit of depth, averaged over the patches) that gives a cover over the fog in front of the play. */
const densityFor = (cover: number): number => -Math.log(1 - cover) / FRONT_DEPTH;
/**
 * The patches: where the noise rises from `low` to `high` the fog thickens from almost nothing to full, in the calm
 * and in a full bank (lower: more of the scene is in a patch). SEEP is the thin fog left between patches.
 */
const PATCH_CALM = { low: 0.36, high: 0.74 } as const;
const PATCH_BANK = { low: 0.26, high: 0.64 } as const;
const SEEP = 0.18;
/**
 * Fog lies in long, low banks: its patches are this much wider than tall. It is mostly the coarse noise, with a
 * little fine detail (NOISE_MIX of it coarse): more detail would read as smoke.
 */
const NOISE_MIX = 0.82;
/** How much wider than tall the fog's patches are. */
const STRETCH = 2.6;

/** How far above its line the fog fills (world units): from the floor to the top of the scene for a floor line. */
const FILL = 24;
/** How far beyond a path's ends its fog reaches, fading out (world units). */
const REACH = 5;
/** The most paths fog takes (FOG.paths.max). */
const PATHS = 6;
/**
 * The wind, world units per second: the patches drift across at DRIFT, gusting about it, and a full fog bank drives
 * them BANK_DRIFT faster. Each bank sets the way the wind blows (from the side it rolls in from) and the fog keeps
 * drifting that way after it, so over a level the fog goes from side to side. It also creeps upwards.
 */
const DRIFT = 0.9;
const BANK_DRIFT = 2.6;
const CREEP = 0.1;
/** World units across one tile of the 3D noise the fog is cut from (its patches are about a quarter of this). */
const BILLOW = 28;
/** How much a full fog bank darkens the painted backdrop, and the fog itself (it turns eerie, not bright). */
const GLOOM = 0.25;
const FOG_GLOOM = 0.25;

/** A pulse: a fog bank rolls in from one side, lingers and thins away again (seconds). */
const BANK = {
  rise: 4,
  holdMin: 5,
  holdMax: 8,
  fall: 6,
  /** Seconds for the bank's leading edge to cross the scene. */
  sweep: 6.5,
} as const;

/**
 * Light the fog scatters towards the eye: the ghost lights glow in the fog behind the play, scattered mostly
 * forwards, as fog does (Henyey-Greenstein, SCATTER), falling off over about REACH_LIGHT world units. The ball has
 * no light of its own in the fog: the fog veils it like the bricks and paddle, and nothing more.
 */
const SCATTER = 0.55;
const REACH_LIGHT = 2.6;
/** Ghost lights: will-o'-wisps drifting through the fog behind the bricks, lighting it from within. */
const GHOSTS = 6;
const GHOST_SIZE = 4.4;
const GHOST_LIGHT = 2.2;
/** Seconds before the first lone ghost light in the calm, and between them after that. */
const GHOST_FIRST: readonly [number, number] = [9, 16];
const GHOST_CALM: readonly [number, number] = [22, 40];

/** Sound levels before the ambience slider: the drone is a bed under the music, a little louder in a fog bank. */
const DRONE_LEVEL = 0.75;
const DRONE_BANK = 1.25;
const HORN_LEVEL = 0.8;
const WHISPER_LEVEL = 0.6;
const BELL_LEVEL = 0.4;
/** Length of the whisper recording (sfx/whispers.mp3) in seconds, and of each fog bank's stretch of it. */
const WHISPER_RECORDING = 60;
const WHISPER_SOUND: readonly [number, number] = [9, 12];
/** Seconds of play before the first distant bell, and between bells after that. */
const BELL_FIRST: readonly [number, number] = [8, 16];
const BELL: readonly [number, number] = [24, 48];

/** Side of the tileable 3D noise the fog is cut from, in texels. */
const NOISE_SIZE = 64;

/** GLSL shared by the slices: where fog is, the noise, the patches and the light scattered towards the eye. */
const FOG_GLSL = /* glsl */ `
uniform sampler3D uNoise;
uniform vec3 uCam;
uniform float uTime;
uniform vec3 uWind;
uniform float uDensity;
uniform float uBankDensity;
uniform float uSurge;
uniform float uFront;
uniform float uDir;
uniform vec2 uPatchCalm;
uniform vec2 uPatchBank;
uniform vec2 uPatchMean;
uniform vec4 uPaths[${PATHS}];
uniform int uPathCount;
uniform vec3 uColor;
uniform vec3 uShade;

/**
 * Where there is fog at all, 0-1: above each path, out to a little past its ends (soft-edged). p is where the line
 * of sight crosses the paths' plane (the play, z = 0), as the paths are drawn on it in the editor: so the fog fills
 * everything that shows above a line at every depth. (Tested at each depth instead, the lines of sight behind the
 * paddle, which the camera looks down on, would pass under a floor line within a few units and find no fog there.)
 */
float region(vec3 p) {
  float m = 0.0;
  for (int i = 0; i < ${PATHS}; i++) {
    if (i >= uPathCount) break;
    vec4 r = uPaths[i];
    float across = smoothstep(r.x - ${REACH.toFixed(1)}, r.x, p.x) * smoothstep(r.y + ${REACH.toFixed(1)}, r.y, p.x);
    float up = smoothstep(r.z - 1.5, r.z + 0.5, p.y) * (1.0 - smoothstep(r.z + ${(FILL - 4).toFixed(1)}, r.z + ${FILL.toFixed(1)}, p.y));
    m = max(m, across * up);
  }
  return m;
}

/** How far a fog bank has thickened the fog at x, 0-1: it rolls in from one side. */
float bankAt(float x) {
  float fx = clamp((x + 24.0) / 48.0, 0.0, 1.0);
  float arrive = uDir > 0.0 ? fx : 1.0 - fx;
  return uSurge * (1.0 - smoothstep(uFront - 0.25, uFront, arrive));
}

/**
 * The fog's density at p (per unit of depth), patchy: dense patches with thin fog between, drifting on the wind.
 * A bank makes the patches bigger and denser; averaged over the patches it is uDensity in the calm and
 * uBankDensity in a full bank (uPatchMean evens out what the patch shapes average), within the fog's region m
 * (region()). n is the noise, for shading.
 */
float density(vec3 p, float m, out float n) {
  // Stretched sideways: fog lies in long, low banks rather than piling up in puffs like smoke or cloud.
  vec3 q = (p - uWind) / vec3(${(BILLOW * Math.sqrt(STRETCH)).toFixed(1)}, ${(BILLOW / Math.sqrt(STRETCH)).toFixed(1)}, ${BILLOW.toFixed(1)});
  float n1 = texture(uNoise, q + vec3(0.0, 0.0, uTime * 0.006)).r;
  float n2 = texture(uNoise, q * 2.2 + vec3(0.0, 0.0, -uTime * 0.011) + (n1 - 0.5) * 0.25).r;
  n = n1 * ${NOISE_MIX.toFixed(2)} + n2 * ${(1 - NOISE_MIX).toFixed(2)};
  float b = bankAt(p.x);
  vec2 edge = mix(uPatchCalm, uPatchBank, b);
  float clump = ${SEEP.toFixed(2)} + smoothstep(edge.x, edge.y, n);
  return mix(uDensity, uBankDensity, b) * clump / mix(uPatchMean.x, uPatchMean.y, b) * m;
}

/** Henyey-Greenstein, relative to light scattered evenly: how much light is scattered at this angle (cosine). */
float phase(float c) {
  float g = ${SCATTER.toFixed(2)};
  return (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
}

/** Light from a light at l (w: its strength) scattered towards the eye at p. */
vec3 scattered(vec3 p, vec3 eye, vec4 l, vec3 color) {
  vec3 d = p - l.xyz;
  float r2 = dot(d, d);
  return color * l.w * phase(dot(d * inversesqrt(max(r2, 0.0001)), -eye)) / (1.0 + r2 / ${(REACH_LIGHT * REACH_LIGHT).toFixed(2)});
}

/** The fog's own colour at p: even (fog has none of a cloud's light and shade), a little lighter higher up. */
vec3 fogColor(vec3 p, float n) {
  return mix(uShade, uColor, clamp(0.62 + 0.08 * (n - 0.5) + p.y / 70.0, 0.0, 1.0));
}
`;

const SLICE_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/**
 * A slice's fragment shader: the fog along the line of sight at each of its layers (nearest first), each lit by
 * `light` (GLSL adding to the layer's colour c at p, the eye looking along eye), composited near over far,
 * covering at most uSliceMax. Pixels with next to no fog (below `faint`) are left alone, which saves drawing them.
 */
function sliceFragment(layers: readonly (readonly [number, number])[], uniforms: string, light: string, faint: number) {
  return /* glsl */ `
${FOG_GLSL}
uniform float uSliceScale;
uniform float uSliceMax;
${uniforms}
varying vec3 vWorld;

/** Where the line of sight through this pixel is at depth z. */
vec3 along(float z) {
  return uCam + (vWorld - uCam) * (uCam.z - z) / (uCam.z - vWorld.z);
}

void main() {
  vec3 eye = normalize(vWorld - uCam);
  float stretch = uSliceScale / max(abs(eye.z), 0.001);
  vec3 color = vec3(0.0);
  float tau = 0.0;
  // Whether this pixel shows above a fog line: the same at every depth along it.
  float m = region(along(0.0));
  if (m <= 0.0) discard;
  ${layers
    .map(
      ([z, depth], i) => `{
    vec3 p = along(${z.toFixed(1)});
    float n;
    float t = density(p, m, n) * ${depth.toFixed(1)} * stretch;
    vec3 c = fogColor(p, n);
    ${light}
    color ${i === 0 ? '=' : '+='} c * (1.0 - exp(-t))${i === 0 ? '' : ' * exp(-tau)'};
    tau += t;
  }`,
    )
    .join('\n  ')}
  float a = 1.0 - exp(-tau);
  if (a < ${faint.toFixed(3)}) discard;
  gl_FragColor = vec4(color / a, min(a, uSliceMax));
}
`;
}

/** The fog in front of the play: it veils the bricks, paddle and ball, and is lit by nothing of theirs. */
const FRONT_FRAGMENT = sliceFragment(FRONT_LAYERS, '', '', 0.012);

/** The fog behind the play, thinner per unit of depth (BEHIND): the ghost lights glow in it. */
const BEHIND_FRAGMENT = sliceFragment(
  BEHIND_LAYERS,
  `uniform vec4 uGhosts[${GHOSTS}];
uniform int uGhostCount;
uniform vec3 uGhostColor;`,
  `for (int g = 0; g < ${GHOSTS}; g++) {
      if (g >= uGhostCount) break;
      c += scattered(p, eye, uGhosts[g], uGhostColor);
    }`,
  0.003,
);

const GHOST_VERTEX = /* glsl */ `
uniform float uSize;
uniform float uScale;
attribute float aGlow;
varying float vGlow;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vGlow = aGlow;
  gl_PointSize = aGlow > 0.0 ? max(1.0, uSize * uScale / -mv.z) : 0.0;
  gl_Position = projectionMatrix * mv;
}
`;

const GHOST_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vGlow;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  // A small bright core in a faint halo (the fog round it glows too: BEHIND_FRAGMENT).
  float a = (exp(-d * d * 90.0) * 1.5 + 0.4 * exp(-d * d * 9.0)) * (1.0 - smoothstep(0.8, 1.0, d)) * vGlow;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, a);
}
`;

/** A will-o'-wisp drifting through the fog. */
interface Ghost {
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  phase: number;
  peak: number;
}

/**
 * Fog: a body of fog filling the scene above the fog's paths, evenly from low to high, drawn in two slices
 * through one drifting 3D noise volume (FRONT_LAYERS, BEHIND_LAYERS), so it moves with true depth and parallax, wraps
 * round the bricks and veils the distance. Patches of it drift from side to side across the bricks, veiling them as
 * they pass (about a third of them on average in the calm, a thick patch up to two thirds). Ghost lights glow
 * from within it; the ball has no effect on it, nor it on the ball beyond veiling it. Its colour and thickness are the
 * world's to choose (AmbienceSettings.options). It sounds like a whistling, droning wind with a bell tolling far
 * off now and then, and a lone ghost light sometimes drifts through the fog far behind. Its pulse: a foghorn
 * sounds and a fog bank rolls in from one side, its patches faster, bigger and thicker (two thirds of the bricks
 * veiled on average, the thickest patches up to nine tenths), while the backdrop darkens, ghost lights drift through it, and
 * whispers pass from one side to the other.
 */
export class Fog extends Ambience {
  static readonly info = FOG;
  static readonly samples = { fogDrone, foghornFar, foghornEcho, whispers, bellToll };

  /** Made the first time fog is used. */
  private noise: THREE.Data3DTexture | null = null;
  private readonly regionsNow = Array.from({ length: PATHS }, () => new THREE.Vector4());
  private readonly ghostLights4 = Array.from({ length: GHOSTS }, () => new THREE.Vector4());
  /** Uniforms both slices share. */
  private readonly uniforms = {
    uNoise: { value: null as THREE.Data3DTexture | null },
    uCam: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3() },
    uDensity: { value: densityFor(COVER_CALM) },
    uBankDensity: { value: densityFor(COVER_BANK) },
    uSurge: { value: 0 },
    uFront: { value: 0 },
    uDir: { value: 1 },
    uPatchCalm: { value: new THREE.Vector2(PATCH_CALM.low, PATCH_CALM.high) },
    uPatchBank: { value: new THREE.Vector2(PATCH_BANK.low, PATCH_BANK.high) },
    uPatchMean: { value: new THREE.Vector2(1, 1) },
    uPaths: { value: this.regionsNow },
    uPathCount: { value: 0 },
    uColor: { value: new THREE.Color() },
    uShade: { value: new THREE.Color() },
  };
  /** Uniforms of the slices in front of the play. */
  private readonly front = {
    uSliceScale: { value: 1 },
    uSliceMax: { value: 1 },
  };
  /** Uniforms of the slice behind it. */
  private readonly behind = {
    uSliceScale: { value: BEHIND },
    uSliceMax: { value: 1 },
    uGhosts: { value: this.ghostLights4 },
    uGhostCount: { value: 0 },
    uGhostColor: { value: new THREE.Color(0x6fe3c4) },
  };
  private readonly ghostPositions = new Float32Array(GHOSTS * 3);
  private readonly ghostGlow = new Float32Array(GHOSTS);
  private readonly ghostPosAttr = new THREE.BufferAttribute(this.ghostPositions, 3);
  private readonly ghostGlowAttr = new THREE.BufferAttribute(this.ghostGlow, 1);
  private readonly ghostUniforms = {
    uSize: { value: GHOST_SIZE },
    uScale: { value: 600 },
    uColor: { value: new THREE.Color(0x8af5d6) },
  };
  private readonly ghosts: (Ghost | null)[] = Array.from({ length: GHOSTS }, () => null);
  /** Ghost lights still to appear in the current fog bank: seconds until each. */
  private readonly ghostsDue: number[] = [];

  private time = 0;
  /** Sideways distance the fog has drifted so far, and how far it has crept up. */
  private drift = 0;
  private creep = 0;
  /** The way the wind blows: 1 to the right, -1 to the left (set by each fog bank). */
  private windDir: 1 | -1 = 1;
  /** The world's colour and thickness for its fog (1: normal). */
  private readonly baseColor = new THREE.Color();
  private thickness = 1;
  /** How thick the fog bank is right now, 0 (none) to 1. */
  private surgeNow = 0;
  private surgePeak = 0;
  /** Seconds since the current fog bank began; -1 between banks. */
  private bankAge = -1;
  private bankHold = 0;
  /** The side the bank rolls in from: 1 from the left, -1 from the right. */
  private bankDir: 1 | -1 = 1;
  private droneUp = false;
  private untilBell = between(...BELL_FIRST);
  private untilGhost = between(...GHOST_FIRST);
  private lastWhisper = -WHISPER_RECORDING;

  constructor(ctx: AmbienceContext) {
    super(ctx, FOG, Fog.samples);
    const plane = new THREE.PlaneGeometry(1, 1);
    const slice = (z: number, fragmentShader: string, uniforms: Record<string, THREE.IUniform>, order: number) => {
      const mesh = new THREE.Mesh(
        plane,
        new THREE.ShaderMaterial({
          uniforms: { ...this.uniforms, ...uniforms },
          vertexShader: SLICE_VERTEX,
          fragmentShader,
          transparent: true,
          depthWrite: false,
        }),
      );
      // Well past the edges of the view at any stage aspect.
      mesh.scale.set(150, 100, 1);
      mesh.position.z = z;
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.group.add(mesh);
    };
    slice(BEHIND_Z, BEHIND_FRAGMENT, this.behind, 10);
    slice(FRONT_Z, FRONT_FRAGMENT, this.front, 12);

    const ghostGeometry = new THREE.BufferGeometry();
    ghostGeometry.setAttribute('position', this.ghostPosAttr);
    ghostGeometry.setAttribute('aGlow', this.ghostGlowAttr);
    const ghosts = new THREE.Points(
      ghostGeometry,
      new THREE.ShaderMaterial({
        uniforms: this.ghostUniforms,
        vertexShader: GHOST_VERTEX,
        fragmentShader: GHOST_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    ghosts.frustumCulled = false;
    // Over the fog behind the play and under the fog in front; dimmed by the fog between it and the play (moveGhosts).
    ghosts.renderOrder = 11;
    this.group.add(ghosts);
  }

  /** How thick the fog bank is right now, 0 (calm) to 1. */
  get surge(): number {
    return this.active ? this.surgeNow : 0;
  }

  /**
   * How much of the bricks, paddle and ball the fog in front of them covers on average where a bank has arrived
   * (0-1): COVER_CALM in the calm and COVER_BANK in a full bank at normal thickness.
   */
  get cover(): number {
    if (!this.active) return 0;
    return Math.min(this.patchMax, 1 - Math.exp(-this.density() * FRONT_DEPTH));
  }

  /** The most a thick patch covers of the bricks, paddle and ball right now. */
  get patchMax(): number {
    return PATCH_MAX_CALM + (PATCH_MAX_BANK - PATCH_MAX_CALM) * this.surgeNow;
  }

  /** The way the fog is drifting: 1 to the right, -1 to the left. */
  get wind(): 1 | -1 {
    return this.windDir;
  }

  /** The fog's colour as set for this world. */
  get color(): string {
    return `#${this.baseColor.getHexString()}`;
  }

  /** Where there is fog: above each path (left, right, height of its line). */
  get regions(): { left: number; right: number; y: number }[] {
    return this.regionsNow.slice(0, this.uniforms.uPathCount.value).map((r) => ({ left: r.x, right: r.y, y: r.z }));
  }

  /** The depths of the two slices the fog is drawn in, far to near. */
  get slices(): number[] {
    return [BEHIND_Z, FRONT_Z];
  }

  /** How many ghost lights are showing. */
  get ghostLights(): number {
    return this.ghosts.filter((g) => g !== null).length;
  }

  protected onStart(fresh: boolean): void {
    if (!this.noise) {
      const { texture, data } = makeNoise(NOISE_SIZE);
      this.noise = texture;
      // What the patch shapes average over the noise, so the fog averages the density wanted however patchy.
      this.uniforms.uPatchMean.value.set(patchMean(data, PATCH_CALM), patchMean(data, PATCH_BANK));
    }
    this.uniforms.uNoise.value = this.noise;
    this.applyLook();
    // The fog fills the space above each path, from its line (its points' average height) up.
    const paths = this.settings.paths;
    for (let i = 0; i < this.pathCount && i < PATHS; i++) {
      const [left, right] = this.pathSpan(i);
      const points = paths[i].points;
      this.regionsNow[i].set(left, right, points.reduce((sum, p) => sum + p.y, 0) / points.length, 0);
    }
    this.uniforms.uPathCount.value = Math.min(PATHS, this.pathCount);
    if (fresh) {
      this.drift = 0;
      this.creep = 0;
      this.windDir = Math.random() < 0.5 ? 1 : -1;
      this.untilBell = between(...BELL_FIRST);
      this.untilGhost = between(...GHOST_FIRST);
    }
  }

  /** The world's colour and thickness for its fog. */
  private applyLook(): void {
    this.baseColor.set(String(ambienceOption(this.settings, 'color')));
    this.thickness = Number(ambienceOption(this.settings, 'thickness'));
    const u = this.uniforms;
    u.uDensity.value = densityFor(COVER_CALM) * this.thickness;
    u.uBankDensity.value = densityFor(COVER_BANK) * this.thickness;
  }

  /** The fog's density right now where a bank has arrived (per unit of depth, in front of the play, averaged). */
  private density(): number {
    const u = this.uniforms;
    return u.uDensity.value + (u.uBankDensity.value - u.uDensity.value) * this.surgeNow;
  }

  protected onStop(): void {
    this.bankAge = -1;
    this.surgeNow = 0;
    this.ghostsDue.length = 0;
    this.ghosts.fill(null);
    this.droneUp = false;
    this.brightenBackdrop(0);
  }

  protected override onSound(on: boolean): void {
    this.droneUp = false;
    this.ctx.audio?.setLoop('fogDrone', on ? DRONE_LEVEL : 0, on ? 3 : 1);
  }

  /**
   * A pulse: the foghorn sounds and a fog bank rolls in from one side, the wind turning to blow from that side,
   * bringing ghost lights and whispers.
   */
  protected onPulse(): void {
    if (this.bankAge >= 0) return;
    this.surgePeak = 0.85 + Math.random() * 0.15;
    this.bankHold = between(BANK.holdMin, BANK.holdMax);
    this.bankDir = Math.random() < 0.5 ? 1 : -1;
    this.windDir = this.bankDir;
    this.bankAge = 0;
    this.uniforms.uDir.value = this.bankDir;
    const ghosts = 3 + Math.floor(Math.random() * 3);
    this.ghostsDue.length = 0;
    for (let i = 0; i < ghosts; i++) this.ghostsDue.push(between(1.5, BANK.rise + this.bankHold - 1));
    this.bankSound();
  }

  protected override onViewport(pointScale: number): void {
    this.ghostUniforms.uScale.value = pointScale;
  }

  /**
   * The fog drifts on through menus and pauses, and a fog bank under way plays out at normal speed (wall-clock
   * time); the bells and lone ghost lights of the calm only come while the game runs.
   */
  protected onFrame(frame: AmbienceFrame): void {
    const dt = frame.realDt;
    // Wrap before float32 loses precision in the shaders.
    this.time = (this.time + dt) % 3600;

    this.surgeNow = 0;
    let front = 0;
    if (this.bankAge >= 0) {
      this.bankAge += dt;
      this.surgeNow = this.surgePeak * envelope(this.bankAge, BANK.rise, this.bankHold, BANK.fall);
      front = Math.min(1.25, this.bankAge / BANK.sweep);
      if (this.bankAge > BANK.rise + this.bankHold + BANK.fall) this.bankAge = -1;
    }
    // The wind gusts and slackens so the drift never looks mechanical, and a bank drives the patches faster. Both
    // offsets wrap on whole tiles of the noise, so the fog never jumps.
    const t = this.time;
    const breeze = DRIFT * (1 + 0.35 * Math.sin(t * 0.23) + 0.2 * Math.sin(t * 0.57 + 2));
    const tile = BILLOW * 100;
    this.drift = (this.drift + this.windDir * (breeze + BANK_DRIFT * this.surgeNow) * dt) % tile;
    this.creep = (this.creep + CREEP * (1 + this.surgeNow) * dt) % tile;

    const u = this.uniforms;
    this.ctx.camera.getWorldPosition(u.uCam.value);
    u.uTime.value = this.time;
    u.uWind.value.set(this.drift, this.creep, 0);
    u.uSurge.value = this.surgeNow;
    u.uFront.value = front;
    // A thick patch never covers more than patchMax of the play.
    this.front.uSliceMax.value = this.patchMax;
    const dim = 1 - FOG_GLOOM * this.surgeNow;
    u.uColor.value.copy(this.baseColor).multiplyScalar(dim);
    u.uShade.value.copy(this.baseColor).multiplyScalar(0.6 * dim);
    this.brightenBackdrop(-GLOOM * this.surgeNow);

    this.behind.uGhostCount.value = this.moveGhosts(dt, frame.simDt);
    this.droneLevel();

    // A bell tolling far off: only while the game runs.
    if (frame.simDt > 0) {
      this.untilBell -= frame.simDt;
      if (this.untilBell <= 0) {
        this.untilBell = between(...BELL);
        this.bell();
      }
    }
  }

  /**
   * Ghost lights: those due in a fog bank appear, a lone one sometimes in the calm, and each drifts and flickers,
   * lighting the fog behind the play. Returns how many are lit.
   */
  private moveGhosts(dt: number, simDt: number): number {
    for (let i = this.ghostsDue.length - 1; i >= 0; i--) {
      this.ghostsDue[i] -= dt;
      if (this.ghostsDue[i] <= 0) {
        this.ghostsDue.splice(i, 1);
        this.spawnGhost(true);
      }
    }
    if (simDt > 0 && this.bankAge < 0) {
      this.untilGhost -= simDt;
      if (this.untilGhost <= 0) {
        this.untilGhost = between(...GHOST_CALM);
        this.spawnGhost(false);
      }
    }
    let lit = 0;
    const density = this.density();
    for (let i = 0; i < GHOSTS; i++) {
      const g = this.ghosts[i];
      let glow = 0;
      if (g) {
        g.age += dt;
        if (g.age > g.life) this.ghosts[i] = null;
        else {
          const x = g.x + g.vx * g.age + Math.sin(g.age * 0.7 + g.phase) * 1.1;
          const y = g.y + Math.sin(g.age * 0.45 + g.phase * 2) * 0.7;
          const flicker = 0.75 + 0.25 * Math.sin(g.age * 6.3 + g.phase) * Math.sin(g.age * 2.9 + g.phase * 3);
          glow = g.peak * envelope(g.age, 1.6, g.life - 3.6, 2) * flicker;
          this.ghostPositions.set([x, y, g.z], i * 3);
          this.ghostLights4[lit++].set(x, y, g.z, glow * GHOST_LIGHT);
        }
      }
      // The light itself is seen through the fog between it and the play, and the fog in front of the play.
      const farBehind = Math.max(0, BEHIND_Z - (g?.z ?? 0)) * BEHIND;
      this.ghostGlow[i] = glow * Math.exp(-density * (farBehind + FRONT_DEPTH));
    }
    this.ghostPosAttr.needsUpdate = true;
    this.ghostGlowAttr.needsUpdate = true;
    return lit;
  }

  /** A ghost light somewhere in the fog behind the bricks, drifting across; in a bank (`bank`) it is brighter. */
  private spawnGhost(bank: boolean): void {
    const slot = this.ghosts.indexOf(null);
    if (slot < 0 || this.pathCount === 0) return;
    const at = this.pointOnPaths();
    this.ghosts[slot] = {
      age: 0,
      life: between(6, 10),
      x: at.x,
      y: at.y + between(2, bank ? 12 : 8),
      z: between(-5.5, -2),
      vx: (Math.random() < 0.5 ? -1 : 1) * between(0.5, 1.2),
      phase: Math.random() * Math.PI * 2,
      peak: bank ? between(0.75, 1) : between(0.45, 0.65),
    };
  }

  /** The drone swells while a fog bank is in, and settles back after. */
  private droneLevel(): void {
    const sound = this.sound;
    if (!sound) return;
    if (!this.droneUp && this.surgeNow > 0.3) {
      this.droneUp = true;
      sound.audio.setLoop('fogDrone', DRONE_BANK, 3);
    } else if (this.droneUp && this.bankAge < 0) {
      this.droneUp = false;
      sound.audio.setLoop('fogDrone', DRONE_LEVEL, 5);
    }
  }

  /**
   * A fog bank's sound: a foghorn from the side it rolls in from, a low swell under it, and whispers passing from
   * that side to the other (a stretch of the recording well away from the last one).
   */
  private bankSound(): void {
    const sound = this.sound;
    if (!sound) return;
    const { audio, now } = sound;
    const side = -this.bankDir;
    audio.sample(Math.random() < 0.5 ? 'foghornFar' : 'foghornEcho', {
      vol: HORN_LEVEL * between(0.85, 1),
      rate: between(0.84, 0.94),
      filter: 1900,
      pan: side * 0.45,
      when: now,
      bus: 'ambience',
    });
    audio.swell({
      source: 'noise',
      filter: 170,
      endFilter: 80,
      vol: 0.22,
      attack: 3,
      hold: 4,
      release: 6,
      pan: side * 0.3,
      when: now + 0.5,
      bus: 'ambience',
    });
    audio.swell({
      source: 'sine',
      freq: 55,
      endFreq: 49,
      filter: 200,
      vol: 0.07,
      attack: 4,
      hold: 4,
      release: 5,
      when: now + 1,
      bus: 'ambience',
    });
    const dur = between(...WHISPER_SOUND);
    let offset = Math.random() * (WHISPER_RECORDING - dur);
    if (Math.abs(offset - this.lastWhisper) < dur)
      offset = (offset + WHISPER_RECORDING / 2) % (WHISPER_RECORDING - dur);
    this.lastWhisper = offset;
    audio.sample('whispers', {
      vol: WHISPER_LEVEL * between(0.85, 1.05),
      offset,
      dur,
      fadeIn: 3,
      fadeOut: 4,
      filter: 2600,
      pan: side * 0.7,
      panTo: -side * 0.7,
      when: now + 1.8,
      bus: 'ambience',
    });
  }

  /** A bell tolling somewhere far off in the fog: slowed and muffled; sometimes it tolls again. */
  private bell(): void {
    const sound = this.sound;
    if (!sound) return;
    const { audio, now } = sound;
    const pan = (Math.random() - 0.5) * 1.4;
    const rate = between(0.72, 0.82);
    const tolls = Math.random() < 0.35 ? 2 : 1;
    for (let i = 0; i < tolls; i++) {
      const when = now + i * 4.5;
      const vol = BELL_LEVEL * (i ? 0.75 : 1);
      if (audio.sample('bellToll', { vol, rate, filter: 1100, pan, when, bus: 'ambience' })) continue;
      // Until the recording loads: a dull synthesised bell, its fundamental and a hum below.
      audio.tone({ freq: 196, dur: 4, vol: vol * 0.25, attack: 0.01, type: 'sine', pan, when, bus: 'ambience' });
      audio.tone({ freq: 98, dur: 5, vol: vol * 0.18, attack: 0.02, type: 'sine', pan, when, bus: 'ambience' });
    }
  }
}

/**
 * A tileable cube of soft fractal noise (0-1) that the fog is cut from: smooth value noise in four octaves, each
 * repeating exactly across the cube so the fog drifts through it without a seam.
 */
function makeNoise(size: number): { texture: THREE.Data3DTexture; data: Uint8Array } {
  const field = new Float32Array(size * size * size);
  let amp = 1;
  for (let cells = 4; cells <= 32; cells *= 2) {
    const lattice = Float32Array.from({ length: cells * cells * cells }, () => Math.random());
    const at = (i: number, j: number, k: number): number =>
      lattice[((k % cells) * cells + (j % cells)) * cells + (i % cells)];
    const scale = cells / size;
    for (let z = 0; z < size; z++) {
      const fz = z * scale;
      const z0 = Math.floor(fz);
      const sz = smooth(fz - z0);
      for (let y = 0; y < size; y++) {
        const fy = y * scale;
        const y0 = Math.floor(fy);
        const sy = smooth(fy - y0);
        for (let x = 0; x < size; x++) {
          const fx = x * scale;
          const x0 = Math.floor(fx);
          const sx = smooth(fx - x0);
          const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
          const plane = (k: number): number =>
            lerp(lerp(at(x0, y0, k), at(x0 + 1, y0, k), sx), lerp(at(x0, y0 + 1, k), at(x0 + 1, y0 + 1, k), sx), sy);
          field[(z * size + y) * size + x] += lerp(plane(z0), plane(z0 + 1), sz) * amp;
        }
      }
    }
    amp *= 0.5;
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of field) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const data = new Uint8Array(field.length);
  for (let i = 0; i < field.length; i++) data[i] = Math.round(((field[i] - min) / (max - min)) * 255);
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.wrapR = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return { texture, data };
}

/**
 * What the patch shape (SEEP plus the noise's rise from `low` to `high`) averages over the noise, sampling it as the
 * fog does: a coarse and a fine look-up at unrelated places, mixed as the fog mixes them (NOISE_MIX).
 */
function patchMean(data: Uint8Array, patch: { readonly low: number; readonly high: number }): number {
  let sum = 0;
  const samples = 20000;
  for (let i = 0; i < samples; i++) {
    const n =
      (data[Math.floor(Math.random() * data.length)] * NOISE_MIX +
        data[Math.floor(Math.random() * data.length)] * (1 - NOISE_MIX)) /
      255;
    const t = Math.min(1, Math.max(0, (n - patch.low) / (patch.high - patch.low)));
    sum += SEEP + smooth(t);
  }
  return sum / samples;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

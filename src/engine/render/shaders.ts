import type * as THREE from 'three';

export interface SurfaceFx {
  /** Constant emissive gain applied to the instance colour ("inner glow"). */
  glow: number;
  /** Fresnel rim gain applied to the instance colour ("bright glass edges"). */
  rim: number;
  /** Face emblem: 0 none, 1 four-point star, 2 volatile burst, 3 rivets. */
  emblem?: number;
  /** Whether per-instance crack / heat data (`aFx`) is read. */
  instanceFx?: boolean;
  /** Brick half extents, used to normalise emblem coordinates. */
  halfW?: number;
  halfH?: number;
  /** Local z above which a fragment counts as the brick's front face. */
  faceZ?: number;
  /**
   * Minimal marbling (STONE_GLSL): a soft tonal drift and one fine pale vein, the same on every brick.
   * Coloured by the instance tint.
   */
  stone?: boolean;
}

/** Procedural fracture lines for damaged bricks; shared by every brick material. */
export const CRACK_GLSL = /* glsl */ `
float crackHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float crackNoise(float x) {
  float i = floor(x);
  float f = fract(x);
  return mix(crackHash(vec2(i, 3.1)), crackHash(vec2(i + 1.0, 3.1)), f * f * (3.0 - 2.0 * f)) - 0.5;
}

// Shattered glass that grows with damage: a fine web of shards round the impact point, with jagged
// tapering fracture rays running out from it. p is brick-local, units. Returns 0..1 line strength.
float crackMask(vec2 p, float damage, float seed) {
  if (damage <= 0.0) return 0.0;
  vec2 o = vec2(sin(seed * 12.9898) * 0.45, cos(seed * 78.233) * 0.14);
  vec2 d = p - o + vec2(1e-4, 0.0);
  float r = length(d);
  float a = atan(d.y, d.x);

  // Radial rays: each one wanders a little (noise along its length), thins out and stops at its own reach.
  float n = 4.0 + floor(damage * 3.0);
  float w0 = a * n / 6.2831853 + seed * 3.7;
  float rays = 0.0;
  // Test the two nearest rays so the jitter never tears a line where one ray's sector meets the next.
  for (int k = -1; k <= 1; k++) {
    float id = floor(w0) + float(k);
    float idw = mod(id, n);
    float jitter = crackNoise(r * 7.0 + idw * 5.3 + seed * 11.0) * 0.22 + crackNoise(r * 23.0 + idw * 2.1) * 0.06;
    float off = w0 - (floor(w0) + float(k) + 0.5 + jitter);
    off -= n * floor(off / n + 0.5);
    float ray = abs(off) * 6.2831853 / n * r;
    float reach = damage * (1.05 + 0.75 * crackHash(vec2(idw, seed * 17.0)));
    float t = clamp(r / reach, 0.0, 1.0);
    float width = mix(0.024, 0.011, t);
    rays = max(rays, (1.0 - smoothstep(width * 0.3, width, ray)) * (1.0 - smoothstep(0.6, 1.0, t)));
  }

  // Shard web near the impact: Voronoi cell edges (F2 - F1) inside a small, damage-sized disc.
  vec2 q = d * 7.0 + seed * 31.0;
  vec2 i = floor(q);
  vec2 f = fract(q);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 h = vec2(crackHash(i + g), crackHash(i + g + 7.7));
    float dd = length(g + h - f);
    if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) { f2 = dd; }
  }
  float webR = damage * 0.42;
  float web = (1.0 - smoothstep(0.03, 0.09, f2 - f1)) * (1.0 - smoothstep(webR * 0.6, webR, r));

  return max(rays, web * 0.6) * step(0.025, r);
}
`;

/**
 * Minimal veins for the violet stone bricks: one slow sweeping vein with a short branch over a soft
 * tonal drift, identical on every brick so the wall reads as one material.
 */
const STONE_GLSL = /* glsl */ `
// tone: 0..1 gentle shading across the face; returns the vein strength 0..1.
float stonePattern(vec2 p, float seed, out float tone) {
  float mv = p.y - (0.28 * sin(p.x * 1.6 + 0.7) - 0.18 * p.x + 0.04);
  float vein = 1.0 - smoothstep(0.008, 0.026, abs(mv));
  float branch = p.y - (0.22 - 0.55 * (p.x - 0.35));
  float span = smoothstep(0.1, 0.25, p.x) * (1.0 - smoothstep(0.55, 0.75, p.x));
  vein = max(vein, (1.0 - smoothstep(0.004, 0.014, abs(branch))) * span * 0.55);
  tone = clamp(0.5 + 0.25 * sin(p.x * 1.1 + p.y * 2.3 + 0.4) - 0.2 * exp(-mv * mv * 40.0), 0.0, 1.0);
  return vein;
}
`;

const FX_FUNCTIONS = /* glsl */ `
uniform float uGlow;
uniform float uRim;
uniform float uTime;
varying vec3 vLocalPos;
#ifdef USE_INSTANCE_FX
flat varying vec3 vFx;
#endif

float starMask(vec2 p, float r) {
  // Astroid: a crisp four-point star.
  float s = pow(abs(p.x), 0.62) + pow(abs(p.y), 0.62);
  return 1.0 - smoothstep(pow(r, 0.62) - 0.06, pow(r, 0.62) + 0.02, s);
}

float burstMask(vec2 p) {
  p += vec2(1e-4, 0.0);
  float r = length(p);
  float a = atan(p.y, p.x);
  float core = 1.0 - smoothstep(0.16, 0.2, r);
  float ring = (1.0 - smoothstep(0.012, 0.03, abs(r - 0.3)));
  float rays = smoothstep(0.75, 0.95, cos(a * 8.0)) * smoothstep(0.36, 0.4, r) * (1.0 - smoothstep(0.5, 0.56, r));
  return max(core, max(ring, rays));
}

float rivetMask(vec2 p, vec2 ext) {
  vec2 q = abs(p) - (ext - vec2(0.2, 0.18));
  return 1.0 - smoothstep(0.045, 0.07, length(q));
}

${CRACK_GLSL}`;

/**
 * Upgrades a lit material into the studio-glass family used by bricks, debris
 * and pickups: per-instance tinted inner glow, fresnel rims, optional face
 * emblems and procedural fracture lines driven by an `aFx` instance attribute
 * (x = damage 0..1, y = heat 0..1, z = seed).
 */
export function applySurfaceFx(material: THREE.Material, fx: SurfaceFx, time?: { value: number }): void {
  const glow = { value: fx.glow };
  const rim = { value: fx.rim };
  const uTime = time ?? { value: 0 };
  const halfW = (fx.halfW ?? 1).toFixed(4);
  const halfH = (fx.halfH ?? 0.5).toFixed(4);
  const faceZ = (fx.faceZ ?? 0.4).toFixed(4);
  const emblem = fx.emblem ?? 0;
  const stone = fx.stone ?? false;
  material.userData.fx = { glow, rim };
  material.customProgramCacheKey = () => `fx-${emblem}-${fx.instanceFx ? 1 : 0}-${halfW}-${halfH}-${faceZ}${stone ? '-stone' : ''}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glow;
    shader.uniforms.uRim = rim;
    shader.uniforms.uTime = uTime;
    if (fx.instanceFx) shader.defines = { ...(shader.defines ?? {}), USE_INSTANCE_FX: '' };
    if (stone) shader.defines = { ...(shader.defines ?? {}), USE_STONE: '' };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vLocalPos;
#ifdef USE_INSTANCE_FX
attribute vec3 aFx;
flat varying vec3 vFx;
#endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vLocalPos = position;
#ifdef USE_INSTANCE_FX
vFx = aFx;
#endif`,
      );

    let faceCode = '';
    if (emblem === 1) {
      faceCode = `
  float em = starMask(fp * vec2(1.0, 1.0), 0.42) * isFace;
  totalEmissiveRadiance += vec3(1.0, 0.86, 0.5) * em * 5.0;
  totalEmissiveRadiance += vColor.rgb * starMask(fp, 0.62) * isFace * 0.9;`;
    } else if (emblem === 2) {
      faceCode = `
  float em = burstMask(fp) * isFace;
  totalEmissiveRadiance += mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.9, 0.6), heat) * em * (2.2 + heat * 6.0);`;
    } else if (emblem === 3) {
      faceCode = `
  float em = rivetMask(vLocalPos.xy, vec2(${halfW}, ${halfH})) * isFace;
  totalEmissiveRadiance += vec3(0.6, 0.75, 1.0) * em * 0.5;`;
    }

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FX_FUNCTIONS}${stone ? STONE_GLSL : ''}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
#ifdef USE_STONE
  float stoneSeed = 0.0;
  float stoneTone;
  // Front face from x/y; the sides take z too so the pattern wraps round instead of streaking.
  float stoneVein = stonePattern(vLocalPos.xy + vec2(0.8, -0.5) * (vLocalPos.z - ${faceZ}), stoneSeed, stoneTone);
  diffuseColor.rgb *= 0.75 + stoneTone * 0.5;
#endif
#ifdef USE_INSTANCE_FX
  {
    float crack = crackMask(vLocalPos.xy, vFx.x, vFx.z) * step(${faceZ}, vLocalPos.z);
    diffuseColor.rgb *= 1.0 - crack * 0.6;
  }
#endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  {
    vec3 tint = vec3(1.0);
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
    tint = vColor.rgb;
#endif
    float heat = 0.0;
#ifdef USE_INSTANCE_FX
    heat = vFx.y;
    {
      // Fractures catch the light: a crisp pale line tinted by the glass, over a faint frosted bruise
      // round the impact point that brightens with damage.
      float isFront = step(${faceZ}, vLocalPos.z);
      float crackGlow = crackMask(vLocalPos.xy, vFx.x, vFx.z) * isFront;
      vec2 impact = vLocalPos.xy - vec2(sin(vFx.z * 12.9898) * 0.45, cos(vFx.z * 78.233) * 0.14);
      float bruise = exp(-dot(impact, impact) * 18.0) * step(0.001, vFx.x) * vFx.x * isFront;
      vec3 crackCol = mix(tint, vec3(0.92, 0.96, 1.0), 0.7);
      totalEmissiveRadiance += crackCol * (crackGlow * 0.9 + bruise * 0.35);
    }
#endif
#ifdef USE_STONE
    {
      // Marbling inside the glass: a soft drift in the inner glow, and the single vein a little
      // brighter and paler than the tint.
      float pulse = 0.94 + 0.08 * sin(uTime * 1.1 + vLocalPos.x * 1.5);
      totalEmissiveRadiance += tint * uGlow * (stoneTone - 0.5) * 0.4;
      totalEmissiveRadiance += mix(tint, vec3(1.0), 0.45) * stoneVein * pulse * 0.75;
    }
#endif
    vec3 viewDir = normalize(vViewPosition);
    float fres = pow(1.0 - clamp(abs(dot(normal, viewDir)), 0.0, 1.0), 2.0);
    float edge = max(abs(vLocalPos.x) / ${halfW}, abs(vLocalPos.y) / ${halfH});
    totalEmissiveRadiance += tint * (uGlow * (1.0 + heat * 2.5) + uRim * (fres + 0.3 * smoothstep(0.7, 1.0, edge)));
    vec2 fp = vLocalPos.xy / vec2(${halfH}, ${halfH});
    float isFace = step(${faceZ}, vLocalPos.z);
    vec3 vColor_ = tint;
    ${faceCode.replace(/vColor\.rgb/g, 'vColor_')}
  }`,
      );
  };
}

export function setSurfaceGlow(material: THREE.Material, glow: number, rim?: number): void {
  const fx = material.userData.fx as { glow: { value: number }; rim: { value: number } } | undefined;
  if (!fx) return;
  fx.glow.value = glow;
  if (rim !== undefined) fx.rim.value = rim;
}

export const PARTICLE_VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.001, -mv.z);
}`;

export const PARTICLE_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
#ifdef DUST
  // Premultiplied, blended over the scene: coloured dust that shows against bright backgrounds.
  gl_FragColor = vec4(vColor * (a * vAlpha), a * vAlpha);
#else
  gl_FragColor = vec4(vColor * (a * vAlpha), 1.0);
#endif
}`;

/** Ribbon trail: soft-edged strip that fades from head (t = 0) to tail (t = 1). */
export const TRAIL_VERTEX = /* glsl */ `
attribute vec2 aTrail; // x: 0 head .. 1 tail, y: -1 .. 1 across
varying vec2 vTrail;
void main() {
  vTrail = aTrail;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const TRAIL_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vTrail;
void main() {
  float y2 = vTrail.y * vTrail.y;
  float across = 1.0 - y2 * y2;
  float along = clamp(1.0 - vTrail.x, 0.0, 1.0);
  along *= along * (3.0 - 2.0 * along);
  float a = across * along * uOpacity;
  gl_FragColor = vec4(uColor * a, a);
}`;

/**
 * Polished studio floor: blurred planar reflection over a softly lit grey
 * base with warm (left) and cool (right) light pools.
 */
export const FLOOR_SHADER = {
  name: 'RefraktFloor',
  uniforms: {
    color: { value: null as THREE.Color | null },
    tDiffuse: { value: null as THREE.Texture | null },
    textureMatrix: { value: null as THREE.Matrix4 | null },
    uTexel: { value: [1 / 960, 1 / 540] as [number, number] },
    uReflect: { value: 0.5 },
    uWarm: { value: null as THREE.Color | null },
    uCool: { value: null as THREE.Color | null },
    uPaddleX: { value: 0 },
    uPaddleGlow: { value: null as THREE.Color | null },
  },
  vertexShader: /* glsl */ `
uniform mat4 textureMatrix;
varying vec4 vUv;
varying vec3 vWorld;
void main() {
  vUv = textureMatrix * vec4(position, 1.0);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`,
  fragmentShader: /* glsl */ `
uniform vec3 color;
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uReflect;
uniform vec3 uWarm;
uniform vec3 uCool;
uniform float uPaddleX;
uniform vec3 uPaddleGlow;
varying vec4 vUv;
varying vec3 vWorld;

const vec2 TAPS[12] = vec2[12](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));

void main() {
  vec2 uv = vUv.xy / vUv.w;
  // Blur grows with distance from the camera so near reflections stay crisper.
  float depth = clamp((8.0 - vWorld.z) / 16.0, 0.0, 1.0);
  vec2 radius = uTexel * mix(3.0, 10.0, depth) * vec2(1.0, 1.8);
  vec3 refl = texture2D(tDiffuse, uv).rgb * 0.2;
  for (int i = 0; i < 12; i++) refl += texture2D(tDiffuse, uv + TAPS[i] * radius).rgb * (0.8 / 12.0);
  // Soft-compress bright reflections (e.g. the chrome paddle catching the studio's light strip) so they
  // read as a sheen on the floor instead of a hot white glow; dim reflections are almost unchanged.
  refl /= 1.0 + max(refl.r, max(refl.g, refl.b)) * 1.5;

  // Base: polished grey with light pools from the warm key (left) and cool fill (right).
  vec3 base = color;
  float wa = (vWorld.x + 22.0) / 14.0;
  float wb = (vWorld.x + 8.0) / 18.0;
  float ca = (vWorld.x - 22.0) / 13.0;
  float warm = exp(-wa * wa) * 0.9 + exp(-wb * wb) * 0.25;
  float cool = exp(-ca * ca) * 0.8;
  base += uWarm * warm + uCool * cool;
  base *= mix(1.0, 0.72, depth);
  // Warm pool spilled onto the floor by the paddle light bar.
  float px = vWorld.x - uPaddleX;
  float pz = max(vWorld.z - 1.0, 0.0);
  base += uPaddleGlow * exp(-px * px / 10.0) * exp(-pz * pz / 4.0) * smoothstep(-1.0, 1.4, vWorld.z);

  float fres = mix(0.55, 1.0, depth);
  vec3 col = base + refl * uReflect * fres;
  gl_FragColor = vec4(col, 1.0);
}`,
};

/**
 * Final screen pass: gentle vignette, colour split (only for Refrakt's big moments), and Refrakt's spectrum:
 * a rainbow of light round the screen edges, its hues wheeling slowly round the frame.
 */
/** Default vignette strength of the screen pass. */
export const SCREEN_VIGNETTE = 0.32;

export const SCREEN_FX_SHADER = {
  name: 'RefraktScreenFx',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uChroma: { value: 0 },
    uVignette: { value: SCREEN_VIGNETTE },
    uSpectrum: { value: 0 },
    uHue: { value: 0 },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uChroma;
uniform float uVignette;
uniform float uSpectrum;
uniform float uHue;
varying vec2 vUv;
vec3 hue2rgb(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}
void main() {
  vec2 c = vUv - 0.5;
  float d = dot(c, c);
  vec3 col;
  if (uChroma > 0.00005) {
    vec2 off = c * uChroma * (0.5 + d * 3.0);
    col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
  } else {
    col = texture2D(tDiffuse, vUv).rgb;
  }
  col *= 1.0 - uVignette * smoothstep(0.18, 0.75, d);
  if (uSpectrum > 0.001) {
    // Hue runs round the frame (one full spectrum per turn), rippling gently inwards.
    float turn = atan(c.y, c.x) / 6.2831853;
    float edge = smoothstep(0.06, 0.5, d);
    float ripple = 0.75 + 0.25 * sin(d * 40.0 - uHue * 25.0);
    col += hue2rgb(fract(turn + uHue)) * edge * ripple * uSpectrum * 0.6;
  }
  gl_FragColor = vec4(col, 1.0);
}`,
};

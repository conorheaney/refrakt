import * as THREE from 'three';
import { FOREST_ART } from '../../../gameplay/config';
import { FOREST_VIEW } from '../../../gameplay/CameraRig';
import { BLOOM_THRESHOLD, TONE_EXPOSURE } from '../../../engine/render/Renderer';
import { SCREEN_VIGNETTE } from '../../../engine/render/shaders';
import type { ForestAssets } from './assets';

/**
 * The painting goes through the same screen grade as everything else (ACES tone mapping and the screen
 * vignette; see Renderer), so the Space bricks, ball and paddle look exactly as they do in Space. To keep
 * the painting itself as painted, its shader undoes that grade: it outputs the scene-linear colour that
 * the vignette and ACES (three.js's fit, at TONE_EXPOSURE) turn back into the painted colour. Colours
 * ACES cannot reach (very saturated ones) are clamped, which shifts them very slightly. The painting is
 * also kept just under the bloom threshold, so it never blooms: its brightest highlights (the sunlit
 * leaves, sunbeams and floor glow, above about 90% brightness) are compressed a little instead.
 */
const VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec2 vScreen;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vScreen = gl_Position.xy / gl_Position.w * 0.5 + 0.5;
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float uExposure;
uniform float uVignette;
uniform float uMaxLuma;
varying vec2 vUv;
varying vec2 vScreen;

// three.js ACESFilmicToneMapping matrices (column-major, as in tonemapping_pars_fragment).
const mat3 ACES_IN = mat3(
  vec3(0.59719, 0.07600, 0.02840),
  vec3(0.35458, 0.90834, 0.13383),
  vec3(0.04823, 0.01566, 0.83777)
);
const mat3 ACES_OUT = mat3(
  vec3(1.60475, -0.10208, -0.00327),
  vec3(-0.53108, 1.10813, -0.07276),
  vec3(-0.07367, -0.00605, 1.07602)
);

// Inverse of RRTAndODTFit: solves (v^2 + 0.0245786 v - 0.000090537) / (0.983729 v^2 + 0.432951 v + 0.238081) = y.
vec3 inverseFit(vec3 y) {
  y = clamp(y, 0.0, 0.99);
  vec3 a = 1.0 - 0.983729 * y;
  vec3 b = 0.0245786 - 0.432951 * y;
  vec3 c = 0.000090537 + 0.238081 * y;
  return (-b + sqrt(b * b + 4.0 * a * c)) / (2.0 * a);
}

void main() {
  vec3 painted = texture2D(map, vUv).rgb;
  vec3 hdr = inverse(ACES_IN) * inverseFit(inverse(ACES_OUT) * painted);
  // Saturated colours need slightly negative components here (outside sRGB, inside ACES's input gamut);
  // the half-float scene buffer keeps them, and the tone mapper turns them back into the painted colour.
  hdr *= 0.6 / uExposure;
  vec2 c = vScreen - 0.5;
  hdr /= 1.0 - uVignette * smoothstep(0.18, 0.75, dot(c, c));
  // Same measure as the bloom's high pass (three.js luminance(): Rec. 709 weights).
  float luma = luminance(hdr);
  if (luma > uMaxLuma) hdr *= uMaxLuma / luma;
  gl_FragColor = vec4(hdr, 1.0);
}`;

/**
 * Forest world scenery: the woodland painting with its tree arch, shown behind the playfield as one quad
 * facing the camera. The camera's flat forest view (FOREST_VIEW) frames it; the arena (FOREST_FIELD) is the
 * inside of the painted arch, so the trunks and branch are the walls and ceiling.
 */
export class ForestEnvironment {
  readonly group = new THREE.Group();

  private readonly texture: THREE.Texture;

  constructor(scene: THREE.Scene, assets: ForestAssets) {
    this.texture = assets.background;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: assets.background },
        uExposure: { value: TONE_EXPOSURE },
        uVignette: { value: SCREEN_VIGNETTE },
        uMaxLuma: { value: BLOOM_THRESHOLD * 0.98 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });

    // The quad faces the (pitched) camera, so the painting is undistorted on screen; one image px is
    // 1 / pxPerUnit screen units. It sits a little behind the playfield along the view direction, centred
    // on the frame, and is a hair (0.06%) wider than the painting so a full 16:9 stage has no sliver of
    // background colour at its edges.
    const unit = 1 / FOREST_ART.pxPerUnit;
    const width = Math.max(FOREST_ART.widthPx, (FOREST_ART.heightPx * 16) / 9) * unit;
    const height = FOREST_ART.heightPx * unit;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    const p = FOREST_VIEW.pitch;
    mesh.rotation.x = -p;
    mesh.position.set(FOREST_VIEW.centerX, FOREST_VIEW.centerY - 2 * Math.sin(p), -2 * Math.cos(p));
    mesh.renderOrder = -10;
    mesh.frustumCulled = false;

    this.group.add(mesh);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Uploads the background now, so switching to this world mid-run does not hitch. */
  prewarm(gl: THREE.WebGLRenderer): void {
    gl.initTexture(this.texture);
  }
}

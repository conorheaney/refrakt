import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SCREEN_FX_SHADER } from './shaders';
import { ResolutionGovernor } from './ResolutionGovernor';

export type Quality = 'low' | 'medium' | 'high';

interface QualityProfile {
  readonly pixelRatio: number;
  readonly msaa: number;
}

export const QUALITY_PROFILES: Readonly<Record<Quality, QualityProfile>> = {
  low: { pixelRatio: 1, msaa: 0 },
  medium: { pixelRatio: 1.5, msaa: 2 },
  high: { pixelRatio: 2, msaa: 4 },
};

/** Exposure of the ACES tone mapping. */
const TONE_EXPOSURE = 0.95;

/** Strength of the soft bloom pass. */
const BLOOM_STRENGTH = 0.3;
/** Scene luminance (three.js luminance(), Rec. 709 weights, as the bloom's high pass measures it) above which pixels bloom. */
const BLOOM_THRESHOLD = 1.25;

/**
 * WebGL renderer + HDR post-processing chain tuned for a clean "product
 * render" look: scene -> soft bloom -> gentle vignette / grade -> ACES tone
 * mapping. Also scales its internal resolution to hold the frame rate (ResolutionGovernor), and survives the
 * browser taking the WebGL context away and giving it back (a GPU reset, memory pressure, a laptop waking).
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private scenePass: RenderPass | null = null;
  private fx: ShaderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private profile: QualityProfile = QUALITY_PROFILES.high;
  private readonly governor = new ResolutionGovernor();
  /** True while the browser has taken the WebGL context away: nothing is drawn until it comes back. */
  private contextLost = false;
  /** Called when the context is lost (the game pauses) and when it is back (the game resizes and redraws). */
  onContextLost: () => void = () => {};
  onContextRestored: () => void = () => {};
  private cssWidth = 1920;
  private cssHeight = 1080;

  constructor(canvas: HTMLCanvasElement) {
    try {
      this.gl = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        powerPreference: 'high-performance',
        stencil: false,
      });
    } catch (err) {
      throw new Error('WebGL 2 is required to run Refrakt, but it could not be initialised on this device.', {
        cause: err,
      });
    }
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = TONE_EXPOSURE;
    // three.js keeps the loss recoverable (preventDefault) and rebuilds its GPU state on restore.
    canvas.addEventListener('webglcontextlost', () => {
      this.contextLost = true;
      this.onContextLost();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.applySize();
      this.onContextRestored();
    });
  }

  attach(scene: THREE.Scene, camera: THREE.Camera): void {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.profile.msaa });
    const composer = new EffectComposer(this.gl, target);
    this.scenePass = new RenderPass(scene, camera);
    composer.addPass(this.scenePass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM_STRENGTH, 0.55, BLOOM_THRESHOLD);
    composer.addPass(this.bloom);
    this.fx = new ShaderPass(SCREEN_FX_SHADER);
    composer.addPass(this.fx);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.applySize();
  }

  get bufferHeight(): number {
    return this.gl.domElement.height;
  }

  setQuality(quality: Quality): void {
    this.profile = QUALITY_PROFILES[quality];
    this.governor.reset();
    if (this.composer) {
      for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
        if (rt.samples !== this.profile.msaa) {
          rt.samples = this.profile.msaa;
          rt.dispose();
        }
      }
    }
    this.applySize();
  }

  /** Refrakt's screen light: the edge spectrum's strength (0..1) and hue, and a colour split (screen UV). */
  setRefrakt(glow: number, hue: number, chroma: number): void {
    if (!this.fx) return;
    const u = this.fx.uniforms;
    u.uSpectrum.value = glow;
    u.uHue.value = hue;
    u.uChroma.value = chroma;
  }

  /** Sets the CSS size of the (letterboxed) stage the canvas fills. */
  resize(width: number, height: number): void {
    this.cssWidth = Math.max(1, width);
    this.cssHeight = Math.max(1, height);
    this.applySize();
  }

  private applySize(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, this.profile.pixelRatio) * this.governor.scale;
    this.gl.setPixelRatio(ratio);
    this.gl.setSize(this.cssWidth, this.cssHeight, false);
    this.composer?.setPixelRatio(ratio);
    this.composer?.setSize(this.cssWidth, this.cssHeight);
  }

  /** @returns true when the internal resolution changed (callers may need the new buffer size). */
  render(realDt: number): boolean {
    if (!this.composer || !this.fx || this.contextLost) return false;
    // Chromatic aberration is off except for Refrakt's brief colour split (setRefrakt).
    this.composer.render(realDt);
    return this.adapt(realDt);
  }

  /** Lets the governor follow the frame rate; resizes the targets when it changes the resolution. */
  private adapt(realDt: number): boolean {
    if (!this.governor.frame(realDt)) return false;
    this.applySize();
    return true;
  }
}

import * as THREE from 'three';
import { AudioDirector } from './audio/AudioDirector';
import { AudioEngine } from '../engine/audio/AudioEngine';
import { Music } from './audio/Music';
import { CORE_SAMPLES, SAMPLE_URLS, worldSamples } from './audio/samples';
import type { Campaign } from '../content/campaign';
import { Storage, type Settings } from './Storage';
import { Input } from '../engine/input/Input';
import { GameView } from './GameView';
import { BackdropCache } from './backdrops';
import { Renderer } from '../engine/render/Renderer';
import { World } from '../gameplay/World';
import type { LaunchOptions } from './launchOptions';
import { layoutStage } from '../engine/Stage';
import { UI } from './UI';
import { GameFlow, type FlowAudio, type FlowView } from './GameFlow';

/**
 * Composition root. Builds the browser-facing pieces (renderer and 3D view, sound, HUD and menus, input),
 * plugs them into the game's flow (GameFlow: states, timing, steering, gameplay events), and owns the frame
 * loop, settings and window events. Gameplay rules live in World; presentation lives in GameView.
 */
export class Game {
  private readonly world: World;
  private readonly flow: GameFlow;
  private readonly renderer: Renderer;
  private readonly view: GameView;
  private readonly audio = new AudioEngine();
  private readonly music = new Music(this.audio);
  private readonly director: AudioDirector;
  private readonly ui: UI;
  private readonly input: Input;
  private readonly settings: Settings = Storage.loadSettings();
  private readonly stage: HTMLElement;
  private readonly uiRoot: HTMLElement;

  private lastTime = 0;
  private running = false;

  constructor(
    canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    campaign: Campaign,
    options: LaunchOptions,
    forgeTextures: readonly THREE.Texture[],
  ) {
    this.world = new World(campaign);
    this.stage = canvas.parentElement ?? document.body;
    this.uiRoot = uiRoot;
    this.renderer = new Renderer(canvas);
    // Each world's uploaded background is decoded when one of its levels first shows (see BackdropCache).
    const backdrops = new BackdropCache((worldIndex) => this.world.campaign.worlds[worldIndex]?.background);
    this.view = new GameView(this.world, this.renderer.gl, forgeTextures, backdrops, {
      debugArena: options.debugArena,
    });
    this.renderer.attach(this.view.scene, this.view.rig.camera);
    this.audio.addSamples(SAMPLE_URLS);
    this.audio.want(CORE_SAMPLES);
    // Each world's weather and hazard sounds load when one of its levels does (the menu demo's too).
    this.world.events.on('levelLoaded', ({ index }) => this.audio.want(worldSamples(campaign.worldAt(index))));
    this.director = new AudioDirector(this.audio, this.world.events, this.view.events);

    this.ui = new UI(uiRoot, this.settings, campaign, {
      onAction: (action) => this.flow.onUiAction(action),
      onSettingsChanged: () => this.applySettings(true),
      onClick: () => {
        this.audio.unlock();
        this.director.uiClick();
      },
      onLoadoutConfirm: (kinds) => this.flow.confirmLoadout(kinds),
      onWorldSelected: (index) => this.flow.selectWorld(index),
    });
    this.input = new Input(canvas, {
      onGesture: () => this.audio.unlock(),
      onPause: () => this.flow.togglePause(),
      onMute: () => this.audio.toggleMute(),
    });

    this.flow = new GameFlow(this.world, campaign, options, {
      view: this.flowView(),
      ui: this.ui,
      audio: this.flowAudio(),
      input: this.input,
      store: Storage,
    });
    this.applySettings(false);

    window.addEventListener('resize', this.onResize);
    window.addEventListener('blur', () => this.flow.autoPause());
    document.addEventListener('visibilitychange', () => {
      // A hidden tab pauses the game and goes silent (ambience loops included); shown again, sound resumes.
      if (document.hidden) this.flow.autoPause();
      this.audio.setSuspended(document.hidden);
    });
    this.renderer.onContextLost = () => this.flow.autoPause();
    this.renderer.onContextRestored = () => this.onResize();
    this.onResize();
    this.view.prewarm(this.renderer.gl);
  }

  start(): void {
    this.flow.start();
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  /** GameView and its camera rig, as the flow sees them. */
  private flowView(): FlowView {
    const view = this.view;
    const ndc = new THREE.Vector3();
    return {
      get intensity() {
        return view.intensity;
      },
      set intensity(value: number) {
        view.intensity = value;
      },
      setCameraMode: (mode) => {
        view.rig.mode = mode;
      },
      update: (realDt, simDt, alpha, effectsDt) => view.update(realDt, simDt, alpha, effectsDt),
      pointerToFieldX: (ndcX, ndcY) => view.rig.pointerToFieldX(ndcX, ndcY),
      project: (x, y) => {
        view.rig.project(x, y, ndc);
        return { x: ndc.x, y: ndc.y };
      },
    };
  }

  /** The audio director (sound effects) and music, as the flow sees them. */
  private flowAudio(): FlowAudio {
    const { director, music } = this;
    return {
      setEffectsEnabled: (on) => {
        director.enabled = on;
      },
      setPaused: (paused) => director.setPaused(paused),
      setMusicTrack: (track) => {
        music.track = track;
      },
      setMusicMode: (mode) => {
        music.mode = mode;
      },
      setMusicIntensity: (intensity) => music.setIntensity(intensity),
    };
  }

  // --------------------------------------------------------------- main loop

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const interval = now - this.lastTime;
    const realDt = Math.min(0.1, Math.max(0, interval / 1000));
    this.lastTime = now;
    try {
      this.music.update();
      this.flow.update(realDt);
      const refrakt = this.view.refraktScreen;
      this.renderer.setRefrakt(refrakt.screenGlow, refrakt.hue, refrakt.chroma);
      if (this.renderer.render(realDt)) this.onResize();
      this.recordFrame(interval, performance.now() - now);
    } catch (err) {
      this.running = false;
      console.error(err);
      this.ui.showFatal(err instanceof Error ? err.message : String(err));
    }
  };

  /** Frame-time samples for the HUD readout, reported every half second. */
  private readonly frameStats = { time: 0, count: 0, sum: 0, worst: 0, cpu: 0 };

  private recordFrame(interval: number, cpu: number): void {
    // Skip the first frame and returns from a hidden tab, whose gaps are not frame times.
    if (interval <= 0 || interval > 1000) return;
    const s = this.frameStats;
    s.time += interval;
    s.count++;
    s.sum += interval;
    s.worst = Math.max(s.worst, interval);
    s.cpu += cpu;
    if (s.time < 500) return;
    this.ui.setFrameStats(s.sum / s.count, s.worst, s.cpu / s.count);
    s.time = s.count = s.sum = s.worst = s.cpu = 0;
  }

  // ----------------------------------------------------------------- settings

  private applySettings(persist: boolean): void {
    const s = this.settings;
    this.audio.setVolumes(s.musicVolume, s.sfxVolume, s.ambienceVolume);
    this.view.rig.shakeScale = s.screenShake ? 1 : 0;
    this.renderer.setQuality(s.quality);
    this.onResize();
    if (persist) Storage.saveSettings(s);
  }

  private readonly onResize = (): void => {
    const layout = layoutStage(this.stage, this.uiRoot);
    this.input.refreshBounds();
    this.renderer.resize(layout.width, layout.height);
    this.view.resize(layout.aspect, this.renderer.bufferHeight);
  };
}

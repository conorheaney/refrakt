import * as THREE from 'three';
import { AudioDirector } from './audio/AudioDirector';
import { AudioEngine } from '../engine/audio/AudioEngine';
import { Music } from './audio/Music';
import { SAMPLE_URLS } from './audio/samples';
import { PADDLE, PLAYER, REFRAKT, SIM } from '../gameplay/config';
import { POWERUPS } from '../gameplay/powerups/powerUps';
import { PowerUpKind } from '../gameplay/types';
import type { Campaign } from '../content/campaign';
import { lerp } from '../engine/core/math';
import { StateMachine } from '../engine/core/StateMachine';
import { Storage, type Settings } from './Storage';
import { FixedStepper, stepFraction, TimeFx } from '../engine/core/Time';
import { Input } from '../engine/input/Input';
import { GameView } from './GameView';
import { QUALITY_PROFILES, Renderer } from '../engine/render/Renderer';
import { STAGES_PER_WORLD } from '../content/worlds';
import type { ForestAssets } from '../themes/scenery/forest/assets';
import { World, type StepInput } from '../gameplay/World';
import { layoutStage } from '../engine/Stage';
import { UI, type UiAction } from './UI';

/** Field units of shove (snake bite, scarab landing) pointer offset worn away per field unit the mouse moves. */
const POINTER_OFFSET_WEAR = 0.5;

type GameState = 'menu' | 'loadout' | 'playing' | 'paused' | 'transition' | 'gameover' | 'victory';

/** Optional `?level=N` (1-based) starts a run on that exact level; handy for practice and QA. */
function startLevelFromUrl(campaign: Campaign): number | null {
  const params = new URLSearchParams(window.location.search);
  if (params.has('editorPreview')) {
    // The previewed world is the whole campaign (see main.ts).
    const stage = Number(params.get('stage'));
    return Number.isInteger(stage) && stage >= 0 && stage < STAGES_PER_WORLD && stage < campaign.levelCount ? stage : 0;
  }
  const raw = Number(new URLSearchParams(window.location.search).get('level'));
  return Number.isInteger(raw) && raw >= 1 && raw <= campaign.levelCount ? raw - 1 : null;
}

/** Optional `?autopilot` lets the attract-mode AI play a real run (HUD, scoring, lives); for QA captures. */
const AUTOPILOT = new URLSearchParams(window.location.search).has('autopilot');

function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

/**
 * Composition root and flow controller. Owns the frame loop and the
 * high-level state machine, and wires the simulation, view, audio, input and
 * UI together. Gameplay rules live in World; presentation lives in GameView.
 */
export class Game {
  private readonly world: World;
  private readonly renderer: Renderer;
  private readonly view: GameView;
  private readonly audio = new AudioEngine();
  private readonly music = new Music(this.audio);
  private readonly director: AudioDirector;
  private readonly ui: UI;
  private readonly input: Input;
  private readonly settings: Settings = Storage.loadSettings();
  private readonly fsm = new StateMachine<GameState>();
  private readonly stepper = new FixedStepper(SIM.step, SIM.maxStepsPerFrame);
  private readonly timeFx = new TimeFx();
  private readonly stepInput: StepInput = { targetX: null, axis: 0, action: false };
  private readonly ndc = new THREE.Vector3();
  private readonly stage: HTMLElement;
  private readonly uiRoot: HTMLElement;

  private best = Storage.loadHighScore();
  private alpha = 0;
  private lastTime = 0;
  private running = false;
  private transitionTimer = 0;
  private demoTimer = 0;
  private demoLevel = 0;
  /** World selected on the main menu. */
  private startWorld = 0;
  private runEnd: number;
  /** Pointer target (field X) at the previous and current display frame; see tick(). */
  private pointerFrom: number | null = null;
  private pointerTo: number | null = null;
  /**
   * Field units added to the pointer's position after a snake bite or a scarab landing shoves the paddle (a
   * page can't move the real cursor), so the paddle stays where it was pushed instead of snapping back to a resting
   * cursor. Mouse movement wears it away (POINTER_OFFSET_WEAR) until paddle and cursor line up again.
   */
  private pointerOffset = 0;
  private lastRawPointer: number | null = null;
  /** Per-frame bookkeeping used to time-place each fixed step within the frame. */
  private frameSimDt = 0;
  private frameCarry = 0;
  private frameStep = 0;
  /** The player's last confirmed power-up loadout this session (pre-selected next time); null before the first. */
  private lastLoadout: readonly PowerUpKind[] | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    private readonly campaign: Campaign,
    assets: ForestAssets,
    backgrounds: ReadonlyMap<number, THREE.Texture> = new Map(),
  ) {
    this.world = new World(campaign);
    this.runEnd = campaign.runEndLevel(0);
    this.stage = canvas.parentElement ?? document.body;
    this.uiRoot = uiRoot;
    this.renderer = new Renderer(canvas);
    this.view = new GameView(this.world, this.renderer.gl, assets, backgrounds);
    this.renderer.attach(this.view.scene, this.view.rig.camera);
    this.audio.addSamples(SAMPLE_URLS);
    this.director = new AudioDirector(this.audio, this.world.events);
    this.view.onThunder = (delay, strength) => this.director.thunder(delay, strength);
    this.world.events.on('lifeLost', () => {
      this.pointerOffset = 0;
    });
    this.view.onWeather = (weather) => this.director.setWeather(weather);
    this.view.onSnowFrame = (realDt, simDt, gust) => this.director.snowFrame(realDt, simDt, gust);
    this.view.onDustFrame = (realDt, simDt) => this.director.dustFrame(realDt, simDt);
    this.view.onRumble = (...args) => this.director.rumble(...args);
    this.view.onTorchFlare = (side, strength) => this.director.torchFlare(side, strength);

    this.ui = new UI(uiRoot, this.settings, campaign, {
      onAction: (action) => this.onUiAction(action),
      onSettingsChanged: () => this.applySettings(true),
      onClick: () => {
        this.audio.unlock();
        this.director.uiClick();
      },
      onLoadoutConfirm: (kinds) => this.confirmLoadout(kinds),
      onWorldSelected: (index) => this.selectWorld(index),
    });
    this.input = new Input(canvas, {
      onGesture: () => this.audio.unlock(),
      onPause: () => this.togglePause(),
      onMute: () => this.audio.toggleMute(),
    });

    this.bindWorldEvents();
    this.registerStates();
    this.applySettings(false);

    window.addEventListener('resize', this.onResize);
    window.addEventListener('blur', this.autoPause);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.autoPause();
    });
    this.onResize();
    this.view.prewarm(this.renderer.gl);
  }

  start(): void {
    this.fsm.transition('menu');
    if (new URLSearchParams(window.location.search).has('editorPreview')) this.startGame();
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
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
      this.fsm.update(realDt);
      // The world's camera (Space product shot or the flat forest view) may have changed with the level.
      this.renderer.setCamera(this.view.rig.camera);
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

  /** Advances the simulation by real time (after time effects) and refreshes the view. */
  private simulate(realDt: number): void {
    const simDt = this.timeFx.apply(realDt);
    if (!this.world.demo && !AUTOPILOT) {
      const input = this.input;
      this.stepInput.axis = input.axis;
      const raw = input.pointerActive ? this.view.rig.pointerToFieldX(input.pointerX, input.pointerY) : null;
      if (raw === null) this.pointerOffset = 0;
      else if (this.timeFx.frozen) {
        // A hit-stop holds the paddle still while the cursor keeps moving: aim at the paddle, and let the
        // difference wear off with mouse movement afterwards (as after a shove) instead of lurching to the cursor.
        this.pointerOffset = this.world.paddle.x - raw;
      } else if (this.pointerOffset !== 0 && this.lastRawPointer !== null) {
        const left = Math.abs(this.pointerOffset) - Math.abs(raw - this.lastRawPointer) * POINTER_OFFSET_WEAR;
        this.pointerOffset = left > 0 ? Math.sign(this.pointerOffset) * left : 0;
      }
      this.lastRawPointer = raw;
      const target = raw === null ? null : raw + this.pointerOffset;
      this.pointerFrom = target === null ? null : (this.pointerTo ?? target);
      this.pointerTo = target;
      if (input.consumeAction()) this.stepInput.action = true;
    }
    this.frameSimDt = simDt;
    this.frameCarry = this.stepper.pending;
    this.frameStep = 0;
    this.alpha = this.stepper.advance(simDt, this.tick);
    // During a hit-stop the effects keep moving on real time; only the game itself holds still.
    this.view.update(realDt, simDt, this.alpha, this.timeFx.frozen ? realDt : simDt);
  }

  private readonly tick = (step: number): void => {
    if (this.world.demo || AUTOPILOT) {
      this.driveDemo();
    } else if (this.pointerFrom !== null && this.pointerTo !== null) {
      // The pointer is sampled once per display frame, but a frame runs a varying number of fixed steps.
      // Feed each step the pointer position at that step's own time within the frame, so the paddle moves
      // evenly in simulation time and the interpolated render is smooth (instead of jumping to the target
      // on the first step of some frames and lagging on others).
      const f = stepFraction(this.frameStep, step, this.frameCarry, this.frameSimDt);
      this.stepInput.targetX = lerp(this.pointerFrom, this.pointerTo, f);
    } else {
      this.stepInput.targetX = null;
    }
    this.frameStep++;
    // While a snake's shove or an icicle's push plays out, the pointer doesn't steer (World.updatePaddle), so
    // every bit the paddle moves is the push's, as far as the walls let it go: carry that into the pointer
    // offset so the paddle stays where it was pushed. (An icicle's slide is consumed only while it pushes.)
    const paddle = this.world.paddle;
    const before = paddle.x;
    const shoving = paddle.shove !== 0;
    const slide = paddle.slide;
    this.world.step(step, this.stepInput);
    if ((shoving || paddle.slide !== slide) && !this.world.demo && !AUTOPILOT) this.pointerOffset += paddle.x - before;
    this.stepInput.action = false;
  };

  /** Attract-mode autopilot: track the most threatening ball with a little wobble. */
  private driveDemo(): void {
    const world = this.world;
    let target: number | null = null;
    let lowest = Infinity;
    for (const ball of world.balls.items) {
      if (!ball.active || ball.stuck) continue;
      const urgency = ball.dy < 0 ? ball.y : ball.y + 40;
      if (urgency < lowest) {
        lowest = urgency;
        target = ball.x;
      }
    }
    this.stepInput.axis = 0;
    this.stepInput.action = AUTOPILOT && !world.demo && world.balls.items.some((b) => b.active && b.stuck);
    // Wobble scales with the paddle so the autopilot still lands most balls on the narrower paddle.
    const wobble = PADDLE.width * 0.25;
    this.stepInput.targetX =
      target === null ? Math.sin(world.time * 0.8) * 7 : target + Math.sin(world.time * 2.1) * wobble;
  }

  // ------------------------------------------------------------------ states

  private registerStates(): void {
    const { fsm, world, ui, view } = this;

    fsm.register('menu', {
      enter: () => {
        world.demo = true;
        this.director.enabled = false;
        view.intensity = 0.3;
        view.rig.mode = 'menu';
        this.timeFx.reset();
        this.stepper.reset();
        this.demoLevel = this.startWorld * STAGES_PER_WORLD;
        this.demoTimer = 0;
        world.setLoadout(null); // attract mode drops every kind
        world.newGame(randomSeed(), this.demoLevel);
        this.music.track = this.campaign.musicTrackOf(this.demoLevel);
        this.music.mode = 'menu';
        this.music.setIntensity(0.12);
        ui.setHudVisible(false);
        ui.setMenuBest(this.best);
        ui.showScreen('menu');
      },
      update: (dt) => {
        this.simulate(dt);
        if (world.phase === 'cleared') {
          this.demoTimer += dt;
          if (this.demoTimer > 2.2) {
            this.demoTimer = 0;
            // Cycle through the picked world's ordinary levels (bosses are skipped).
            const first = this.startWorld * STAGES_PER_WORLD;
            for (let n = 0; n < STAGES_PER_WORLD; n++) {
              this.demoLevel = first + ((this.demoLevel - first + 1) % STAGES_PER_WORLD);
              if (!this.campaign.level(this.demoLevel).boss) break;
            }
            world.loadLevel(this.demoLevel);
          }
        }
      },
    });

    // Power-up picker shown before every level. The level is already loaded (ball waiting on the paddle)
    // but the simulation is not stepped, so no time passes, nothing moves and nothing can drop.
    fsm.register('loadout', {
      enter: () => {
        view.rig.mode = 'play';
        ui.setHudVisible(true);
        this.music.setIntensity(0.15);
        ui.openLoadout(world.levelIndex, this.lastLoadout ?? []);
      },
      update: (dt) => {
        view.update(dt, 0, this.alpha);
        this.updateHud(dt);
      },
    });

    fsm.register('playing', {
      enter: () => {
        view.rig.mode = 'play';
        ui.showScreen(null);
        ui.setHudVisible(true);
      },
      update: (dt) => {
        this.simulate(dt);
        this.updateHud(dt);
        this.music.setIntensity(this.musicIntensity());
      },
    });

    fsm.register('paused', {
      enter: () => {
        ui.showScreen('pause');
        this.music.setIntensity(0.1);
        this.director.setPaused(true);
      },
      exit: () => this.director.setPaused(false),
      update: (dt) => view.update(dt, 0, this.alpha),
    });

    fsm.register('transition', {
      enter: () => {
        const bossLevel = this.campaign.level(world.levelIndex).boss !== undefined;
        this.transitionTimer = bossLevel ? 4 : 2.6;
        // (No slow motion here: it ran the whole sim, paddle included, at 30% speed, so the paddle felt
        // stuck after every clear.)
        this.music.setIntensity(0.3);
      },
      update: (dt) => {
        this.simulate(dt);
        this.updateHud(dt);
        this.transitionTimer -= dt;
        if (this.transitionTimer > 0) return;
        if (world.levelIndex + 1 >= this.runEnd) {
          fsm.transition('victory');
        } else {
          world.loadLevel(world.levelIndex + 1);
          this.beginLevel();
        }
      },
    });

    const endScreen = (screen: 'gameover' | 'victory') => ({
      enter: (): void => {
        const newBest = world.score > this.best;
        if (newBest) {
          this.best = world.score;
          Storage.saveHighScore(this.best);
        }
        ui.setResult(screen, {
          score: world.score,
          best: this.best,
          newBest,
          level: world.levelIndex + 1,
          bestCombo: world.bestCombo,
        });
        ui.setHudVisible(false);
        ui.showScreen(screen);
        view.rig.mode = 'menu';
        this.music.mode = 'menu';
        this.music.setIntensity(screen === 'victory' ? 0.6 : 0.08);
      },
      update: (dt: number): void => this.simulate(dt),
    });
    fsm.register('gameover', endScreen('gameover'));
    fsm.register('victory', endScreen('victory'));
  }

  private startGame(): void {
    const world = this.world;
    world.demo = false;
    this.director.enabled = true;
    this.view.intensity = 1;
    this.timeFx.reset();
    this.stepper.reset();
    this.input.consumeAction();
    this.stepInput.action = false;
    this.pointerFrom = this.pointerTo = null;
    this.pointerOffset = 0;
    this.lastRawPointer = null;
    const start = startLevelFromUrl(this.campaign) ?? this.startWorld * STAGES_PER_WORLD;
    this.runEnd = new URLSearchParams(window.location.search).has('editorPreview')
      ? start + 1
      : this.campaign.runEndLevel(start);
    world.newGame(randomSeed(), start);
    this.beginLevel();
  }

  /** The next run and menu demo start in the selected world. */
  private selectWorld(index: number): void {
    if (index === this.startWorld || index < 0 || index * STAGES_PER_WORLD >= this.campaign.levelCount) return;
    this.startWorld = index;
    if (!this.fsm.is('menu')) return;
    this.demoLevel = index * STAGES_PER_WORLD;
    this.demoTimer = 0;
    this.music.track = this.campaign.musicTrackOf(this.demoLevel);
    this.world.loadLevel(this.demoLevel);
  }

  /** A level has just been loaded: open the power-up picker (the QA autopilot skips it and allows every kind). */
  private beginLevel(): void {
    if (AUTOPILOT) {
      this.world.setLoadout(null);
      this.showLevelBanner();
      this.fsm.transition('playing');
    } else {
      this.fsm.transition('loadout');
    }
  }

  /** The player confirmed their picks: only those kinds can drop this level. */
  private confirmLoadout(kinds: readonly PowerUpKind[]): void {
    if (!this.fsm.is('loadout')) return;
    this.world.setLoadout(kinds);
    this.lastLoadout = [...kinds];
    // The confirming click or key must not also launch the ball or move the paddle.
    this.input.reset();
    this.stepInput.action = false;
    this.pointerFrom = this.pointerTo = null;
    this.pointerOffset = 0;
    this.lastRawPointer = null;
    this.showLevelBanner();
    this.fsm.transition('playing');
  }

  private showLevelBanner(): void {
    const index = this.world.levelIndex;
    const def = this.campaign.level(index);
    if (def.boss) this.ui.banner('WARNING', def.name, 2.4);
    else this.ui.banner(this.campaign.stageLabel(index).toUpperCase(), def.name, 1.9);
  }

  private togglePause(): void {
    if (this.fsm.is('playing')) this.fsm.transition('paused');
    else if (this.fsm.is('paused')) this.resume();
  }

  private readonly autoPause = (): void => {
    if (this.fsm.is('playing')) this.fsm.transition('paused');
  };

  private resume(): void {
    this.input.consumeAction();
    this.fsm.transition('playing');
  }

  private onUiAction(action: UiAction): void {
    switch (action) {
      case 'play':
      case 'restart':
        this.startGame();
        break;
      case 'resume':
        if (this.fsm.is('paused')) this.resume();
        break;
      case 'pause':
        this.togglePause();
        break;
      case 'menu':
        this.fsm.transition('menu');
        break;
    }
  }

  // ------------------------------------------------------------ world events

  private bindWorldEvents(): void {
    const { world, ui } = this;
    const ev = world.events;

    ev.on('levelLoaded', ({ index, name, boss }) => {
      if (world.demo) return;
      ui.setLevel(index, name);
      this.music.track = this.campaign.musicTrackOf(index);
      this.music.mode = boss ? 'boss' : 'game';
      // The level banner is shown once the power-up picker is confirmed (see showLevelBanner).
    });

    ev.on('levelCleared', ({ bonus }) => {
      if (world.demo) return;
      ui.banner(
        world.levelIndex + 1 >= this.runEnd ? 'VICTORY' : 'LEVEL CLEAR',
        `BONUS +${bonus.toLocaleString()}`,
        2.2,
      );
      this.fsm.transition('transition');
    });

    ev.on('gameOver', () => {
      if (!world.demo) this.fsm.transition('gameover');
    });

    // No full-screen flashes, and hit-stop freezes only for Refrakt's light show (refraktStarted below): a
    // freeze stops the paddle while the pointer keeps moving (simulate() holds its target for that reason).
    ev.on('bossStage', ({ stage }) => {
      if (world.demo) return;
      ui.banner(stage === 2 ? 'CRITICAL' : 'ENRAGED', world.boss.def?.name ?? '', 1.4);
    });

    ev.on('bossDefeated', ({ x, y, points }) => {
      if (world.demo) return;
      this.popup(`+${points.toLocaleString()}`, x, y, 0xffd23b);
    });

    ev.on('comboChanged', ({ combo, multiplier }) => {
      if (world.demo || combo === 0 || multiplier >= PLAYER.maxMultiplier + 1) return;
      if (combo % PLAYER.comboStep === 0 && combo / PLAYER.comboStep < PLAYER.maxMultiplier) {
        const ball = this.firstBall();
        this.popup(`COMBO x${multiplier}`, ball ? ball.x : 0, ball ? ball.y + 1.2 : 0, 0xffd23b);
      }
    });

    ev.on('powerUpCollected', ({ kind, x, y }) => {
      if (world.demo) return;
      this.popup(POWERUPS[kind].name, x, y + 1.4, POWERUPS[kind].color);
    });

    ev.on('refraktStarted', () => {
      if (world.demo) return;
      // The moment the prism breaks, everything holds still while its light show plays out; then play eases
      // back in from slow motion.
      this.timeFx.hitStop(REFRAKT.freeze);
      this.timeFx.slowMo(0.45, 0.5);
      const { left, right, top } = world.boundary.bounds;
      this.view.rig.project((left + right) / 2, (top + world.shieldY) / 2, this.ndc);
      this.ui.popup('REFRAKT', this.ndc.x, this.ndc.y, 0xffffff, 'grand');
    });
  }

  private firstBall(): { x: number; y: number } | null {
    for (const ball of this.world.balls.items) if (ball.active) return ball;
    return null;
  }

  private popup(text: string, x: number, y: number, color: number): void {
    const { left, right } = this.world.boundary.bounds;
    const clampedX = Math.max(left + 2, Math.min(right - 2, x));
    this.view.rig.project(clampedX, y, this.ndc);
    this.ui.popup(text, this.ndc.x, this.ndc.y, color);
  }

  // ------------------------------------------------------------------ helpers

  private updateHud(dt: number): void {
    this.ui.update(dt, this.world, Math.max(this.best, this.world.score));
  }

  private musicIntensity(): number {
    const world = this.world;
    if (world.boss.active) return 0.78 + (1 - world.boss.hp / world.boss.maxHp) * 0.22;
    const progress = world.bricksTotal > 0 ? 1 - world.bricksRemaining / world.bricksTotal : 0;
    return 0.36 + Math.min(0.3, world.combo * 0.02) + progress * 0.26;
  }

  private applySettings(persist: boolean): void {
    const s = this.settings;
    const profile = QUALITY_PROFILES[s.quality];
    this.audio.setVolumes(s.musicVolume, s.sfxVolume, s.ambienceVolume);
    this.view.rig.shakeScale = s.screenShake ? 1 : 0;
    this.renderer.setQuality(s.quality);
    this.view.setShadows(profile.shadows, profile.shadowMapSize);
    this.onResize();
    if (persist) Storage.saveSettings(s);
  }

  private readonly onResize = (): void => {
    const layout = layoutStage(this.stage, this.uiRoot);
    this.input.refreshBounds();
    this.renderer.resize(layout.width, layout.height);
    this.view.resize(
      layout.aspect,
      this.renderer.bufferWidth,
      this.renderer.bufferHeight,
      this.renderer.reflectionScale,
    );
  };
}

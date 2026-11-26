import { PLAYER, REFRAKT, SIM } from '../gameplay/config';
import { POWERUPS } from '../gameplay/powerups/powerUps';
import type { PowerUpKind } from '../gameplay/types';
import type { Campaign } from '../content/campaign';
import type { MusicTrackId } from '../content/musicTracks';
import { STAGES_PER_WORLD } from '../content/worlds';
import { StateMachine } from '../engine/core/StateMachine';
import { FixedStepper, TimeFx } from '../engine/core/Time';
import type { World } from '../gameplay/World';
import { PaddleDriver } from '../gameplay/PaddleDriver';
import type { CameraMode } from '../gameplay/CameraRig';
import type { MusicMode } from './audio/Music';
import type { LaunchOptions } from './launchOptions';
import type { ResultSummary, ScreenId, UiAction } from './UI';

export type GameState = 'menu' | 'loadout' | 'playing' | 'paused' | 'transition' | 'gameover' | 'victory';

/** What the flow needs from the 3D view (Game adapts GameView and its camera rig to this). */
export interface FlowView {
  /** How strongly effects play: subdued in the menu's attract mode, full in a run. */
  intensity: number;
  setCameraMode(mode: CameraMode): void;
  /** Advances the view: `alpha` interpolates between steps; `effectsDt` keeps effects moving during a hit-stop. */
  update(realDt: number, simDt: number, alpha: number, effectsDt?: number): void;
  /** The field X under a pointer position (normalised device coordinates), or null off the play plane. */
  pointerToFieldX(ndcX: number, ndcY: number): number | null;
  /** Where a field point appears on screen (normalised device coordinates), for popups. */
  project(x: number, y: number): { x: number; y: number };
}

/** What the flow needs from the HUD and menus (UI fits this as it is). */
export interface FlowUi {
  showScreen(id: ScreenId | null): void;
  setHudVisible(visible: boolean): void;
  setMenuBest(best: number): void;
  openLoadout(levelIndex: number, preselect: readonly PowerUpKind[]): void;
  banner(title: string, subtitle?: string, seconds?: number): void;
  popup(text: string, ndcX: number, ndcY: number, color: number, style?: 'normal' | 'grand'): void;
  setResult(screen: 'gameover' | 'victory', result: ResultSummary): void;
  setLevel(index: number, name: string): void;
  update(dt: number, world: World, best: number): void;
}

/** What the flow needs from sound (Game adapts AudioDirector and Music to this). */
export interface FlowAudio {
  /** Gameplay sound effects on (a run) or off (the menu's attract mode). */
  setEffectsEnabled(on: boolean): void;
  setPaused(paused: boolean): void;
  setMusicTrack(track: MusicTrackId): void;
  setMusicMode(mode: MusicMode): void;
  setMusicIntensity(intensity: number): void;
}

/** What the flow needs from keyboard, mouse and touch (Input fits this as it is). */
export interface FlowInput {
  readonly axis: number;
  readonly pointerActive: boolean;
  readonly pointerX: number;
  readonly pointerY: number;
  /** True once per launch press (click, Space). */
  consumeAction(): boolean;
  /** Forgets held keys and pending presses. */
  reset(): void;
}

/** Where the best score is kept (Storage fits this as it is). */
export interface FlowStore {
  loadHighScore(): number;
  saveHighScore(score: number): void;
}

export interface FlowPorts {
  readonly view: FlowView;
  readonly ui: FlowUi;
  readonly audio: FlowAudio;
  readonly input: FlowInput;
  readonly store: FlowStore;
  /** Seeds for new runs and the menu demo; random by default (tests pass a fixed one). */
  readonly seed?: () => number;
}

/** The level a run starts on when the launch options name one (?level, or the editor's test play), else null. */
function startLevelFromOptions(options: LaunchOptions, campaign: Campaign): number | null {
  if (options.editorPreview) {
    // The previewed world is the whole campaign (see main.ts).
    const { stage } = options.editorPreview;
    return stage < STAGES_PER_WORLD && stage < campaign.levelCount ? stage : 0;
  }
  const level = options.level;
  return level !== null && level >= 1 && level <= campaign.levelCount ? level - 1 : null;
}

function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

/**
 * The game's flow: the high-level states (menu with its attract-mode demo, power-up picker, playing, paused,
 * level transition, game over, victory), the fixed-step timing with hit-stop and slow motion, the player's
 * steering, and how gameplay events turn into banners, popups, music and state changes. It drives the World
 * and talks to the view, HUD, sound, input and storage only through the small interfaces above, so it runs
 * without a browser (tests use fakes; Game plugs in the real ones and owns the frame loop).
 */
export class GameFlow {
  private readonly fsm = new StateMachine<GameState>();
  private readonly stepper = new FixedStepper(SIM.step, SIM.maxStepsPerFrame);
  private readonly timeFx = new TimeFx();
  /** Who moves the paddle (the player or the autopilot), and each step's input from it (gameplay/PaddleDriver.ts). */
  private readonly paddle: PaddleDriver;
  private readonly view: FlowView;
  private readonly ui: FlowUi;
  private readonly audio: FlowAudio;
  private readonly input: FlowInput;
  private readonly store: FlowStore;
  private readonly seed: () => number;

  private best: number;
  private alpha = 0;
  private transitionTimer = 0;
  private demoTimer = 0;
  private demoLevel = 0;
  /** World selected on the main menu. */
  private startWorld = 0;
  private runEnd: number;
  /**
   * A state change asked for from inside the simulation (level cleared, game over): applied once the frame's
   * steps have run (see update), so the rest of them never run under a state that has already been left.
   */
  private pendingState: GameState | null = null;
  /** The player's last confirmed power-up loadout this session (pre-selected next time); null before the first. */
  private lastLoadout: readonly PowerUpKind[] | null = null;
  /** The state a pause returns to: a level in play, or the transition after one. */
  private resumeTo: 'playing' | 'transition' = 'playing';

  constructor(
    private readonly world: World,
    private readonly campaign: Campaign,
    private readonly options: LaunchOptions,
    ports: FlowPorts,
  ) {
    this.view = ports.view;
    this.ui = ports.ui;
    this.audio = ports.audio;
    this.input = ports.input;
    this.store = ports.store;
    this.seed = ports.seed ?? randomSeed;
    this.best = this.store.loadHighScore();
    this.runEnd = campaign.runEndLevel(0);
    const { input, view } = this;
    this.paddle = new PaddleDriver(
      world,
      {
        get axis() {
          return input.axis;
        },
        pointerX: () => (input.pointerActive ? view.pointerToFieldX(input.pointerX, input.pointerY) : null),
        consumeAction: () => input.consumeAction(),
      },
      options.autopilot,
    );
    this.world.events.on('lifeLost', () => this.paddle.lifeLost());
    this.bindWorldEvents();
    this.registerStates();
  }

  /** The current state (null until start). */
  get state(): GameState | null {
    return this.fsm.current;
  }

  /** Opens on the menu, or straight into a run for the editor's test play. */
  start(): void {
    this.fsm.transition('menu');
    if (this.options.editorPreview) this.startGame();
  }

  /** Once per display frame: runs the current state for `realDt` seconds, then any state change it asked for. */
  update(realDt: number): void {
    this.fsm.update(realDt);
    this.applyPendingState();
  }

  // ------------------------------------------------------------------ actions

  onUiAction(action: UiAction): void {
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

  /** The player confirmed their picks: only those kinds can drop this level. */
  confirmLoadout(kinds: readonly PowerUpKind[]): void {
    if (!this.fsm.is('loadout')) return;
    this.world.setLoadout(kinds);
    this.lastLoadout = [...kinds];
    // The confirming click or key must not also launch the ball or move the paddle.
    this.input.reset();
    this.paddle.reset();
    this.showLevelBanner();
    this.fsm.transition('playing');
  }

  /** The next run and menu demo start in the selected world. */
  selectWorld(index: number): void {
    if (index === this.startWorld || index < 0 || index * STAGES_PER_WORLD >= this.campaign.levelCount) return;
    this.startWorld = index;
    if (!this.fsm.is('menu')) return;
    this.demoLevel = index * STAGES_PER_WORLD;
    this.demoTimer = 0;
    this.audio.setMusicTrack(this.campaign.musicTrackOf(this.demoLevel));
    this.world.loadLevel(this.demoLevel);
  }

  togglePause(): void {
    if (this.pausable) this.fsm.transition('paused');
    else if (this.fsm.is('paused')) this.resume();
  }

  /** The window lost focus, the tab was hidden or the graphics context was lost: pause a level in play. */
  autoPause(): void {
    if (this.pausable) this.fsm.transition('paused');
  }

  /** A level in play, or the transition after one (its countdown waits while paused). */
  private get pausable(): boolean {
    return this.fsm.is('playing') || this.fsm.is('transition');
  }

  // --------------------------------------------------------------- simulation

  /** Advances the simulation by real time (after time effects) and refreshes the view. */
  private simulate(realDt: number): void {
    const simDt = this.timeFx.apply(realDt);
    this.paddle.frame(this.timeFx.frozen, simDt, this.stepper.pending);
    this.alpha = this.stepper.advance(simDt, this.tick);
    // During a hit-stop the effects keep moving on real time; only the game itself holds still.
    this.view.update(realDt, simDt, this.alpha, this.timeFx.frozen ? realDt : simDt);
  }

  private readonly tick = (step: number): void => {
    this.world.step(step, this.paddle.input(step));
    this.paddle.afterStep();
  };

  /** Switches to `state` once the frame's simulation steps are done (see pendingState). */
  private requestState(state: GameState): void {
    this.pendingState = state;
  }

  private applyPendingState(): void {
    const state = this.pendingState;
    if (state === null) return;
    this.pendingState = null;
    this.fsm.transition(state);
  }

  // ------------------------------------------------------------------ states

  private registerStates(): void {
    const { fsm, world, ui, view, audio } = this;

    fsm.register('menu', {
      enter: () => {
        world.demo = true;
        audio.setEffectsEnabled(false);
        view.intensity = 0.3;
        view.setCameraMode('menu');
        this.timeFx.reset();
        this.stepper.reset();
        this.demoLevel = this.startWorld * STAGES_PER_WORLD;
        this.demoTimer = 0;
        world.setLoadout(null); // attract mode drops every kind
        world.newGame(this.seed(), this.demoLevel);
        audio.setMusicTrack(this.campaign.musicTrackOf(this.demoLevel));
        audio.setMusicMode('menu');
        audio.setMusicIntensity(0.12);
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
        view.setCameraMode('play');
        ui.setHudVisible(true);
        audio.setMusicIntensity(0.15);
        ui.openLoadout(world.levelIndex, this.lastLoadout ?? []);
      },
      update: (dt) => {
        view.update(dt, 0, this.alpha);
        this.updateHud(dt);
      },
    });

    fsm.register('playing', {
      enter: () => {
        view.setCameraMode('play');
        ui.showScreen(null);
        ui.setHudVisible(true);
      },
      update: (dt) => {
        this.simulate(dt);
        this.updateHud(dt);
        audio.setMusicIntensity(this.musicIntensity());
      },
    });

    fsm.register('paused', {
      enter: (previous) => {
        this.resumeTo = previous === 'transition' ? 'transition' : 'playing';
        ui.showScreen('pause');
        audio.setMusicIntensity(0.1);
        audio.setPaused(true);
      },
      exit: () => audio.setPaused(false),
      update: (dt) => view.update(dt, 0, this.alpha),
    });

    fsm.register('transition', {
      enter: (previous) => {
        if (previous === 'paused') {
          // Back from a pause: the countdown carries on where it stopped.
          ui.showScreen(null);
          audio.setMusicIntensity(0.3);
          return;
        }
        const bossLevel = this.campaign.level(world.levelIndex).boss !== undefined;
        this.transitionTimer = bossLevel ? 4 : 2.6;
        // (No slow motion here: it ran the whole sim, paddle included, at 30% speed, so the paddle felt
        // stuck after every clear.)
        audio.setMusicIntensity(0.3);
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
          this.store.saveHighScore(this.best);
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
        view.setCameraMode('menu');
        audio.setMusicMode('menu');
        audio.setMusicIntensity(screen === 'victory' ? 0.6 : 0.08);
      },
      update: (dt: number): void => this.simulate(dt),
    });
    fsm.register('gameover', endScreen('gameover'));
    fsm.register('victory', endScreen('victory'));
  }

  private startGame(): void {
    const world = this.world;
    world.demo = false;
    this.audio.setEffectsEnabled(true);
    this.view.intensity = 1;
    this.timeFx.reset();
    this.stepper.reset();
    this.input.consumeAction();
    this.paddle.reset();
    this.pendingState = null;
    const start = startLevelFromOptions(this.options, this.campaign) ?? this.startWorld * STAGES_PER_WORLD;
    this.runEnd = this.options.editorPreview ? start + 1 : this.campaign.runEndLevel(start);
    world.newGame(this.seed(), start);
    this.beginLevel();
  }

  /** A level has just been loaded: open the power-up picker (the QA autopilot skips it and allows every kind). */
  private beginLevel(): void {
    if (this.options.autopilot) {
      this.world.setLoadout(null);
      this.showLevelBanner();
      this.fsm.transition('playing');
    } else {
      this.fsm.transition('loadout');
    }
  }

  private showLevelBanner(): void {
    const index = this.world.levelIndex;
    const def = this.campaign.level(index);
    if (def.boss) this.ui.banner('WARNING', def.name, 2.4);
    else this.ui.banner(this.campaign.stageLabel(index).toUpperCase(), def.name, 1.9);
  }

  private resume(): void {
    this.input.consumeAction();
    this.fsm.transition(this.resumeTo);
  }

  // ------------------------------------------------------------ world events

  private bindWorldEvents(): void {
    const { world, ui } = this;
    const ev = world.events;

    ev.on('levelLoaded', ({ index, name, boss }) => {
      if (world.demo) return;
      ui.setLevel(index, name);
      this.audio.setMusicTrack(this.campaign.musicTrackOf(index));
      this.audio.setMusicMode(boss ? 'boss' : 'game');
      // The level banner is shown once the power-up picker is confirmed (see showLevelBanner).
    });

    ev.on('levelCleared', ({ bonus }) => {
      if (world.demo) return;
      ui.banner(
        world.levelIndex + 1 >= this.runEnd ? 'VICTORY' : 'LEVEL CLEAR',
        `BONUS +${bonus.toLocaleString()}`,
        2.2,
      );
      this.requestState('transition');
    });

    ev.on('gameOver', () => {
      if (!world.demo) this.requestState('gameover');
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
      const at = this.view.project((left + right) / 2, (top + world.shieldY) / 2);
      this.ui.popup('REFRAKT', at.x, at.y, 0xffffff, 'grand');
    });
  }

  private firstBall(): { x: number; y: number } | null {
    for (const ball of this.world.balls.items) if (ball.active) return ball;
    return null;
  }

  private popup(text: string, x: number, y: number, color: number): void {
    const { left, right } = this.world.boundary.bounds;
    const clampedX = Math.max(left + 2, Math.min(right - 2, x));
    const at = this.view.project(clampedX, y);
    this.ui.popup(text, at.x, at.y, color);
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
}

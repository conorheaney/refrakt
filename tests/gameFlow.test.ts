import { describe, expect, it } from 'vitest';
import { GameFlow } from '../src/app/GameFlow';
import { DEFAULT_LAUNCH_OPTIONS, type LaunchOptions } from '../src/app/launchOptions';
import type { ResultSummary, ScreenId } from '../src/app/UI';
import { REFRAKT } from '../src/gameplay/config';
import { PowerUpKind } from '../src/gameplay/types';
import { World } from '../src/gameplay/World';
import { CLASSIC } from './support/worlds';

const FRAME = 1 / 60;
const PICKS = [PowerUpKind.Expand, PowerUpKind.Laser, PowerUpKind.Shield];

/** A GameFlow on the classic test campaign with fakes that record what it asks of the view, HUD, sound and storage. */
function harness(options: Partial<LaunchOptions> = {}) {
  const world = new World(CLASSIC);
  const view = {
    intensity: 1,
    camera: 'menu' as string,
    setCameraMode(mode: string) {
      this.camera = mode;
    },
    update() {},
    // The fake pointer reports field units directly.
    pointerToFieldX: (x: number) => x,
    project: (x: number, y: number) => ({ x, y }),
  };
  const ui = {
    screen: null as ScreenId | null,
    hud: false,
    banners: [] as string[],
    popups: [] as string[],
    loadouts: [] as number[],
    results: [] as (ResultSummary & { screen: string })[],
    showScreen(id: ScreenId | null) {
      this.screen = id;
    },
    setHudVisible(visible: boolean) {
      this.hud = visible;
    },
    setMenuBest() {},
    openLoadout(levelIndex: number) {
      this.loadouts.push(levelIndex);
    },
    banner(title: string) {
      this.banners.push(title);
    },
    popup(text: string) {
      this.popups.push(text);
    },
    setResult(screen: 'gameover' | 'victory', result: ResultSummary) {
      this.results.push({ screen, ...result });
    },
    setLevel() {},
    update() {},
  };
  const audio = {
    effects: false,
    paused: false,
    mode: '' as string,
    setEffectsEnabled(on: boolean) {
      this.effects = on;
    },
    setPaused(paused: boolean) {
      this.paused = paused;
    },
    setMusicTrack() {},
    setMusicMode(mode: string) {
      this.mode = mode;
    },
    setMusicIntensity() {},
  };
  const input = {
    axis: 0,
    pointerActive: false,
    pointerX: 0,
    pointerY: 0,
    presses: 0,
    consumeAction() {
      if (this.presses === 0) return false;
      this.presses--;
      return true;
    },
    reset() {
      this.presses = 0;
      this.axis = 0;
    },
  };
  const store = {
    best: 0,
    loadHighScore() {
      return this.best;
    },
    saveHighScore(score: number) {
      this.best = score;
    },
  };
  const flow = new GameFlow(
    world,
    CLASSIC,
    { ...DEFAULT_LAUNCH_OPTIONS, ...options },
    {
      view,
      ui,
      audio,
      input,
      store,
      seed: () => 7,
    },
  );
  /** Runs display frames for `seconds`. */
  const run = (seconds: number): void => {
    for (let t = 0; t < seconds - 1e-9; t += FRAME) flow.update(FRAME);
  };
  /** Clears the current level: every brick gone (a boss level's boss defeated); the next step notices. */
  const clearLevel = (): void => {
    for (const brick of world.bricks) brick.alive = false;
    world.brickField.remaining = 0;
    world.boss.active = false;
  };
  /** Starts a run and confirms the power-up picker. */
  const play = (): void => {
    flow.onUiAction('play');
    flow.confirmLoadout(PICKS);
  };
  return { world, flow, view, ui, audio, input, store, run, clearLevel, play };
}

describe('GameFlow', () => {
  it('opens on the menu, with the attract-mode demo playing quietly', () => {
    const { flow, world, ui, audio, view, run } = harness();
    expect(flow.state).toBeNull();
    flow.start();
    expect(flow.state).toBe('menu');
    expect(world.demo).toBe(true);
    expect(ui.screen).toBe('menu');
    expect(ui.hud).toBe(false);
    expect(audio.effects).toBe(false);
    expect(audio.mode).toBe('menu');
    expect(view.intensity).toBe(0.3);
    run(5);
    expect(world.time).toBeGreaterThan(4); // the demo plays
  });

  it("cycles the demo through the menu world's ordinary levels, skipping bosses", () => {
    const { flow, world, run, clearLevel } = harness();
    flow.start();
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      clearLevel();
      run(2.5);
      seen.push(world.levelIndex);
    }
    expect(seen).toEqual([1, 2, 3, 5]); // level 4 (index) is a boss
  });

  it('starts a run with the power-up picker, then plays with only the picked kinds', () => {
    const { flow, world, ui, audio, view } = harness();
    flow.start();
    flow.confirmLoadout(PICKS); // ignored outside the picker
    expect(flow.state).toBe('menu');
    flow.onUiAction('play');
    expect(flow.state).toBe('loadout');
    expect(ui.loadouts).toEqual([0]);
    expect(world.demo).toBe(false);
    expect(audio.effects).toBe(true);
    expect(view.intensity).toBe(1);
    flow.confirmLoadout(PICKS);
    expect(flow.state).toBe('playing');
    expect(world.loadout).toEqual(PICKS);
    expect(ui.banners).toEqual(['SPACE LEVEL 1']);
    expect(view.camera).toBe('play');
  });

  it('keeps the simulation still in the power-up picker', () => {
    const { flow, world, run } = harness();
    flow.start();
    flow.onUiAction('play');
    const time = world.time;
    run(2);
    expect(world.time).toBe(time);
  });

  it('skips the picker under ?autopilot, allowing every kind, and plays by itself', () => {
    const { flow, world, run } = harness({ autopilot: true });
    flow.start();
    flow.onUiAction('play');
    expect(flow.state).toBe('playing');
    expect(world.loadout).toBeNull();
    run(3);
    expect(world.phase).toBe('live'); // the autopilot launched the ball
  });

  it('pauses and resumes, holding time still while paused', () => {
    const { flow, world, ui, audio, run, play } = harness();
    flow.start();
    play();
    run(1);
    flow.togglePause();
    expect(flow.state).toBe('paused');
    expect(ui.screen).toBe('pause');
    expect(audio.paused).toBe(true);
    const time = world.time;
    run(2);
    expect(world.time).toBe(time);
    flow.onUiAction('resume');
    expect(flow.state).toBe('playing');
    expect(audio.paused).toBe(false);
    run(1);
    expect(world.time).toBeGreaterThan(time);
  });

  it('auto-pauses only a level in play', () => {
    const { flow, play } = harness();
    flow.start();
    flow.autoPause();
    expect(flow.state).toBe('menu');
    flow.onUiAction('play');
    flow.autoPause();
    expect(flow.state).toBe('loadout');
    flow.confirmLoadout(PICKS);
    flow.autoPause();
    expect(flow.state).toBe('paused');
    play(); // Restart from the pause menu
    expect(flow.state).toBe('playing');
  });

  it('moves from a cleared level to the next one through the transition, changing state after the step (Q6)', () => {
    const { flow, world, ui, run, clearLevel, play } = harness();
    flow.start();
    play();
    let stateDuringStep: string | null = null;
    world.events.on('levelCleared', () => (stateDuringStep = flow.state));
    clearLevel();
    flow.update(FRAME);
    // The clear happened inside the frame's steps, under 'playing'; the change came after them.
    expect(stateDuringStep).toBe('playing');
    expect(flow.state).toBe('transition');
    expect(ui.banners).toContain('LEVEL CLEAR');
    run(3);
    expect(flow.state).toBe('loadout');
    expect(world.levelIndex).toBe(1);
  });

  it('ends a run that reaches its last level in victory, keeping a new best score', () => {
    // ?level=19: the second-last level of the main campaign (20 levels, the last a boss).
    const { flow, world, ui, store, run, clearLevel } = harness({ level: 19 });
    flow.start();
    flow.onUiAction('play');
    flow.confirmLoadout(PICKS);
    expect(world.levelIndex).toBe(18);
    clearLevel();
    run(3);
    flow.confirmLoadout(PICKS);
    expect(world.levelIndex).toBe(19);
    expect(world.boss.active).toBe(true);
    clearLevel();
    flow.update(FRAME);
    expect(ui.banners).toContain('VICTORY');
    run(5);
    expect(flow.state).toBe('victory');
    expect(ui.results.map((r) => r.screen)).toEqual(['victory']);
    expect(ui.results[0].level).toBe(20);
    expect(store.best).toBe(world.score);
    expect(world.score).toBeGreaterThan(0);
  });

  it('ends in game over when the last life is lost, after the step (Q6)', () => {
    const { flow, world, ui, run, play } = harness();
    flow.start();
    play();
    world.lives = 1;
    world.score = 500;
    let stateDuringStep: string | null = null;
    world.events.on('gameOver', () => (stateDuringStep = flow.state));
    const ball = world.balls.items.find((b) => b.active)!;
    world.phase = 'live';
    Object.assign(ball, { stuck: false, y: -40, py: -40, dy: -1 });
    flow.update(FRAME);
    expect(stateDuringStep).toBe('playing');
    expect(flow.state).toBe('gameover');
    expect(ui.results[0]).toMatchObject({ screen: 'gameover', score: 500, newBest: true });
    run(1); // the end screen keeps the (finished) world running behind it
    expect(flow.state).toBe('gameover');
  });

  it("plays only the editor's test level, starting straight away", () => {
    const { flow, world, run, clearLevel } = harness({ editorPreview: { stage: 2 } });
    flow.start();
    expect(flow.state).toBe('loadout');
    expect(world.levelIndex).toBe(2);
    flow.confirmLoadout(PICKS);
    clearLevel();
    run(5);
    expect(flow.state).toBe('victory');
  });

  it('starts the next run in the world picked on the menu', () => {
    const { flow, world, play } = harness();
    flow.start();
    flow.selectWorld(1);
    expect(world.levelIndex).toBe(10); // the demo switched world
    play();
    expect(world.levelIndex).toBe(10);
  });
});

describe('GameFlow steering', () => {
  /** A run in play with the pointer resting at `x`, the paddle parked under it. */
  function steering(x: number) {
    const h = harness();
    h.flow.start();
    h.play();
    h.input.pointerActive = true;
    h.input.pointerX = x;
    h.run(1);
    return h;
  }

  it('follows the pointer', () => {
    const { world, input, run } = steering(0);
    input.pointerX = 6;
    run(1);
    expect(world.paddle.x).toBeCloseTo(6, 3);
  });

  it("holds the paddle through Refrakt's freeze, then lets the cursor take over gradually (Q8)", () => {
    const { world, input, ui, run } = steering(0);
    world.events.emit('refraktStarted', { x: 0, y: 5 });
    expect(ui.popups).toContain('REFRAKT');
    // The cursor moves while play is frozen...
    input.pointerX = 8;
    run(REFRAKT.freeze + 1);
    // ...and the paddle doesn't lurch after it once play resumes.
    expect(Math.abs(world.paddle.x)).toBeLessThan(0.05);
    // Moving the pointer wears the difference off: 2 units of movement take 1 unit of it away.
    input.pointerX = 10;
    run(1);
    expect(world.paddle.x).toBeCloseTo(10 - (8 - 2 * 0.5), 3);
  });

  it("keeps a snake's shove, rather than snapping back to the resting cursor (Q4)", () => {
    const { world, run } = steering(0);
    world.paddle.shove = -3;
    run(1.5);
    expect(world.paddle.shove).toBe(0);
    expect(world.paddle.x).toBeCloseTo(-3, 2);
  });
});

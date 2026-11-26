import { describe, expect, it } from 'vitest';
import { AudioDirector } from '../src/app/audio/AudioDirector';
import type { ViewEvents } from '../src/app/viewEvents';
import type { AudioEngine } from '../src/engine/audio/AudioEngine';
import { EventBus } from '../src/engine/core/EventBus';
import type { GameEvents } from '../src/gameplay/events';
import { BrickKind, PowerUpKind, type Brick } from '../src/gameplay/types';

/** An audio engine that records what it is asked to play, on a clock the test moves. */
class FakeAudio {
  readonly context = { currentTime: 0, state: 'running' };
  /** One entry per one-shot sound (tone, noise, sample, swell), by method. */
  readonly played: string[] = [];
  readonly loops = new Map<string, number>();
  duck = 1;
  tone(): void {
    this.played.push('tone');
  }
  noise(): void {
    this.played.push('noise');
  }
  sample(): boolean {
    this.played.push('sample');
    return true;
  }
  swell(): void {
    this.played.push('swell');
  }
  noiseBed(): null {
    return null;
  }
  setLoop(name: string, vol: number): void {
    this.loops.set(name, vol);
  }
  setAmbienceDuck(level: number): void {
    this.duck = level;
  }
}

function harness() {
  const audio = new FakeAudio();
  const events = new EventBus<GameEvents>();
  const view = new EventBus<ViewEvents>();
  const director = new AudioDirector(audio as unknown as AudioEngine, events, view);
  /** Sounds played while running `fn`, with the clock moved well past every rate limit first. */
  const soundsFrom = (fn: () => void): number => {
    audio.context.currentTime += 10;
    const before = audio.played.length;
    fn();
    return audio.played.length - before;
  };
  return { audio, events, view, director, soundsFrom };
}

const brick = { kind: BrickKind.Normal, x: 0, y: 5, col: 6, row: 0, hp: 0, maxHp: 1 } as Brick;

/** One of each kind of gameplay moment the player should hear. */
const MOMENTS: [string, (events: EventBus<GameEvents>) => void][] = [
  ['a launch', (e) => e.emit('ballLaunched', { x: 0, y: -8 })],
  ['a wall bounce', (e) => e.emit('ballWall', { x: 13, y: 0, nx: -1, ny: 0 })],
  ['a paddle hit', (e) => e.emit('ballPaddle', { x: 0, y: -8, offset: 0, caught: false })],
  ['a brick breaking', (e) => e.emit('brickDestroyed', { brick, cause: 'ball', points: 10, combo: 1 })],
  ['a power-up', (e) => e.emit('powerUpCollected', { kind: PowerUpKind.Expand, x: 0, y: -8 })],
  ['a lost life', (e) => e.emit('lifeLost', { lives: 2 })],
  ['game over', (e) => e.emit('gameOver', { score: 100 })],
  ['a cleared level', (e) => e.emit('levelCleared', { index: 0, bonus: 1000 })],
  ['a boss hit', (e) => e.emit('bossHit', { x: 0, y: 7, hp: 10, maxHp: 20 })],
  ['a power-up running out', (e) => e.emit('powerUpWarning', { kind: PowerUpKind.Expand, left: 2, x: 0 })],
  ['a power-up ending', (e) => e.emit('powerUpExpired', { kind: PowerUpKind.Expand, x: 0 })],
  ['the barrier saving a ball', (e) => e.emit('shieldHit', { x: 0, charges: 1 })],
  ['a boss enraged', (e) => e.emit('bossStage', { stage: 1 })],
  ['a boss defeated', (e) => e.emit('bossDefeated', { x: 0, y: 7, points: 5000 })],
  ['a stunned paddle', (e) => e.emit('paddleStunned', { x: 0 })],
  ['an icicle striking the paddle', (e) => e.emit('paddleStruck', { x: 0, y: -9 })],
  ['a snake biting the paddle', (e) => e.emit('paddleBitten', { x: 0, y: -9 })],
];

describe('AudioDirector', () => {
  for (const [name, emit] of MOMENTS) {
    it(`plays ${name}`, () => {
      const { events, soundsFrom } = harness();
      expect(soundsFrom(() => emit(events))).toBeGreaterThan(0);
    });
  }

  it("stays silent in the menu's attract mode (disabled)", () => {
    const { events, view, director, audio, soundsFrom } = harness();
    director.enabled = false;
    for (const [name, emit] of MOMENTS)
      expect(
        soundsFrom(() => emit(events)),
        name,
      ).toBe(0);
    view.emit('weatherChanged', { weather: 'rain' });
    expect(audio.loops.get('rainHeavy')).toBe(0);
  });

  it("doesn't machine-gun a sound repeated within its rate limit", () => {
    const { events, audio, soundsFrom } = harness();
    const first = soundsFrom(() => events.emit('ballLaunched', { x: 0, y: -8 }));
    const before = audio.played.length;
    events.emit('ballLaunched', { x: 0, y: -8 }); // the same instant
    expect(first).toBeGreaterThan(0);
    expect(audio.played.length).toBe(before);
  });

  it('hums under Refrakt, and stops when it ends', () => {
    const { events, audio } = harness();
    events.emit('refraktStarted', { x: 0, y: 5 });
    expect(audio.loops.get('refraktHum')).toBeGreaterThan(0);
    events.emit('refraktEnded', { cut: false });
    expect(audio.loops.get('refraktHum')).toBe(0);
  });

  it('hushes the hum and ducks the ambience while paused, and restores both', () => {
    const { events, director, audio } = harness();
    events.emit('refraktStarted', { x: 0, y: 5 });
    director.setPaused(true);
    expect(audio.loops.get('refraktHum')).toBe(0);
    expect(audio.duck).toBe(0.3);
    director.setPaused(false);
    expect(audio.loops.get('refraktHum')).toBeGreaterThan(0);
    expect(audio.duck).toBe(1);
  });

  it("starts each world's weather sound from the view's events, and stops it on a clear level", () => {
    const { view, director, audio } = harness();
    const ambience = director as unknown as { snow: { active: boolean }; tomb: { active: boolean } };
    view.emit('weatherChanged', { weather: 'rain' });
    expect(audio.loops.get('rainHeavy')).toBeGreaterThan(0);
    view.emit('weatherChanged', { weather: 'snow' });
    expect(audio.loops.get('rainHeavy')).toBe(0);
    expect(ambience.snow.active).toBe(true);
    view.emit('weatherChanged', { weather: 'dust' });
    expect(ambience.snow.active).toBe(false);
    expect(ambience.tomb.active).toBe(true);
    view.emit('weatherChanged', { weather: undefined });
    expect(ambience.tomb.active).toBe(false);
    expect(audio.loops.get('rainHeavy')).toBe(0);
  });

  it("plays thunder for the view's lightning strikes", () => {
    const { view, soundsFrom } = harness();
    view.emit('weatherChanged', { weather: 'rain' });
    expect(soundsFrom(() => view.emit('thunder', { delay: 2, strength: 1 }))).toBeGreaterThan(0);
  });

  it("follows the tomb's rumbles and the snow's gusts without failing", () => {
    const { view } = harness();
    view.emit('weatherChanged', { weather: 'dust' });
    expect(() => {
      view.emit('dustFrame', { realDt: 1 / 60, simDt: 1 / 60 });
      view.emit('rumble', { strength: 1, lead: 0.5, rise: 0.4, hold: 2, fall: 1.6 });
      view.emit('torchFlare', { side: -1, strength: 1 });
    }).not.toThrow();
    view.emit('weatherChanged', { weather: 'snow' });
    expect(() => view.emit('snowFrame', { realDt: 1 / 60, simDt: 1 / 60, gust: 0.8 })).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { AudioDirector } from '../src/app/audio/AudioDirector';
import type { AudioEngine } from '../src/engine/audio/AudioEngine';
import { EventBus } from '../src/engine/core/EventBus';
import type { GameEvents } from '../src/gameplay/events';
import { BrickKind, PowerUpKind, type Brick } from '../src/gameplay/types';
import { FakeAudio } from './support/fakeAudio';

function harness() {
  const audio = new FakeAudio();
  const events = new EventBus<GameEvents>();
  const director = new AudioDirector(audio as unknown as AudioEngine, events);
  /** Sounds played while running `fn`, with the clock moved well past every rate limit first. */
  const soundsFrom = (fn: () => void): number => {
    audio.context.currentTime += 10;
    const before = audio.played.length;
    fn();
    return audio.played.length - before;
  };
  return { audio, events, director, soundsFrom };
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
  ['a power-up running out', (e) => e.emit('powerUpWarning', { kind: PowerUpKind.Expand, left: 2, x: 0 })],
  ['a power-up ending', (e) => e.emit('powerUpExpired', { kind: PowerUpKind.Expand, x: 0 })],
  ['the barrier saving a ball', (e) => e.emit('shieldHit', { x: 0, charges: 1 })],
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
    const { events, director, soundsFrom } = harness();
    director.enabled = false;
    for (const [name, emit] of MOMENTS)
      expect(
        soundsFrom(() => emit(events)),
        name,
      ).toBe(0);
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
});

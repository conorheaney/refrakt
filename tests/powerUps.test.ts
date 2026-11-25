import { describe, expect, it } from 'vitest';
import { BALL, SIM } from '../src/gameplay/config';
import { POWERUPS } from '../src/gameplay/powerups/powerUps';
import { POWERUP_KIND_COUNT, POWERUP_KINDS, PowerUpKind } from '../src/gameplay/types';
import { World } from '../src/gameplay/World';
import { CLASSIC } from './support/worlds';

describe('power-up table', () => {
  it('derives the kind list from the enum, numbered 0..n-1 (timers and loadouts index by kind)', () => {
    expect(POWERUP_KINDS).toEqual(POWERUP_KINDS.map((_, i) => i));
    expect(POWERUP_KIND_COUNT).toBe(Object.keys(POWERUPS).length);
  });

  it('gives every timed kind an effect and every instant kind a pickup action', () => {
    for (const kind of POWERUP_KINDS) {
      const def = POWERUPS[kind];
      if (def.duration > 0) expect(def.modifiers ?? def.onExpire, def.name).toBeDefined();
      else expect(def.onCollect, def.name).toBeDefined();
      expect(def.weight).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it('applies modifiers only while their timer runs', () => {
    const world = new World(CLASSIC);
    world.newGame(1);
    const base = world.ballSpeed;
    expect(world.powerUps.grants('pierce')).toBe(false);
    world.powerUps.collect(PowerUpKind.Slow, 0, 0);
    world.powerUps.collect(PowerUpKind.Fire, 0, 0);
    expect(world.ballSpeed).toBeCloseTo(base * BALL.slowFactor, 9);
    expect(world.powerUps.grants('pierce')).toBe(true);
    expect(world.powerUps.grants('lasers')).toBe(false);
    world.effectTime[PowerUpKind.Slow] = SIM.step / 2;
    world.step(SIM.step, { targetX: null, axis: 0, action: false });
    expect(world.ballSpeed).toBeCloseTo(base, 9);
    expect(world.powerUps.grants('pierce')).toBe(true);
  });
});

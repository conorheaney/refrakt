import { describe, expect, it } from 'vitest';
import { SIM } from '../src/gameplay/config';
import { EventBus } from '../src/engine/core/EventBus';
import { Random } from '../src/engine/core/Random';
import type { GameEvents } from '../src/gameplay/events';
import type { HazardSystem } from '../src/gameplay/hazards/hazards';
import { HazardTriggers } from '../src/gameplay/hazards/HazardTriggers';
import { AmbienceClock } from '../src/gameplay/ambience/AmbienceClock';
import type { AmbienceSettings } from '../src/gameplay/ambience/settings';
import { World } from '../src/gameplay/World';
import { SHIPPED_CAMPAIGN } from './support/worlds';

const SNOW: AmbienceSettings = {
  kind: 'snow',
  paths: [
    {
      points: [
        { x: -5, y: 10 },
        { x: 5, y: 10 },
      ],
    },
  ],
  every: [20, 30],
};

/** A hazard a cue can set off, counting how often it is. */
function cueable(): HazardSystem & { triggered: number } {
  return {
    cueable: 'scarabs',
    cued: false,
    triggered: 0,
    trigger() {
      this.triggered++;
    },
    load: () => {},
    reset: () => {},
    update: () => 0,
  };
}

/** Runs the clock for `seconds` and returns the time of each pulse. */
function pulses(clock: AmbienceClock, events: EventBus<GameEvents>, seconds: number, live = true): number[] {
  const at: number[] = [];
  let t = 0;
  const off = events.on('ambiencePulse', () => at.push(t));
  for (; t < seconds; t += SIM.step) clock.update(SIM.step, live);
  off?.();
  return at;
}

function clock() {
  const events = new EventBus<GameEvents>();
  return { events, clock: new AmbienceClock(new Random(4), events) };
}

describe('ambience clock', () => {
  it("pulses within the ambience's wait, the first sooner, and later levels more often", () => {
    const first = clock();
    first.clock.load(SNOW, 0);
    const times = pulses(first.clock, first.events, 600);
    expect(times[0]).toBeGreaterThanOrEqual(10 - SIM.step);
    expect(times[0]).toBeLessThanOrEqual(15 + SIM.step);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(20 - SIM.step);
      expect(times[i] - times[i - 1]).toBeLessThanOrEqual(30 + SIM.step);
    }
    const last = clock();
    last.clock.load(SNOW, 1);
    const later = pulses(last.clock, last.events, 600);
    for (let i = 1; i < later.length; i++) expect(later[i] - later[i - 1]).toBeLessThanOrEqual(30 * 0.65 + SIM.step);
    expect(later.length).toBeGreaterThan(times.length);
  });

  it('waits while the ball is out of play, and never pulses in clear ambience', () => {
    const { clock: c, events } = clock();
    c.load(SNOW, 0);
    expect(pulses(c, events, 300, false)).toHaveLength(0);
    c.load(undefined, 0);
    expect(pulses(c, events, 300)).toHaveLength(0);
  });

  it('sets off the hazards cued by pulses on each one, and no others, without the ambience knowing of them', () => {
    const hazard = cueable();
    const { clock: c, events } = clock();
    const triggers = new HazardTriggers(events, [hazard]);
    c.load(SNOW, 0);
    triggers.load(undefined);
    expect(hazard.cued).toBe(false);
    pulses(c, events, 100);
    expect(hazard.triggered).toBe(0);
    triggers.load({ scarabs: 'pulse' });
    expect(hazard.cued).toBe(true);
    const times = pulses(c, events, 100);
    expect(hazard.triggered).toBe(times.length);
    expect(times.length).toBeGreaterThan(2);
  });
});

describe('ambience in the game', () => {
  it("the tomb's pulses bring its scarabs; other worlds' scarabs would keep their own time", () => {
    const world = new World(SHIPPED_CAMPAIGN);
    const index = SHIPPED_CAMPAIGN.worlds.findIndex((w) => w.def.name === 'Pharoughs Tomb');
    world.newGame(3, index * 10);
    expect(world.scarabs.nests.length).toBeGreaterThan(0);
    expect(world.scarabs.cued).toBe(true);
    const kinds: string[] = [];
    world.events.on('ambiencePulse', ({ kind }) => kinds.push(kind));
    world.phase = 'live';
    for (let t = 0; t < 15 && kinds.length === 0; t += SIM.step) world.ambience.update(SIM.step, true);
    expect(kinds).toEqual(['dust']);
    expect(world.scarabs.nests.some((n) => n.state === 'warn')).toBe(true);
  });

  it('gives every shipped world with ambience a clock, and none without', () => {
    const world = new World(SHIPPED_CAMPAIGN);
    SHIPPED_CAMPAIGN.worlds.forEach((entry, i) => {
      world.newGame(1, i * 10);
      expect(Number.isFinite(world.ambience.untilNext), entry.def.name).toBe(!!entry.ambience);
    });
  });
});

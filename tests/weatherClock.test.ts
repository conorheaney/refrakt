import { describe, expect, it } from 'vitest';
import { SIM } from '../src/gameplay/config';
import { EventBus } from '../src/engine/core/EventBus';
import { Random } from '../src/engine/core/Random';
import type { GameEvents } from '../src/gameplay/events';
import type { HazardSystem } from '../src/gameplay/hazards/hazards';
import { WeatherClock } from '../src/gameplay/weather/WeatherClock';
import type { WeatherSettings } from '../src/gameplay/weather/settings';
import { World } from '../src/gameplay/World';
import { SHIPPED_CAMPAIGN } from './support/worlds';

const SNOW: WeatherSettings = {
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

/** A hazard a storm can release, counting how often it is. */
function releasable(): HazardSystem & { released: number } {
  return {
    releasable: 'scarabs',
    cued: false,
    released: 0,
    release() {
      this.released++;
    },
    load: () => {},
    reset: () => {},
    update: () => 0,
  };
}

/** Runs the clock for `seconds` and returns the time of each storm. */
function storms(clock: WeatherClock, events: EventBus<GameEvents>, seconds: number, live = true): number[] {
  const at: number[] = [];
  let t = 0;
  const off = events.on('weatherStorm', () => at.push(t));
  for (; t < seconds; t += SIM.step) clock.update(SIM.step, live);
  off?.();
  return at;
}

function clock(hazards: HazardSystem[] = []) {
  const events = new EventBus<GameEvents>();
  return { events, clock: new WeatherClock(new Random(4), events, hazards) };
}

describe('weather clock', () => {
  it("storms within the weather's wait, the first sooner, and later levels more often", () => {
    const first = clock();
    first.clock.load(SNOW, 0);
    const times = storms(first.clock, first.events, 600);
    expect(times[0]).toBeGreaterThanOrEqual(10 - SIM.step);
    expect(times[0]).toBeLessThanOrEqual(15 + SIM.step);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(20 - SIM.step);
      expect(times[i] - times[i - 1]).toBeLessThanOrEqual(30 + SIM.step);
    }
    const last = clock();
    last.clock.load(SNOW, 1);
    const later = storms(last.clock, last.events, 600);
    for (let i = 1; i < later.length; i++) expect(later[i] - later[i - 1]).toBeLessThanOrEqual(30 * 0.65 + SIM.step);
    expect(later.length).toBeGreaterThan(times.length);
  });

  it('waits while the ball is out of play, and never storms in clear weather', () => {
    const { clock: c, events } = clock();
    c.load(SNOW, 0);
    expect(storms(c, events, 300, false)).toHaveLength(0);
    c.load(undefined, 0);
    expect(storms(c, events, 300)).toHaveLength(0);
  });

  it('releases the hazards its storms bring, and only those', () => {
    const brought = releasable();
    const { clock: c, events } = clock([brought]);
    c.load(SNOW, 0);
    expect(brought.cued).toBe(false);
    storms(c, events, 100);
    expect(brought.released).toBe(0);
    c.load({ ...SNOW, releases: ['scarabs'] }, 0);
    expect(brought.cued).toBe(true);
    const times = storms(c, events, 100);
    expect(brought.released).toBe(times.length);
    expect(times.length).toBeGreaterThan(2);
  });
});

describe('weather in the game', () => {
  it("the tomb's storms bring its scarabs; other worlds' scarabs would keep their own time", () => {
    const world = new World(SHIPPED_CAMPAIGN);
    const index = SHIPPED_CAMPAIGN.worlds.findIndex((w) => w.def.name === 'Pharoughs Tomb');
    world.newGame(3, index * 10);
    expect(world.scarabs.nests.length).toBeGreaterThan(0);
    expect(world.scarabs.cued).toBe(true);
    const kinds: string[] = [];
    world.events.on('weatherStorm', ({ kind }) => kinds.push(kind));
    world.phase = 'live';
    for (let t = 0; t < 15 && kinds.length === 0; t += SIM.step) world.weather.update(SIM.step, true);
    expect(kinds).toEqual(['dust']);
    expect(world.scarabs.nests.some((n) => n.state === 'warn')).toBe(true);
  });

  it('gives every shipped world with weather a clock, and none without', () => {
    const world = new World(SHIPPED_CAMPAIGN);
    SHIPPED_CAMPAIGN.worlds.forEach((entry, i) => {
      world.newGame(1, i * 10);
      expect(Number.isFinite(world.weather.untilNext), entry.def.name).toBe(!!entry.weather);
    });
  });
});

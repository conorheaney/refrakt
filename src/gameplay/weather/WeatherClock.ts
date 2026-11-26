import type { EventBus } from '../../engine/core/EventBus';
import { lerp } from '../../engine/core/math';
import type { Random } from '../../engine/core/Random';
import type { GameEvents } from '../events';
import type { HazardSystem } from '../hazards/hazards';
import type { WeatherSettings } from './settings';

/** By a world's last level, storms come this much sooner than on its first. */
const LAST_LEVEL_WAIT = 0.65;
/** A level's first storm comes this far into an ordinary wait, so it is noticed early. */
const FIRST_WAIT = 0.5;

/**
 * Decides when the world's weather storms (part of the simulation, so it is deterministic, waits while the ball
 * is out of play and pauses with the game). Each storm it announces `weatherStorm`, which the view passes to the
 * weather itself (gameplay/weather/Weather.ts), and releases every hazard the weather brings with it
 * (WeatherSettings.releases): those hazards then keep no timer of their own.
 */
export class WeatherClock {
  private settings: WeatherSettings | undefined;
  private difficulty = 0;
  /** Seconds until the next storm (Infinity without weather). */
  private untilStorm = Infinity;

  constructor(
    private readonly rng: Random,
    private readonly events: EventBus<GameEvents>,
    private readonly hazards: readonly HazardSystem[],
  ) {}

  /**
   * A level loads with this weather (undefined: clear). `difficulty` is 0 on a world's first level, 1 on its
   * tenth. Call before the hazards load, so they know whether storms bring them.
   */
  load(settings: WeatherSettings | undefined, difficulty: number): void {
    this.settings = settings;
    this.difficulty = Math.min(1, Math.max(0, difficulty));
    for (const hazard of this.hazards)
      if (hazard.releasable) hazard.cued = !!settings?.releases?.includes(hazard.releasable);
    this.reset(true);
  }

  /** A fresh wait (a level start, or a life lost). */
  reset(firstOfLevel = false): void {
    this.untilStorm = this.settings ? this.wait() * (firstOfLevel ? FIRST_WAIT : 1) : Infinity;
  }

  /** Seconds until the next storm. */
  get untilNext(): number {
    return this.untilStorm;
  }

  /** `live`: the ball is in play (the wait only counts down then). */
  update(dt: number, live: boolean): void {
    const settings = this.settings;
    if (!settings || !live) return;
    this.untilStorm -= dt;
    if (this.untilStorm > 0) return;
    this.untilStorm = this.wait();
    this.events.emit('weatherStorm', { kind: settings.kind });
    for (const hazard of this.hazards)
      if (hazard.releasable && settings.releases?.includes(hazard.releasable)) hazard.release?.();
  }

  private wait(): number {
    const [shortest, longest] = this.settings!.every;
    const scale = lerp(1, LAST_LEVEL_WAIT, this.difficulty);
    return this.rng.range(shortest * scale, longest * scale);
  }
}

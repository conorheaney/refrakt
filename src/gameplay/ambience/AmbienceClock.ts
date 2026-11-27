import type { EventBus } from '../../engine/core/EventBus';
import { lerp } from '../../engine/core/math';
import type { Random } from '../../engine/core/Random';
import type { GameEvents } from '../events';
import type { AmbienceSettings } from './settings';

/** By a world's last level, pulses come this much sooner than on its first. */
const LAST_LEVEL_WAIT = 0.65;
/** A level's first pulse comes this far into an ordinary wait, so it is noticed early. */
const FIRST_WAIT = 0.5;

/**
 * Decides when the world's ambience pulses (part of the simulation, so it is deterministic, waits while the ball
 * is out of play and pauses with the game). Each pulse it announces `ambiencePulse`, which the view passes to the
 * ambience itself (gameplay/ambience/Ambience.ts). Anything else that should happen with a pulse listens for it
 * too (hazards: gameplay/hazards/HazardTriggers.ts); the ambience knows nothing of them.
 */
export class AmbienceClock {
  private settings: AmbienceSettings | undefined;
  private difficulty = 0;
  /** Seconds until the next pulse (Infinity without ambience). */
  private untilPulse = Infinity;

  constructor(
    private readonly rng: Random,
    private readonly events: EventBus<GameEvents>,
  ) {}

  /**
   * A level loads with this ambience (undefined: none). `difficulty` is 0 on a world's first level, 1 on its
   * tenth.
   */
  load(settings: AmbienceSettings | undefined, difficulty: number): void {
    this.settings = settings;
    this.difficulty = Math.min(1, Math.max(0, difficulty));
    this.reset(true);
  }

  /** A fresh wait (a level start, or a life lost). */
  reset(firstOfLevel = false): void {
    this.untilPulse = this.settings ? this.wait() * (firstOfLevel ? FIRST_WAIT : 1) : Infinity;
  }

  /** Seconds until the next pulse. */
  get untilNext(): number {
    return this.untilPulse;
  }

  /** `live`: the ball is in play (the wait only counts down then). */
  update(dt: number, live: boolean): void {
    const settings = this.settings;
    if (!settings || !live) return;
    this.untilPulse -= dt;
    if (this.untilPulse > 0) return;
    this.untilPulse = this.wait();
    this.events.emit('ambiencePulse', { kind: settings.kind });
  }

  private wait(): number {
    const [shortest, longest] = this.settings!.every;
    const scale = lerp(1, LAST_LEVEL_WAIT, this.difficulty);
    return this.rng.range(shortest * scale, longest * scale);
  }
}

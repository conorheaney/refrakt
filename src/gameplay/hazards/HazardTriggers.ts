import type { EventBus } from '../../engine/core/EventBus';
import type { GameEvents } from '../events';
import type { HazardCue, HazardCues, HazardSystem } from './hazards';

/**
 * Sets hazards off on cues from the rest of the game instead of their own timers, as the world asks
 * (`hazardCues`). It listens for the events that make each cue (an ambience pulse, `ambiencePulse`) and triggers
 * the hazards waiting on it, so whatever makes the cue never knows about hazards, and hazards never know what
 * made it. A new cue is one more entry in HAZARD_CUES (hazards.ts) and one more listener here.
 */
export class HazardTriggers {
  private cues: HazardCues = {};

  constructor(
    events: EventBus<GameEvents>,
    private readonly hazards: readonly HazardSystem[],
  ) {
    events.on('ambiencePulse', () => this.cue('pulse'));
  }

  /** A level loads with these cues (undefined: none). Call before the hazards load, so they know to wait. */
  load(cues: HazardCues | undefined): void {
    this.cues = cues ?? {};
    for (const hazard of this.hazards) if (hazard.cueable) hazard.cued = this.cues[hazard.cueable] !== undefined;
  }

  private cue(cue: HazardCue): void {
    for (const hazard of this.hazards) if (hazard.cueable && this.cues[hazard.cueable] === cue) hazard.trigger?.();
  }
}

import type { WeatherId } from '../content/worlds';

/**
 * What the view (GameView and its weather layers) tells the rest of the game, mostly the sound: what weather a
 * level has and what it is doing on screen. Emitted on GameView.events; AudioDirector listens.
 *
 * The per-frame events (snowFrame, dustFrame) reuse one payload object each, so a listener must read it during
 * the call and not keep it.
 */
export interface ViewEvents {
  /** A level loaded with this weather (undefined: clear). */
  weatherChanged: { weather: WeatherId | undefined };
  /** A lightning strike in a rainy world: its thunder arrives `delay` seconds later; `strength` 0-1. */
  thunder: { delay: number; strength: number };
  /** Every frame while it snows: the gust strength on screen (0-1), for the wind. */
  snowFrame: { realDt: number; simDt: number; gust: number };
  /** Every frame while tomb dust shows: for the room tone and torch crackles. */
  dustFrame: { realDt: number; simDt: number };
  /** The tomb is about to rumble (strength 0-1; timing as TombDustLayer.onRumble). */
  rumble: { strength: number; lead: number; rise: number; hold: number; fall: number };
  /** A wall torch flares: side -1 left, 1 right, 0 both; strength 0-1. */
  torchFlare: { side: -1 | 0 | 1; strength: number };
}

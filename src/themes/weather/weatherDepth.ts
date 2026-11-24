/**
 * Where weather particles (rain, snow, tomb dust) sit in depth, shared so every world's weather is layered
 * the same way: about half drift in front of the bricks, so the weather reads as the air in the room
 * between the player and the play area, and the rest pass behind them for depth (hidden where a brick is
 * in the way). Nothing is placed right in the brick layer (z = 0, half-depth 0.44), where it would clip
 * through bricks.
 */

/** Share of particles in front of the bricks. */
export const IN_FRONT = 0.5;
/** Particles in front are this bright, so the ball always reads clearly through them. */
export const FRONT_FADE = 0.75;
/** Nearest a particle comes to the brick layer, either side. */
const CLEAR = 0.8;

/** A random depth between `min` (behind, negative) and `max` (in front, positive), clear of the bricks. */
export function weatherDepth(min: number, max: number): number {
  return Math.random() < IN_FRONT ? CLEAR + Math.random() * (max - CLEAR) : min + Math.random() * (-CLEAR - min);
}

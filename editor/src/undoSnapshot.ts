import type { AuthoredWorld } from '../../src/content/authoredWorlds';

/** Undo steps kept; the oldest is dropped beyond this. A snapshot without its image is a few kilobytes. */
export const UNDO_LIMIT = 100;

/**
 * A copy of the world for the undo history. Everything is copied except the background image, which is
 * shared: it is an immutable string of up to 1.2 MB, and copying it into every step made 100 steps cost about
 * 120 MB. Undoing an upload or a removal still works, since each snapshot keeps the image it had.
 */
export function undoSnapshot(world: AuthoredWorld): AuthoredWorld {
  const { backgroundImage, ...rest } = world;
  const copy = structuredClone(rest) as AuthoredWorld;
  if (backgroundImage !== undefined) copy.backgroundImage = backgroundImage;
  return copy;
}

import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/content/authoredWorlds';
import { UNDO_LIMIT, undoSnapshot } from '../editor/src/undoSnapshot';

const IMAGE = 'data:image/jpeg;base64,' + 'A'.repeat(1_200_000);
/** Node's heap usage (the tests run in Node; its types aren't part of this project's setup). */
const heapUsed = (): number =>
  (globalThis as unknown as { process: { memoryUsage(): { heapUsed: number } } }).process.memoryUsage().heapUsed;

describe('editor undo snapshots', () => {
  it('copy the world but share its background image', () => {
    const world = createWorld('undo');
    world.backgroundImage = IMAGE;
    const copy = undoSnapshot(world);
    expect(copy).toEqual(world);
    expect(copy.backgroundImage).toBe(world.backgroundImage);
    // Everything else is a real copy: editing the world later doesn't change the snapshot.
    expect(copy.levels).not.toBe(world.levels);
    world.levels[0] = { ...world.levels[0], name: 'CHANGED' };
    expect(copy.levels[0].name).toBe('LEVEL 1');
  });

  it('keep each step the image it had, so undoing an upload or a removal restores it', () => {
    const world = createWorld('undo');
    const before = undoSnapshot(world); // no image yet
    world.backgroundImage = IMAGE;
    const withImage = undoSnapshot(world);
    delete world.backgroundImage;
    expect(before.backgroundImage).toBeUndefined();
    expect(withImage.backgroundImage).toBe(IMAGE);
  });

  it(`keep ${UNDO_LIMIT} steps of a world with a large background to about one image's worth of memory`, () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    const world = createWorld('undo');
    world.backgroundImage = IMAGE;
    gc?.();
    const start = heapUsed();
    const history = Array.from({ length: UNDO_LIMIT }, () => undoSnapshot(world));
    gc?.();
    const used = heapUsed() - start;
    expect(history).toHaveLength(UNDO_LIMIT);
    // Copying the image into every step took ~120 MB; shared, the steps take well under 10 MB.
    expect(used).toBeLessThan(10_000_000);
  });
});

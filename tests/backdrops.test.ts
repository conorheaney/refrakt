import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { BackdropCache } from '../src/app/backdrops';

/** A cache over worlds 0 and 1 (world 2 has no background), whose loads the test settles by hand. */
function harness() {
  const loads: { url: string; resolve: (t: THREE.Texture) => void; reject: (e: Error) => void }[] = [];
  const urls = ['zero.png', 'one.png', undefined];
  const cache = new BackdropCache(
    (i) => urls[i],
    (url) => new Promise((resolve, reject) => loads.push({ url, resolve, reject })),
  );
  const texture = () => {
    const t = new THREE.Texture();
    return Object.assign(t, { freed: vi.spyOn(t, 'dispose') });
  };
  return { cache, loads, texture };
}

it("loads a world's background when it is first shown, once, and keeps it while the world stays", async () => {
  const { cache, loads, texture } = harness();
  const pending = cache.get(0);
  expect(pending).toBeInstanceOf(Promise);
  expect(cache.get(0)).toBe(pending); // a second level of the same world while it decodes
  const t = texture();
  loads[0].resolve(t);
  expect(await pending).toBe(t);
  expect(cache.get(0)).toBe(t);
  expect(loads.map((l) => l.url)).toEqual(['zero.png']);
});

it('frees the last world’s texture on moving on, and loads it afresh on coming back', async () => {
  const { cache, loads, texture } = harness();
  const zero = texture();
  const pending = cache.get(0);
  loads[0].resolve(zero);
  await pending;
  expect(cache.get(2)).toBeNull(); // no background: built-in scenery
  expect(zero.freed).toHaveBeenCalled();
  expect(cache.get(0)).toBeInstanceOf(Promise);
  expect(loads.map((l) => l.url)).toEqual(['zero.png', 'zero.png']);
});

it('drops a background that finishes decoding after the player has moved on', async () => {
  const { cache, loads, texture } = harness();
  const stale = cache.get(0);
  void cache.get(1);
  const late = texture();
  loads[0].resolve(late);
  expect(await stale).toBeNull();
  expect(late.freed).toHaveBeenCalled();
});

it('falls back to the built-in scenery when a background fails to load', async () => {
  const { cache, loads } = harness();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const pending = cache.get(1);
  loads[0].reject(new Error('bad image'));
  expect(await pending).toBeNull();
  expect(cache.get(1)).toBeNull();
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

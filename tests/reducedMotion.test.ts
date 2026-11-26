import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('asks the browser once, and follows the setting when it changes mid-game', async () => {
  const list = { matches: false };
  const matchMedia = vi.fn(() => list);
  vi.stubGlobal('matchMedia', matchMedia);
  const { reducedMotion } = await import('../src/engine/reducedMotion');
  expect(reducedMotion()).toBe(false);
  list.matches = true; // the player turns on "reduce motion"
  expect(reducedMotion()).toBe(true);
  expect(matchMedia).toHaveBeenCalledTimes(1);
  expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
});

it('assumes full motion where the browser cannot say', async () => {
  vi.stubGlobal('matchMedia', undefined);
  const { reducedMotion } = await import('../src/engine/reducedMotion');
  expect(reducedMotion()).toBe(false);
});

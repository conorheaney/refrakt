import { describe, expect, it } from 'vitest';
import { ResolutionGovernor } from '../src/engine/render/ResolutionGovernor';

/** Feeds `count` whole measuring windows at `fps`; returns the scale after each change. */
function windows(governor: ResolutionGovernor, fps: number, count: number): number[] {
  const perWindow = Math.round(ResolutionGovernor.WINDOW * fps);
  // A hair over WINDOW / perWindow, so each window closes on exactly its last frame.
  const dt = ResolutionGovernor.WINDOW / perWindow + 1e-9;
  const changes: number[] = [];
  for (let i = 0; i < count * perWindow; i++) if (governor.frame(dt)) changes.push(governor.scale);
  return changes;
}

describe('ResolutionGovernor', () => {
  it('keeps full resolution at a steady frame rate, including a 50 Hz display', () => {
    const governor = new ResolutionGovernor();
    expect(windows(governor, 60, 40)).toEqual([]);
    expect(windows(governor, 50, 40)).toEqual([]);
    expect(governor.scale).toBe(1);
  });

  it('steps down only after a sustained slowdown (3 windows), to no lower than 0.55', () => {
    const governor = new ResolutionGovernor();
    expect(windows(governor, 30, 2)).toEqual([]);
    expect(windows(governor, 30, 10)).toEqual([0.85, 0.7, 0.55]);
    expect(governor.scale).toBe(0.55);
  });

  it('ignores hitches and tab switches', () => {
    const governor = new ResolutionGovernor();
    for (let i = 0; i < 200; i++) expect(governor.frame(0.5)).toBe(false);
    expect(governor.scale).toBe(1);
  });

  it('steps back up when the frame rate recovers (4 fast windows a step)', () => {
    const governor = new ResolutionGovernor();
    expect(windows(governor, 30, 6)).toEqual([0.85, 0.7]);
    expect(windows(governor, 60, 3)).toEqual([]);
    expect(windows(governor, 60, 5)).toEqual([0.85, 1]);
    expect(windows(governor, 60, 20)).toEqual([]); // already at full resolution
  });

  it('stops stepping up when a step up is soon followed by a drop (no flip-flopping)', () => {
    const governor = new ResolutionGovernor();
    expect(windows(governor, 30, 3)).toEqual([0.85]);
    expect(windows(governor, 60, 4)).toEqual([1]);
    expect(windows(governor, 30, 3)).toEqual([0.85]); // straight back down, within 30 s of the raise
    expect(windows(governor, 60, 40)).toEqual([]); // so it stays down
    governor.reset(); // a quality change starts afresh
    expect(governor.scale).toBe(1);
    expect(windows(governor, 30, 3)).toEqual([0.85]);
    expect(windows(governor, 60, 4)).toEqual([1]);
  });

  it('keeps stepping up after a drop that comes long after the last raise', () => {
    const governor = new ResolutionGovernor();
    windows(governor, 30, 3); // 0.85
    windows(governor, 60, 4); // back to 1
    windows(governor, 60, 30); // 45 s of smooth play
    expect(windows(governor, 30, 3)).toEqual([0.85]);
    expect(windows(governor, 60, 4)).toEqual([1]);
  });
});

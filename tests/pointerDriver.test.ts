import { describe, expect, it } from 'vitest';
import { PADDLE } from '../src/gameplay/config';
import { POINTER_OFFSET_WEAR, PointerDriver } from '../src/gameplay/PointerDriver';
import type { Paddle } from '../src/gameplay/types';

const STEP = 1 / 120;

function paddle(x: number): Paddle {
  return {
    x,
    px: x,
    y: PADDLE.y,
    width: PADDLE.width,
    vx: 0,
    shove: 0,
    tilt: 0,
    slide: 0,
    lean: 0,
    hitTime: -10,
  };
}

/** One frame of exactly one step: sample, then the step's target. */
function frame(driver: PointerDriver, pointerX: number | null, paddleX: number, frozen = false): number | null {
  driver.sample(pointerX, paddleX, frozen);
  driver.beginFrame(STEP, 0);
  return driver.target(STEP);
}

describe('PointerDriver', () => {
  it('aims at the pointer, spread across the steps of a frame', () => {
    const driver = new PointerDriver();
    expect(frame(driver, 2, 0)).toBe(2);
    // A frame of two steps from 2 to 6: halfway, then all the way.
    driver.sample(6, 2, false);
    driver.beginFrame(2 * STEP, 0);
    expect(driver.target(STEP)).toBeCloseTo(4, 9);
    expect(driver.target(STEP)).toBeCloseTo(6, 9);
    // No pointer: no target, and nothing remembered.
    expect(frame(driver, null, 6)).toBeNull();
  });

  it('keeps a pushed paddle where it was pushed, and wears the offset off as the pointer moves', () => {
    const driver = new PointerDriver();
    const p = paddle(0);
    frame(driver, 0, 0);
    // A snake's shove moves the paddle 3 units left during a step.
    p.shove = -3;
    driver.beforeStep(p);
    p.x = -3;
    p.shove = 0;
    driver.afterStep(p);
    // The cursor hasn't moved, but the target follows the paddle.
    expect(frame(driver, 0, -3)).toBeCloseTo(-3, 9);
    // Moving the pointer 2 units wears off 2 * POINTER_OFFSET_WEAR of the offset.
    expect(frame(driver, 2, -3)).toBeCloseTo(2 - (3 - 2 * POINTER_OFFSET_WEAR), 9);
    // A lost life lines paddle and pointer up again.
    driver.clearOffset();
    expect(frame(driver, 2, -3)).toBe(2);
  });

  it('only carries movement during a push into the offset, not ordinary steering', () => {
    const driver = new PointerDriver();
    const p = paddle(0);
    frame(driver, 5, 0);
    driver.beforeStep(p);
    p.x = 0.6; // the paddle chases the pointer: no push
    driver.afterStep(p);
    expect(frame(driver, 5, 0.6)).toBe(5);
    // An icicle's slide being consumed is a push.
    p.slide = -2;
    driver.beforeStep(p);
    p.slide = -1.5;
    p.x = 0.1;
    driver.afterStep(p);
    expect(frame(driver, 5, 0.1)).toBeCloseTo(4.5, 9);
  });

  it('holds the paddle during a freeze, then lets the cursor take over gradually', () => {
    const driver = new PointerDriver();
    frame(driver, 0, 0);
    // The cursor moves to 4 while a hit-stop holds play: the target stays on the paddle.
    expect(frame(driver, 4, 0, true)).toBeCloseTo(0, 9);
    // After it, the difference wears off with pointer movement rather than jumping to the cursor.
    const after = frame(driver, 5, 0) as number;
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(5);
  });

  it('forgets everything on reset (a new run, a confirmed loadout)', () => {
    const driver = new PointerDriver();
    const p = paddle(0);
    frame(driver, 0, 0);
    p.shove = -3;
    driver.beforeStep(p);
    p.x = -3;
    driver.afterStep(p);
    driver.reset();
    // No history: the first sample aims straight at the pointer, with no offset.
    expect(frame(driver, 1, -3)).toBe(1);
  });
});

import { lerp } from '../engine/core/math';
import { stepFraction } from '../engine/core/Time';
import type { Paddle } from './types';

/** Field units of push offset worn away per field unit the pointer moves. */
export const POINTER_OFFSET_WEAR = 0.5;

/**
 * Turns a pointer (mouse or touch) into the paddle's target for each fixed step. The game samples the pointer
 * once per display frame, but a frame runs a varying number of steps:
 *
 * - Each step gets the pointer position at that step's own time within the frame (interpolated between this
 *   frame's sample and the last), so the paddle moves evenly in simulation time and its interpolated render
 *   is smooth, instead of jumping to the target on the first step of some frames and lagging on others.
 * - A page can't move the real cursor, so when a snake's shove or an icicle's push moves the paddle, that
 *   movement is kept as an offset added to the pointer: the paddle stays where it was pushed instead of
 *   snapping back to a resting cursor. Pointer movement wears the offset away (POINTER_OFFSET_WEAR) until
 *   paddle and cursor line up again.
 * - During a hit-stop the paddle holds still while the cursor keeps moving: the target stays on the paddle,
 *   and the difference wears off with pointer movement afterwards instead of the paddle lurching to the cursor.
 *
 * The keyboard and the autopilot drive the paddle directly (see Game), not through this.
 */
export class PointerDriver {
  /** Pointer target (field X) at the previous and current display frame. */
  private from: number | null = null;
  private to: number | null = null;
  /** Field units added to the pointer's position (see above). */
  private offset = 0;
  private lastPointer: number | null = null;
  /** This frame's simulation time, the stepper's carried-over time, and steps run so far this frame. */
  private frameSimDt = 0;
  private frameCarry = 0;
  private frameStep = 0;
  /** The paddle just before the current step (see beforeStep). */
  private before = 0;
  private shoving = false;
  private slide = 0;

  /**
   * Once per display frame: where the pointer is (field X, or null with no pointer), where the paddle is, and
   * whether a hit-stop is holding play still.
   */
  sample(pointerX: number | null, paddleX: number, frozen: boolean): void {
    if (pointerX === null) this.offset = 0;
    else if (frozen) {
      this.offset = paddleX - pointerX;
    } else if (this.offset !== 0 && this.lastPointer !== null) {
      const left = Math.abs(this.offset) - Math.abs(pointerX - this.lastPointer) * POINTER_OFFSET_WEAR;
      this.offset = left > 0 ? Math.sign(this.offset) * left : 0;
    }
    this.lastPointer = pointerX;
    const target = pointerX === null ? null : pointerX + this.offset;
    this.from = target === null ? null : (this.to ?? target);
    this.to = target;
  }

  /** Once per frame, before its steps: the frame's simulation time and the stepper's carried-over time. */
  beginFrame(simDt: number, carry: number): void {
    this.frameSimDt = simDt;
    this.frameCarry = carry;
    this.frameStep = 0;
  }

  /** For each fixed step, in order: the paddle's target at that step's time within the frame (null: no pointer). */
  target(step: number): number | null {
    const f = stepFraction(this.frameStep, step, this.frameCarry, this.frameSimDt);
    this.frameStep++;
    return this.from !== null && this.to !== null ? lerp(this.from, this.to, f) : null;
  }

  /**
   * Around each step. While a shove or push plays out the pointer doesn't steer (World.updatePaddle), so every
   * bit the paddle moves is the push's, as far as the walls let it go: that is carried into the offset. (An
   * icicle's slide is consumed only while it pushes.)
   */
  beforeStep(paddle: Paddle): void {
    this.before = paddle.x;
    this.shoving = paddle.shove !== 0;
    this.slide = paddle.slide;
  }

  afterStep(paddle: Paddle): void {
    if (this.shoving || paddle.slide !== this.slide) this.offset += paddle.x - this.before;
  }

  /** The paddle and pointer line up again (a life was lost). */
  clearOffset(): void {
    this.offset = 0;
  }

  /** Forgets everything: a new run, or a confirmed loadout (the confirming click mustn't move the paddle). */
  reset(): void {
    this.from = this.to = null;
    this.offset = 0;
    this.lastPointer = null;
  }
}

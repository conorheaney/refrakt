import { damp } from './math';

/**
 * Accumulator-based fixed timestep. Rendering runs at display rate while the
 * simulation always advances in identical increments, which keeps physics
 * deterministic and independent of frame rate.
 */
export class FixedStepper {
  private accumulator = 0;

  constructor(
    readonly step: number,
    private readonly maxSteps: number,
  ) {}

  /** Runs as many fixed steps as `dt` allows; returns the interpolation alpha in [0, 1). */
  advance(dt: number, tick: (step: number) => void): number {
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= this.step) {
      if (steps === this.maxSteps) {
        // Spiral-of-death guard: drop the backlog instead of stalling.
        this.accumulator = 0;
        break;
      }
      tick(this.step);
      this.accumulator -= this.step;
      steps++;
    }
    return this.accumulator / this.step;
  }

  /** Unsimulated time carried over from previous frames (always < step after advance). */
  get pending(): number {
    return this.accumulator;
  }

  reset(): void {
    this.accumulator = 0;
  }
}

/**
 * Where the end of fixed step `index` (0-based, within one advance() call) falls inside that frame, as a
 * fraction 0..1 of the frame's simulated time. `carry` is the stepper's pending time before the frame.
 * Used to feed each step the per-frame input (e.g. the pointer) at the matching moment, so input-driven
 * motion is evenly spread across steps however many run in a given frame.
 */
export function stepFraction(index: number, step: number, carry: number, frameDt: number): number {
  if (frameDt <= 0) return 1;
  const f = ((index + 1) * step - carry) / frameDt;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/** Game-feel time warping: hit-stop freezes and smooth slow motion. */
export class TimeFx {
  private hitStopLeft = 0;
  private slowLeft = 0;
  private slowScale = 1;
  private current = 1;

  /** True while a hit-stop holds the simulation still. */
  get frozen(): boolean {
    return this.hitStopLeft > 0;
  }

  hitStop(seconds: number): void {
    this.hitStopLeft = Math.max(this.hitStopLeft, seconds);
  }

  slowMo(scale: number, seconds: number): void {
    this.slowScale = scale;
    this.slowLeft = seconds;
  }

  reset(): void {
    this.hitStopLeft = 0;
    this.slowLeft = 0;
    this.current = 1;
  }

  /** Converts real elapsed time into simulation time. */
  apply(realDt: number): number {
    if (this.hitStopLeft > 0) {
      this.hitStopLeft -= realDt;
      return 0;
    }
    let target = 1;
    if (this.slowLeft > 0) {
      this.slowLeft -= realDt;
      target = this.slowScale;
    }
    this.current = damp(this.current, target, 10, realDt);
    return realDt * this.current;
  }
}

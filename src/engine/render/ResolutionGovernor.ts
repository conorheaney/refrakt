/**
 * Adaptive resolution: watches the frame rate in 1.5 s windows and scales the internal resolution down when it
 * stays low, and back up when it recovers.
 *
 * - Down: 3 consecutive windows under 45 fps lower the scale by 0.15 (to at least 0.55). Each change
 *   reallocates every render target (a hitch and a visible blur change), so it must not fire on a 50 Hz
 *   display or a brief stall.
 * - Up: 4 consecutive windows at 57 fps or more raise it by 0.15 (to at most 1), so one bad stretch (a
 *   background hitch, battery saver, shader compiles on a world switch) no longer costs sharpness for the rest
 *   of the session.
 * - No flip-flopping: if a step up is followed by a step down within 30 s, the machine can't hold the higher
 *   scale, so it stops stepping up until reset.
 *
 * Frames of 0.1 s or more (a tab switch, a hitch) are ignored: they aren't representative.
 */
export class ResolutionGovernor {
  static readonly WINDOW = 1.5;
  static readonly SLOW_FPS = 45;
  static readonly FAST_FPS = 57;
  static readonly SLOW_WINDOWS = 3;
  static readonly FAST_WINDOWS = 4;
  static readonly STEP = 0.15;
  static readonly MIN = 0.55;
  static readonly MAX = 1;
  /** A drop this soon (seconds) after a raise stops further raises. */
  static readonly BACKOFF = 30;

  /** The current resolution scale, MIN to MAX. */
  scale: number = ResolutionGovernor.MAX;
  private frames = 0;
  private elapsed = 0;
  private slowWindows = 0;
  private fastWindows = 0;
  /** Seconds of counted frames so far, and when the last raise happened. */
  private clock = 0;
  private raisedAt = Number.NEGATIVE_INFINITY;
  private raising = true;

  /** Counts a frame of `realDt` seconds; returns true when the scale changed. */
  frame(realDt: number): boolean {
    if (realDt >= 0.1) return false;
    this.frames++;
    this.elapsed += realDt;
    this.clock += realDt;
    if (this.elapsed < ResolutionGovernor.WINDOW) return false;
    const fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;
    this.slowWindows = fps < ResolutionGovernor.SLOW_FPS ? this.slowWindows + 1 : 0;
    this.fastWindows = fps >= ResolutionGovernor.FAST_FPS ? this.fastWindows + 1 : 0;
    if (this.slowWindows >= ResolutionGovernor.SLOW_WINDOWS && this.scale > ResolutionGovernor.MIN) {
      if (this.clock - this.raisedAt < ResolutionGovernor.BACKOFF) this.raising = false;
      return this.setScale(this.scale - ResolutionGovernor.STEP);
    }
    if (this.raising && this.fastWindows >= ResolutionGovernor.FAST_WINDOWS && this.scale < ResolutionGovernor.MAX) {
      this.raisedAt = this.clock;
      return this.setScale(this.scale + ResolutionGovernor.STEP);
    }
    return false;
  }

  /** Back to full resolution with a clean slate (a quality change). */
  reset(): void {
    this.scale = ResolutionGovernor.MAX;
    this.frames = this.elapsed = this.slowWindows = this.fastWindows = 0;
    this.raisedAt = Number.NEGATIVE_INFINITY;
    this.raising = true;
  }

  private setScale(scale: number): boolean {
    // Rounded so repeated steps land exactly on 0.55, 0.7, 0.85 and 1.
    this.scale = Math.round(Math.min(ResolutionGovernor.MAX, Math.max(ResolutionGovernor.MIN, scale)) * 100) / 100;
    this.slowWindows = 0;
    this.fastWindows = 0;
    return true;
  }
}

import { PADDLE } from './config';
import { PointerDriver } from './PointerDriver';
import type { StepInput, World } from './World';

/** The player's controls, in field terms; read only while the player steers (a press stays queued otherwise). */
export interface PaddleControls {
  /** Keyboard axis in [-1, 1]. */
  readonly axis: number;
  /** The field X under the mouse or touch pointer, or null with no pointer on the play plane. */
  pointerX(): number | null;
  /** Takes a launch / release press made since it was last asked, if any. */
  consumeAction(): boolean;
}

/**
 * Who moves the paddle, and how: the one place that turns control into each fixed step's input (StepInput).
 *
 * - The player: the keyboard's axis, and the mouse or touch pointer through PointerDriver (which smooths the
 *   pointer across a frame's steps and keeps shoves and pushes from snapping back). A press launches or releases.
 * - The autopilot: in the menu's attract mode (World.demo) and under `?autopilot`, it tracks the most threatening
 *   ball with a little wobble; under `?autopilot` it also serves.
 *
 * Each display frame: frame(); then, for each of the frame's steps, input() before
 * World.step and afterStep() after it.
 */
export class PaddleDriver {
  private readonly stepInput: StepInput = { targetX: null, axis: 0, action: false };
  private readonly pointer = new PointerDriver();

  constructor(
    private readonly world: World,
    private readonly controls: PaddleControls,
    /** `?autopilot`: the autopilot plays every run too, not just the menu's demo. */
    private readonly autopilot: boolean,
  ) {}

  /** True while the player steers: not in the menu's attract mode or under ?autopilot. */
  get playerSteers(): boolean {
    return !this.world.demo && !this.autopilot;
  }

  /**
   * Once per display frame, before its steps (reading the player's controls if they steer): whether a hit-stop is
   * holding play still, and the frame's simulation time and the stepper's carried-over time.
   */
  frame(frozen: boolean, simDt: number, carry: number): void {
    if (this.playerSteers) {
      const controls = this.controls;
      this.stepInput.axis = controls.axis;
      this.pointer.sample(controls.pointerX(), this.world.paddle.x, frozen);
      if (controls.consumeAction()) this.stepInput.action = true;
    }
    this.pointer.beginFrame(simDt, carry);
  }

  /** For each fixed step, in order, just before World.step: that step's input. */
  input(step: number): StepInput {
    if (this.playerSteers) {
      this.stepInput.targetX = this.pointer.target(step);
      this.pointer.beforeStep(this.world.paddle);
    } else {
      this.driveAutopilot();
    }
    return this.stepInput;
  }

  /** Just after each World.step: a press counts for one step only. */
  afterStep(): void {
    if (this.playerSteers) this.pointer.afterStep(this.world.paddle);
    this.stepInput.action = false;
  }

  /** The paddle and pointer line up again (a life was lost). */
  lifeLost(): void {
    this.pointer.clearOffset();
  }

  /** Forgets the pointer and any pending press: a new run, or a confirmed loadout (its click mustn't launch). */
  reset(): void {
    this.stepInput.action = false;
    this.pointer.reset();
  }

  /** Track the most threatening ball with a little wobble. */
  private driveAutopilot(): void {
    const world = this.world;
    let target: number | null = null;
    let lowest = Infinity;
    for (const ball of world.balls.items) {
      if (!ball.active || ball.stuck) continue;
      const urgency = ball.dy < 0 ? ball.y : ball.y + 40;
      if (urgency < lowest) {
        lowest = urgency;
        target = ball.x;
      }
    }
    const input = this.stepInput;
    input.axis = 0;
    input.action = this.autopilot && !world.demo && world.balls.items.some((b) => b.active && b.stuck);
    // Wobble scales with the paddle so the autopilot still lands most balls on the narrower paddle.
    const wobble = PADDLE.width * 0.25;
    input.targetX = target === null ? Math.sin(world.time * 0.8) * 7 : target + Math.sin(world.time * 2.1) * wobble;
  }
}

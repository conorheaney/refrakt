import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FIELD, FOREST_ART, FOREST_FIELD, PADDLE, SIM } from '../src/gameplay/config';
import { lerp } from '../src/engine/core/math';
import { FixedStepper, stepFraction } from '../src/engine/core/Time';
import { CameraRig } from '../src/gameplay/CameraRig';
import { World, type StepInput } from '../src/gameplay/World';
import { CLASSIC } from './support/worlds';

/** Deterministic frame-time generator: a nominal refresh rate with +/- jitter, like real rAF timestamps. */
function frameTimes(hz: number, jitter: number, count: number): number[] {
  const out: number[] = [];
  let s = 12345;
  for (let i = 0; i < count; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out.push((1 / hz) * (1 + ((s / 0x7fffffff) * 2 - 1) * jitter));
  }
  return out;
}

/**
 * Mirrors Game.simulate/tick for pointer control: the pointer is sampled once per frame and each fixed
 * step gets the pointer position at its own time within the frame. Returns the rendered (interpolated)
 * paddle X after every frame.
 */
function renderPointerSweep(dts: number[], speed: number, startX: number): { xs: number[]; t: number[] } {
  const world = new World(CLASSIC);
  world.newGame(1);
  const stepper = new FixedStepper(SIM.step, SIM.maxStepsPerFrame);
  const input: StepInput = { targetX: startX, axis: 0, action: false };
  // Park the paddle at the start position first.
  for (let i = 0; i < 240; i++) world.step(SIM.step, input);
  let time = 0;
  let from: number | null = null;
  let to: number | null = null;
  const xs: number[] = [];
  const ts: number[] = [];
  for (const dt of dts) {
    time += dt;
    const target = startX + speed * time;
    from = to ?? target;
    to = target;
    const carry = stepper.pending;
    let k = 0;
    const alpha = stepper.advance(dt, (step) => {
      input.targetX = lerp(from as number, to as number, stepFraction(k++, step, carry, dt));
      world.step(step, input);
    });
    xs.push(lerp(world.paddle.px, world.paddle.x, alpha));
    ts.push(time);
  }
  return { xs, t: ts };
}

describe('paddle smoothness', () => {
  for (const [hz, jitter] of [
    [60, 0.06],
    [144, 0.08],
    [75, 0.04],
  ] as const) {
    it(`renders a steady pointer sweep at ${hz} Hz without stalls or jumps`, () => {
      const speed = 12; // field units per second, well under PADDLE.pointerSpeed
      const dts = frameTimes(hz, jitter, Math.round(hz * 1.5));
      const { xs } = renderPointerSweep(dts, speed, -10);
      for (let i = 10; i < xs.length; i++) {
        const v = (xs[i] - xs[i - 1]) / dts[i];
        // Monotonic, and the per-frame speed stays within 3% of the pointer's speed (frame-to-frame
        // stepping noise used to swing this between ~0x and ~2x).
        expect(xs[i]).toBeGreaterThan(xs[i - 1]);
        expect(Math.abs(v - speed) / speed).toBeLessThan(0.03);
      }
      expect(xs[xs.length - 1]).toBeLessThan(FIELD.halfWidth - PADDLE.width / 2 + 1e-6);
    });
  }
});

describe('paddle responsiveness at direction changes', () => {
  /** Mirrors Game's pointer path; returns rendered paddle X per frame for a pointer path target(t). */
  function render(dts: number[], target: (t: number) => number): number[] {
    const world = new World(CLASSIC);
    world.newGame(1);
    const stepper = new FixedStepper(SIM.step, SIM.maxStepsPerFrame);
    const input: StepInput = { targetX: target(0), axis: 0, action: false };
    for (let i = 0; i < 240; i++) world.step(SIM.step, input);
    let time = 0;
    let from: number | null = null;
    let to: number | null = null;
    const xs: number[] = [];
    for (const dt of dts) {
      time += dt;
      from = to ?? target(time);
      to = target(time);
      const carry = stepper.pending;
      let k = 0;
      const alpha = stepper.advance(dt, (step) => {
        input.targetX = lerp(from as number, to as number, stepFraction(k++, step, carry, dt));
        world.step(step, input);
      });
      xs.push(lerp(world.paddle.px, world.paddle.x, alpha));
    }
    return xs;
  }

  for (const hz of [60, 144]) {
    it(`a sharp mouse reversal moves the paddle back within one frame, without overshoot, at ${hz} Hz`, () => {
      const dts = frameTimes(hz, 0.06, hz);
      // Right at 15 u/s until 0.5 s, then straight back left at 15 u/s.
      const turn = 0.5;
      const target = (t: number): number => (t < turn ? -5 + 15 * t : -5 + 15 * turn - 15 * (t - turn));
      const xs = render(dts, target);
      let t = 0;
      let turnFrame = -1;
      for (let i = 0; i < dts.length; i++) {
        t += dts[i];
        if (turnFrame < 0 && t >= turn) turnFrame = i;
      }
      const peak = target(turn);
      for (const x of xs) expect(x).toBeLessThanOrEqual(peak + 1e-6); // never overshoots the pointer
      // Rendering interpolates one fixed step behind the sim, so the reversal may show up to one sim step
      // (8.3 ms) late; from then on the paddle moves left on every frame (no stall, no hesitation).
      const latencyFrames = Math.ceil(SIM.step * hz);
      for (let i = turnFrame + 1 + latencyFrames; i < xs.length; i++) expect(xs[i]).toBeLessThan(xs[i - 1]);
    });
  }

  it('a keyboard reversal changes direction on the very next step', () => {
    const world = new World(CLASSIC);
    world.newGame(1);
    const input: StepInput = { targetX: null, axis: 1, action: false };
    for (let i = 0; i < 30; i++) world.step(SIM.step, input);
    const before = world.paddle.x;
    input.axis = -1;
    world.step(SIM.step, input);
    expect(world.paddle.x).toBeLessThan(before);
    expect(before - world.paddle.x).toBeCloseTo(PADDLE.keySpeed * SIM.step, 6); // full speed at once, no ramp
  });
});

describe('ball smoothness', () => {
  it('rendered ball never moves further in a frame than its speed allows', () => {
    const world = new World(CLASSIC);
    world.newGame(3);
    const stepper = new FixedStepper(SIM.step, SIM.maxStepsPerFrame);
    const input: StepInput = { targetX: null, axis: 0, action: true };
    const dts = frameTimes(60, 0.06, 600);
    let prev: { x: number; y: number } | null = null;
    let steady = 0;
    let frames = 0;
    for (const dt of dts) {
      const alpha = stepper.advance(dt, (step) => {
        // Keep the paddle under the ball so it stays in play.
        const b = world.balls.items.find((ball) => ball.active);
        input.targetX = b ? b.x : 0;
        world.step(step, input);
        input.action = false;
      });
      const ball = world.balls.items.find((b) => b.active && !b.stuck);
      if (!ball || world.balls.activeCount !== 1) {
        prev = null;
        continue;
      }
      const x = lerp(ball.px, ball.x, alpha);
      const y = lerp(ball.py, ball.y, alpha);
      if (prev) {
        const d = Math.hypot(x - prev.x, y - prev.y);
        const max = world.ballSpeed * (dt + SIM.step) + 1e-6;
        expect(d).toBeLessThanOrEqual(max);
        frames++;
        if (Math.abs(d / (world.ballSpeed * dt) - 1) < 0.1) steady++;
      }
      prev = { x, y };
    }
    // Interpolation across a bounce shortens a frame's apparent move slightly; everything else is steady.
    expect(frames).toBeGreaterThan(300);
    expect(steady / frames).toBeGreaterThan(0.85);
  });
});

describe('pointer mapping', () => {
  it('does not drift with the camera glide, sway, paddle or ball', () => {
    const rig = new CameraRig();
    rig.setAspect(16 / 9);
    const before = [-0.6, -0.2, 0, 0.3, 0.7].map((x) => rig.pointerToFieldX(x, -0.7));
    rig.mode = 'play';
    rig.addTrauma(0.6);
    for (let i = 0; i < 120; i++) rig.update(1 / 60);
    const after = [-0.6, -0.2, 0, 0.3, 0.7].map((x) => rig.pointerToFieldX(x, -0.7));
    after.forEach((v, i) => expect(v).toBeCloseTo(before[i] as number, 9));
  });

  for (const aspect of [16 / 9, 16 / 10, 4 / 3]) {
    it(`puts the paddle under the pointer at aspect ${aspect.toFixed(2)}`, () => {
      const rig = new CameraRig();
      rig.setAspect(aspect);
      rig.mode = 'play';
      for (let i = 0; i < 600; i++) rig.update(1 / 60); // settle from the menu pose
      const ndc = new THREE.Vector3();
      for (const x of [-FIELD.halfWidth, -5, 0, 7.5, FIELD.halfWidth]) {
        rig.project(x, PADDLE.y, ndc);
        expect(Math.abs(ndc.x)).toBeLessThan(1); // the whole field width is on screen
        expect(rig.pointerToFieldX(ndc.x, ndc.y)).toBeCloseTo(x, 3);
      }
    });

    it(`frames the forest arena on the painted arch at aspect ${aspect.toFixed(2)}`, () => {
      const rig = new CameraRig();
      rig.setAspect(aspect);
      rig.setWorld('forest');
      rig.mode = 'play';
      rig.update(1 / 60);
      const ndc = new THREE.Vector3();
      // The painting fills the frame's height: px y = (1 - ndc.y) / 2 * heightPx, whatever the aspect.
      rig.project(0, FOREST_FIELD.top, ndc);
      expect(((1 - ndc.y) / 2) * FOREST_ART.heightPx).toBeCloseTo(FOREST_ART.ceilingPx, 3);
      // Horizontally it is centred, so the walls land on painting px 268 and 1404 (both on screen).
      const visiblePx = FOREST_ART.heightPx * aspect;
      for (const [x, px] of [
        [-FOREST_FIELD.halfWidth, 268],
        [FOREST_FIELD.halfWidth, 1404],
      ]) {
        rig.project(x, PADDLE.y, ndc);
        expect(Math.abs(ndc.x)).toBeLessThan(1);
        expect(FOREST_ART.widthPx / 2 + (ndc.x * visiblePx) / 2).toBeCloseTo(px, 3);
        expect(rig.pointerToFieldX(ndc.x, ndc.y)).toBeCloseTo(x, 3);
      }
    });
  }
});

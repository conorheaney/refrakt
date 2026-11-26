import { describe, expect, it } from 'vitest';
import { SIM } from '../src/gameplay/config';
import { PaddleDriver } from '../src/gameplay/PaddleDriver';
import { World } from '../src/gameplay/World';
import { CLASSIC } from './support/worlds';

/** A driver on a fresh run, with controls the test sets. */
function harness(autopilot = false) {
  const world = new World(CLASSIC);
  world.newGame(1);
  const controls = { axis: 0, pointer: null as number | null, presses: 0 };
  const driver = new PaddleDriver(
    world,
    {
      get axis() {
        return controls.axis;
      },
      pointerX: () => controls.pointer,
      consumeAction() {
        if (controls.presses === 0) return false;
        controls.presses--;
        return true;
      },
    },
    autopilot,
  );
  /** One display frame of two fixed steps; returns each step's input as it was given. */
  const frame = () => {
    driver.frame(false, SIM.step * 2, 0);
    const inputs = [];
    for (let i = 0; i < 2; i++) {
      inputs.push({ ...driver.input(SIM.step) });
      world.step(SIM.step, inputs[i]);
      driver.afterStep();
    }
    return inputs;
  };
  return { world, controls, driver, frame };
}

describe('PaddleDriver', () => {
  it('lets the player steer with the keyboard and the pointer', () => {
    const { controls, frame } = harness();
    controls.axis = 1;
    expect(frame()[0].axis).toBe(1);
    controls.axis = 0;
    controls.pointer = 5;
    frame();
    expect(frame()[1].targetX).toBeCloseTo(5);
  });

  it('counts a press for one step only', () => {
    const { controls, frame } = harness();
    controls.presses = 1;
    const [first, second] = frame();
    expect(first.action).toBe(true);
    expect(second.action).toBe(false);
    expect(controls.presses).toBe(0);
  });

  it("hands the paddle to the autopilot in the menu's demo, leaving the player's press queued", () => {
    const { world, controls, driver, frame } = harness();
    world.demo = true;
    controls.presses = 1;
    controls.axis = -1;
    const [input] = frame();
    expect(driver.playerSteers).toBe(false);
    expect(input.axis).toBe(0); // the keyboard is ignored
    expect(input.targetX).not.toBeNull(); // the autopilot aims
    expect(input.action).toBe(false); // the demo serves by itself
    expect(controls.presses).toBe(1); // not eaten by the demo
  });

  it('serves the ball itself under ?autopilot', () => {
    const { world, frame } = harness(true);
    expect(world.balls.items.some((b) => b.active && b.stuck)).toBe(true);
    expect(frame()[0].action).toBe(true);
  });

  it('forgets a pending press on reset (a confirming click must not launch)', () => {
    const { controls, driver } = harness();
    controls.presses = 1;
    driver.frame(false, SIM.step, 0);
    driver.reset();
    expect(driver.input(SIM.step).action).toBe(false);
  });
});

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Minimal DOM stand-ins so the real Input class can run under Node.
class FakeElement extends EventTarget {}
const g = globalThis as Record<string, unknown>;

type InputModule = typeof import('../src/engine/input/Input');
let mod: InputModule;
let input: InstanceType<InputModule['Input']>;
let win: EventTarget;

function key(type: 'keydown' | 'keyup', code: string, repeat = false): void {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, { code, repeat });
  win.dispatchEvent(e);
}

function move(x: number, y: number, extra: Record<string, unknown> = {}): void {
  const e = new Event('pointermove');
  Object.assign(e, { clientX: x, clientY: y, movementX: 0, movementY: 0, pointerType: 'mouse', ...extra });
  win.dispatchEvent(e);
}

beforeAll(async () => {
  g.HTMLInputElement = class extends FakeElement {};
  g.HTMLSelectElement = class extends FakeElement {};
  g.HTMLButtonElement = class extends FakeElement {};
  mod = await import('../src/engine/input/Input');
});

beforeEach(() => {
  win = new EventTarget();
  g.window = win;
  const canvas = Object.assign(new FakeElement(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 }),
  }) as unknown as HTMLCanvasElement;
  input = new mod.Input(canvas, { onGesture() {}, onPause() {}, onMute() {} });
});

describe('keyboard direction', () => {
  it('the most recently pressed direction wins while both are held', () => {
    key('keydown', 'ArrowLeft');
    expect(input.axis).toBe(-1);
    key('keydown', 'ArrowRight'); // rolled onto the other key before releasing the first
    expect(input.axis).toBe(1); // used to be 0: the paddle stopped dead
    key('keyup', 'ArrowLeft');
    expect(input.axis).toBe(1);
    key('keyup', 'ArrowRight');
    expect(input.axis).toBe(0);
  });

  it('falls back to the still-held key when the newer one is released', () => {
    key('keydown', 'KeyD');
    key('keydown', 'KeyA');
    expect(input.axis).toBe(-1);
    key('keyup', 'KeyA');
    expect(input.axis).toBe(1);
  });

  it('two keys for the same side: releasing one keeps moving', () => {
    key('keydown', 'KeyA');
    key('keydown', 'ArrowLeft');
    key('keyup', 'KeyA'); // used to clear the whole side
    expect(input.axis).toBe(-1);
  });

  it('auto-repeat does not reorder keys; blur and reset clear everything', () => {
    key('keydown', 'ArrowLeft');
    key('keydown', 'ArrowRight');
    key('keydown', 'ArrowLeft', true); // repeat of the older key
    expect(input.axis).toBe(1);
    win.dispatchEvent(new Event('blur'));
    expect(input.axis).toBe(0);
    key('keydown', 'ArrowRight');
    input.reset();
    expect(input.axis).toBe(0);
  });

  it('resolveAxis is order based', () => {
    expect(mod.resolveAxis([])).toBe(0);
    expect(mod.resolveAxis(['ArrowRight', 'KeyA'])).toBe(-1);
    expect(mod.resolveAxis(['KeyA', 'ArrowRight'])).toBe(1);
  });
});

describe('pointer ownership', () => {
  it('the first movement takes control immediately', () => {
    expect(input.pointerActive).toBe(false);
    move(400, 300);
    expect(input.pointerActive).toBe(true);
  });

  it('after a level start (reset), a small real movement takes control even when movementX/Y are 0', () => {
    move(400, 300);
    input.reset(); // confirming the loadout: cursor resting on the Start button
    expect(input.pointerActive).toBe(false);
    move(402, 301); // jitter: ignored
    expect(input.pointerActive).toBe(false);
    move(400 + mod.POINTER_TAKEOVER_PX + 2, 300); // real movement (movementX reported as 0)
    expect(input.pointerActive).toBe(true);
  });

  it('after keyboard use, moving the mouse hands control straight back', () => {
    move(400, 300);
    key('keydown', 'ArrowLeft');
    expect(input.pointerActive).toBe(false);
    key('keyup', 'ArrowLeft');
    move(400 + mod.POINTER_TAKEOVER_PX + 1, 300);
    expect(input.pointerActive).toBe(true);
  });

  it('touch and pen take control on any move', () => {
    move(400, 300);
    input.reset();
    move(400, 300, { pointerType: 'touch' });
    expect(input.pointerActive).toBe(true);
  });
});

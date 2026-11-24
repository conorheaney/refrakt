export interface InputCallbacks {
  /** Any first gesture; used to unlock audio. */
  onGesture(): void;
  onPause(): void;
  onMute(): void;
}

const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']);
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);
const ACTION_KEYS = new Set(['Space', 'Enter', 'ArrowUp', 'KeyW']);
/**
 * How far (CSS px) the pointer must be from where it rested when control left it before it takes
 * control back. Small: it only filters sensor jitter, so real mouse movement is never ignored.
 */
export const POINTER_TAKEOVER_PX = 6;

/**
 * Keyboard direction from the held direction keys, in press order: the most recently pressed key
 * wins, and releasing it falls back to whichever is still held. (Summing left and right used to give 0
 * while both were held, so the paddle stopped dead when the player rolled from one key to the other.)
 */
export function resolveAxis(held: readonly string[]): number {
  for (let i = held.length - 1; i >= 0; i--) {
    if (RIGHT_KEYS.has(held[i])) return 1;
    if (LEFT_KEYS.has(held[i])) return -1;
  }
  return 0;
}

/**
 * Unifies mouse, touch (via Pointer Events) and keyboard into a small polled
 * state: a pointer position in NDC, a keyboard axis and an edge-triggered
 * action. The most recently used device drives the paddle.
 */
export class Input {
  /** True when the pointer (rather than the keyboard) was used last. */
  pointerActive = false;

  /** Direction keys currently held, oldest first (codes, each at most once). */
  private readonly held: string[] = [];
  private actionQueued = false;
  /** Latest raw pointer position (CSS px, client space); converted to NDC only when sampled. */
  private clientX = 0;
  private clientY = 0;
  private hasPointer = false;
  /** Where the pointer rested when control last left it (null: any movement takes control). */
  private anchorX: number | null = null;
  private anchorY = 0;
  /** Cached canvas rect; refreshed on resize so pointermove never forces a layout. */
  private rectLeft = 0;
  private rectTop = 0;
  private rectWidth = 1;
  private rectHeight = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: InputCallbacks,
  ) {
    this.refreshBounds();
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerdown', this.onAnyGesture, { passive: true });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get axis(): number {
    return resolveAxis(this.held);
  }

  /** Returns true once per queued launch/release press. */
  consumeAction(): boolean {
    const queued = this.actionQueued;
    this.actionQueued = false;
    return queued;
  }

  /** Re-reads the canvas position and size. Call after any stage layout change. */
  refreshBounds(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.rectLeft = rect.left;
    this.rectTop = rect.top;
    this.rectWidth = rect.width;
    this.rectHeight = rect.height;
  }

  /** Pointer X in NDC ([-1, 1] across the canvas), computed from the latest event and current bounds. */
  get pointerX(): number {
    return ((this.clientX - this.rectLeft) / this.rectWidth) * 2 - 1;
  }

  /** Pointer Y in NDC (+1 at the top of the canvas). */
  get pointerY(): number {
    return this.hasPointer ? -(((this.clientY - this.rectTop) / this.rectHeight) * 2 - 1) : -0.8;
  }

  private setPointer(e: PointerEvent): void {
    this.clientX = e.clientX;
    this.clientY = e.clientY;
    this.hasPointer = true;
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    this.setPointer(e);
    if (this.pointerActive) return;
    // Take control as soon as the pointer has really moved from where it rested when control left it.
    // Measured from positions (not movementX/Y, which can be 0 or missing for some events), with only a
    // few px of slack for sensor jitter, so a mouse player is never ignored.
    if (
      this.anchorX === null ||
      e.pointerType === 'touch' ||
      e.pointerType === 'pen' ||
      Math.hypot(e.clientX - this.anchorX, e.clientY - this.anchorY) > POINTER_TAKEOVER_PX
    ) {
      this.pointerActive = true;
    }
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.setPointer(e);
    this.pointerActive = true;
    if (e.button === 0) this.actionQueued = true;
  };

  /**
   * Forgets held keys, queued launches and pointer ownership, e.g. after closing a menu, so the key or
   * click that closed it can't also launch the ball or yank the paddle to where the cursor was resting.
   * The pointer takes control again as soon as it moves (or on a click/touch on the canvas).
   */
  reset(): void {
    this.held.length = 0;
    this.actionQueued = false;
    this.releasePointer();
  }

  private releasePointer(): void {
    this.pointerActive = false;
    if (this.hasPointer) {
      this.anchorX = this.clientX;
      this.anchorY = this.clientY;
    } else {
      this.anchorX = null;
    }
  }

  private readonly onAnyGesture = (): void => {
    this.callbacks.onGesture();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.callbacks.onGesture();
    const target = e.target;
    // Form fields and links (e.g. the menu's World editor link) handle their own keys: Enter follows a link.
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;
    if (typeof HTMLAnchorElement !== 'undefined' && target instanceof HTMLAnchorElement) return;

    if (LEFT_KEYS.has(e.code) || RIGHT_KEYS.has(e.code)) {
      // Re-pressing a held key (or auto-repeat) keeps its place unless it isn't held yet.
      if (!this.held.includes(e.code)) this.held.push(e.code);
      this.releasePointer();
    } else if (ACTION_KEYS.has(e.code)) {
      if (!e.repeat && !(target instanceof HTMLButtonElement)) this.actionQueued = true;
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      if (!e.repeat) this.callbacks.onPause();
      return;
    } else if (e.code === 'KeyM') {
      if (!e.repeat) this.callbacks.onMute();
      return;
    } else {
      return;
    }
    if (!(target instanceof HTMLButtonElement)) e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const i = this.held.indexOf(e.code);
    if (i >= 0) this.held.splice(i, 1);
  };

  private readonly onBlur = (): void => {
    this.held.length = 0;
    this.actionQueued = false;
  };
}

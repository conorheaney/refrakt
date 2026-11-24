export interface State<K extends string> {
  enter?(previous: K | null): void;
  exit?(next: K): void;
  update?(dt: number): void;
}

/** Minimal finite state machine with explicit enter/exit hooks. */
export class StateMachine<K extends string> {
  private readonly states = new Map<K, State<K>>();
  private currentKey: K | null = null;

  register(key: K, state: State<K>): this {
    this.states.set(key, state);
    return this;
  }

  get current(): K | null {
    return this.currentKey;
  }

  is(key: K): boolean {
    return this.currentKey === key;
  }

  transition(key: K): void {
    const next = this.states.get(key);
    if (!next) throw new Error(`[StateMachine] unknown state "${key}"`);
    const previous = this.currentKey;
    if (previous !== null) this.states.get(previous)?.exit?.(key);
    this.currentKey = key;
    next.enter?.(previous);
  }

  update(dt: number): void {
    if (this.currentKey !== null) this.states.get(this.currentKey)?.update?.(dt);
  }
}

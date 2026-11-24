type Handler<P> = (payload: P) => void;

/**
 * Strongly typed synchronous event bus. A failing listener is isolated so one
 * broken subscriber (e.g. audio) can never take down the simulation.
 */
export class EventBus<E extends object> {
  private readonly handlers = new Map<keyof E, Handler<never>[]>();

  on<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    let list = this.handlers.get(type);
    if (!list) {
      list = [];
      this.handlers.set(type, list);
    }
    list.push(handler as Handler<never>);
    return () => this.off(type, handler);
  }

  off<K extends keyof E>(type: K, handler: Handler<E[K]>): void {
    const list = this.handlers.get(type);
    if (!list) return;
    const i = list.indexOf(handler as Handler<never>);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const list = this.handlers.get(type);
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      try {
        (list[i] as Handler<E[K]>)(payload);
      } catch (err) {
        console.error(`[EventBus] listener for "${String(type)}" failed`, err);
      }
    }
  }
}

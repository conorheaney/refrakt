export interface Poolable {
  active: boolean;
}

/**
 * Fixed-capacity object pool. Every object is allocated up front, so gameplay
 * never allocates or frees entities. Views mirror pools by index.
 */
export class Pool<T extends Poolable> {
  readonly items: readonly T[];
  private live = 0;

  constructor(capacity: number, factory: (index: number) => T) {
    const items: T[] = [];
    for (let i = 0; i < capacity; i++) {
      const item = factory(i);
      item.active = false;
      items.push(item);
    }
    this.items = items;
  }

  get capacity(): number {
    return this.items.length;
  }

  get activeCount(): number {
    return this.live;
  }

  /** Returns an inactive item marked active, or null when the pool is exhausted. */
  acquire(): T | null {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.active) {
        item.active = true;
        this.live++;
        return item;
      }
    }
    return null;
  }

  release(item: T): void {
    if (item.active) {
      item.active = false;
      this.live--;
    }
  }

  releaseAll(): void {
    const items = this.items;
    for (let i = 0; i < items.length; i++) items[i].active = false;
    this.live = 0;
  }
}

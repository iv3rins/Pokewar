export interface RoomLockAdapter {
  run<T>(roomId: string, task: () => Promise<T>): Promise<T>;
}

export class RoomLock implements RoomLockAdapter {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(roomId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(roomId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#tails.set(roomId, tail);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.#tails.get(roomId) === tail) this.#tails.delete(roomId);
    }
  }
}

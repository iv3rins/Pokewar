import { deadlineScore, type DeadlineTask } from './deadline.js';

export interface DeadlineStore {
  replaceRoom(roomId: string, tasks: readonly DeadlineTask[]): Promise<void>;
  claimDue(now: number, limit: number): Promise<readonly DeadlineTask[]>;
  remove(task: DeadlineTask): Promise<void>;
  close(): Promise<void>;
}

export class MemoryDeadlineStore implements DeadlineStore {
  readonly #tasks = new Map<string, DeadlineTask>();

  replaceRoom(roomId: string, tasks: readonly DeadlineTask[]): Promise<void> {
    for (const [id, task] of this.#tasks) {
      if (task.roomId === roomId) this.#tasks.delete(id);
    }
    for (const task of tasks) this.#tasks.set(task.id, task);
    return Promise.resolve();
  }

  claimDue(now: number, limit: number): Promise<readonly DeadlineTask[]> {
    return Promise.resolve(
      [...this.#tasks.values()]
        .filter((task) => task.dueAt < now)
        .sort((left, right) => deadlineScore(left) - deadlineScore(right))
        .slice(0, limit),
    );
  }

  remove(task: DeadlineTask): Promise<void> {
    this.#tasks.delete(task.id);
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.#tasks.clear();
    return Promise.resolve();
  }
}

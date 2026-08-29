export interface Pool {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createPool(concurrency: number): Pool {
  const limit = Math.max(1, concurrency | 0);
  let active = 0;
  const waiters: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (active < limit) {
      active++;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
    active++;
  }

  function release(): void {
    active--;
    waiters.shift()?.();
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}

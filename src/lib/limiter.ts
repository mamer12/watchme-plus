/** Runs at most `max` async tasks at once; the rest wait in order. */
export function limiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active -= 1;
    queue.shift()?.();
  };
  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        active += 1;
        task().then(resolve, reject).finally(next);
      };
      if (active < max) start();
      else queue.push(start);
    });
  };
}

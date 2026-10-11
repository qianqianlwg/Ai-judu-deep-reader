type Job<T> = { key: string; work(): Promise<T>; background: boolean; running: boolean; promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };

/** EPUB 解压队列：后台最多占三个槽，给临时跳章/翻页保留一个槽。 */
export function createEpubResourceQueue<T>(concurrency = 4) {
  if (!Number.isInteger(concurrency) || concurrency < 2) throw new Error('EPUB 并发数必须至少为 2');
  const jobs = new Map<string, Job<T>>(), pending: Job<T>[] = [];
  const idle: (() => void)[] = [];
  let active = 0, backgroundActive = 0, stopped: Error | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const notify = () => { if (!active && !pending.length) for (const resolve of idle.splice(0)) resolve(); };
  const defer = () => { if (!stopped && timer === undefined) timer = setTimeout(() => { timer = undefined; pump(); }, 0); };
  const pump = () => {
    if (stopped) { notify(); return; }
    while (active < concurrency) {
      let index = pending.findIndex(job => !job.background);
      if (index < 0 && backgroundActive < concurrency - 1) index = pending.findIndex(job => job.background);
      if (index < 0) break;
      const job = pending.splice(index, 1)[0];
      job.running = true; active++; if (job.background) backgroundActive++;
      // WHY：把同步抛错也纳入拒绝链，销毁后等待真正结束的解压任务再关闭 ZIP。
      void Promise.resolve().then(job.work).then(value => {
        if (stopped) job.reject(stopped); else job.resolve(value);
      }, job.reject).finally(() => {
        active--; if (job.background) backgroundActive--;
        if (pending.some(item => !item.background)) pump(); else defer();
        notify();
      });
    }
    notify();
  };
  return {
    run(key: string, work: () => Promise<T>, background = false): Promise<T> {
      if (stopped) return Promise.reject(stopped);
      const existing = jobs.get(key);
      if (existing) {
        // WHY：用户跳到后台待处理的章节时提升同一任务，不能重复解压/重复累加字节。
        if (!background && !existing.running) { existing.background = false; pump(); }
        return existing.promise;
      }
      let resolve!: (value: T) => void, reject!: (error: unknown) => void;
      const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
      const job = { key, work, background, running: false, promise, resolve, reject };
      jobs.set(key, job); pending.push(job);
      if (background) defer(); else pump();
      return promise;
    },
    stop(error = new Error('EPUB 已销毁')) {
      if (stopped) return;
      stopped = error;
      if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
      for (const job of pending.splice(0)) job.reject(error);
      jobs.clear(); notify();
    },
    drained(): Promise<void> { return active || pending.length ? new Promise(resolve => idle.push(resolve)) : Promise.resolve(); },
  };
}

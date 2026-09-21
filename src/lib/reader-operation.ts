/** WHY：超时是操作失败，不是“旧CFI无效”；保留类型和阶段供恢复逻辑区分。 */
export class ReaderOperationTimeout extends Error {
  readonly code = "READER_OPERATION_TIMEOUT";
  constructor(readonly phase: string) {
    super(`原版渲染超时（${phase}），请重试或切回精读。`);
    this.name = "ReaderOperationTimeout";
  }
}
export type ReaderOperationOptions = { signal: AbortSignal; phase: string; milliseconds?: number };

/** 不更换引擎/文档运输；取消等待时立即回收计时器，迟到的原Promise也有拒绝处理器。 */
export function runReaderOperation<T>(work: PromiseLike<T>, { signal, phase, milliseconds = 20000 }: ReaderOperationOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (result: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      result();
    };
    const fail = (cause: unknown) => finish(() => reject(cause));
    const abort = () => fail(signal.reason ?? new DOMException("阅读操作已取消", "AbortError"));
    const timer = signal.aborted ? undefined : setTimeout(() => fail(new ReaderOperationTimeout(phase)), milliseconds);
    // WHY：即使signal已取消也消费work的最终拒绝，避免旧view的迟到错误成为unhandledrejection。
    Promise.resolve(work).then(value => finish(() => resolve(value)), fail);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** WHY：iframe章节导航不是可重入操作；前一操作未结束时不能由目录/锚点/翻页另开一份。 */
export function createReaderOperationQueue(signal: AbortSignal) {
  let tail: Promise<unknown> = Promise.resolve();
  let timeout: ReaderOperationTimeout | null = null;
  return {
    run<T>(phase: string, work: () => Promise<T>): Promise<T> {
      const result = tail.then(() => {
        signal.throwIfAborted();
        if (timeout) throw timeout;
        return runReaderOperation(Promise.resolve().then(() => {
          signal.throwIfAborted();
          return work();
        }), { signal, phase }).catch((cause: unknown) => {
          // WHY：超时不等于底层工作停止；在调用方执行清理前也不得启动下一份排队导航。
          if (cause instanceof ReaderOperationTimeout) timeout = cause;
          throw cause;
        });
      });
      // 保留调用方可见的拒绝，同时允许被核验为过期锚点的普通错误由上层有意识恢复。
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

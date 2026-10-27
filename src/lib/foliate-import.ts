import { spawn } from 'node:child_process';
import path from 'node:path';
import nodeModule from 'node:module';
import { z } from 'zod';
export type ParsedNavigationItem = { label: string; href: string | null; children: ParsedNavigationItem[] };
const navigationSchema: z.ZodType<ParsedNavigationItem> = z.lazy(() => z.object({ label: z.string(), href: z.string().nullable(), children: z.array(navigationSchema) }));
const resultSchema = z.object({ title: z.string(), author: z.string(), sections: z.array(z.object({ id: z.string(), sourceHref: z.string(), html: z.string() })), navigation: z.array(navigationSchema) });
export type FoliateImportResult = z.infer<typeof resultSchema>;
export function resolveFoliateJsdomEntry(resolver?: { resolve(specifier: string): unknown }): string {
  // WHY：Webpack 会同时改写 createRequire 与 resolve 的直接调用；保留原生解析函数，传给独立进程的只能是真实磁盘路径。
  const createNativeRequire: unknown = Reflect.get(nodeModule, 'createRequire');
  if (typeof createNativeRequire !== 'function') throw new Error('EPUB worker 原生解析器不可用');
  const nativeResolver: unknown = resolver ?? Reflect.apply(createNativeRequire, undefined, [path.join(process.cwd(), 'package.json')]);
  if (!nativeResolver || (typeof nativeResolver !== 'function' && typeof nativeResolver !== 'object')) throw new Error('EPUB worker 原生解析器不可用');
  const nativeResolve: unknown = Reflect.get(nativeResolver, 'resolve');
  if (typeof nativeResolve !== 'function') throw new Error('EPUB worker 原生解析器不可用');
  const entry: unknown = Reflect.apply(nativeResolve, nativeResolver, ['jsdom']);
  if (typeof entry !== 'string' || !path.isAbsolute(entry)) throw new Error('EPUB worker 的 jsdom 入口不是绝对文件路径');
  return entry;
}
export async function parseWithFoliate(bytes: Buffer): Promise<FoliateImportResult> {
  return new Promise((resolve, reject) => {
    // WHY：父进程只传真实依赖入口；发布装配器显式携带 jsdom/jszip 闭包，DOM 仍只在隔离进程中创建。
    const jsdomEntry = resolveFoliateJsdomEntry();
    const worker = spawn(process.execPath, ['--max-old-space-size=512', path.join(process.cwd(), 'scripts/epub/foliate-import-worker.mjs'), jsdomEntry], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const chunks: Buffer[] = [];
    let outputSize = 0, diagnostics = '', settled = false;
    let inputError: Error | undefined;
    const finish = (error?: Error, value?: FoliateImportResult) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { worker.kill(); reject(error); } else if (value) resolve(value);
    };
    // WHY：输入已做有界ZIP预检，独立进程再限制内存、时间和协议输出，解析失败不能留下后台任务或伪造成功。
    const timer = setTimeout(() => finish(new Error('Foliate EPUB 解析超时，请检查书籍后重试')), 30_000);
    worker.on('error', cause => finish(new Error('Foliate EPUB 解析进程启动失败', { cause })));
    // WHY：提前退出常伴随EPIPE，等待close才能连同stderr报告真正原因，不让IO错误覆盖引擎诊断。
    worker.stdin.on('error', cause => { inputError = cause; });
    worker.stdout.on('data', (chunk: Buffer) => {
      outputSize += chunk.length;
      if (outputSize > 128 * 1024 * 1024) { finish(new Error('Foliate EPUB 解析结果超过128 MiB')); return; }
      chunks.push(chunk);
    });
    worker.stderr.on('data', (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString('utf8')).slice(-12_000); });
    worker.on('close', code => {
      if (settled) return;
      if (code !== 0) { finish(new Error('Foliate EPUB 解析失败：' + diagnostics, { cause: inputError })); return; }
      if (inputError) { finish(new Error('Foliate EPUB 解析输入失败', { cause: inputError })); return; }
      try {
        const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const parsed = resultSchema.parse(payload);
        // WHY：协议边界限制目录深度，避免异常递归树进入UI；标题和导航文字仍全部来自上游引擎。
        const check = (items: ParsedNavigationItem[], depth: number): void => {
          if (depth > 32) throw new Error('EPUB 目录层级超过32层');
          for (const item of items) check(item.children, depth + 1);
        };
        check(parsed.navigation, 0);
        if(diagnostics.trim())console.warn('Foliate解析诊断',diagnostics);
        finish(undefined, parsed);
      } catch (cause: unknown) { finish(new Error('Foliate EPUB 解析结果不符合协议', { cause })); }
    });
    worker.stdin.end(bytes);
  });
}

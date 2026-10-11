import { describe, expect, it, vi } from 'vitest';
import { createEpubResourceQueue } from './epub-resource-queue';
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(yes=>{resolve=yes;}); return {promise,resolve}; }
const flush = async () => { for(let i=0;i<8;i++)await Promise.resolve(); };
describe('EPUB resource priority queue',()=>{
  it('bounds background concurrency, reserves a foreground slot and reuses a pending read',async()=>{
    vi.useFakeTimers();
    try {
      const queue=createEpubResourceQueue<number>(), gates=Array.from({length:6},()=>deferred<number>());
      const started:number[]=[];
      const reads=gates.map((gate,i)=>queue.run(String(i),async()=>{started.push(i);return gate.promise;},true));
      await vi.advanceTimersByTimeAsync(0);expect(started).toEqual([0,1,2]);
      const promoted=queue.run('5',async()=>99);expect(promoted).toBe(reads[5]);
      await flush();expect(started).toEqual([0,1,2,5]);
      gates.forEach((gate,i)=>gate.resolve(i));await vi.runAllTimersAsync();
      expect(await Promise.all(reads)).toEqual([0,1,2,3,4,5]);await queue.drained();
    } finally { vi.useRealTimers(); }
  });
  it('stops pending jobs but does not report drained before an active read finishes',async()=>{
    const queue=createEpubResourceQueue<number>(2),gate=deferred<number>(),unused=vi.fn(async()=>2);
    const active=queue.run('active',()=>gate.promise),pending=queue.run('pending',unused,true);
    const failures=Promise.all([expect(active).rejects.toThrow('已销毁'),expect(pending).rejects.toThrow('已销毁')]);
    await flush();queue.stop();let drained=false;void queue.drained().then(()=>{drained=true;});
    await flush();expect(drained).toBe(false);expect(unused).not.toHaveBeenCalled();
    gate.resolve(1);await failures;await queue.drained();expect(drained).toBe(true);
    await expect(queue.run('new',async()=>3)).rejects.toThrow('已销毁');
  });
  it('propagates synchronous failures without leaving a slot occupied',async()=>{
    const queue=createEpubResourceQueue<number>(2);
    await expect(queue.run('bad',()=>{throw new Error('CRC failed');})).rejects.toThrow('CRC failed');
    expect(await queue.run('good',async()=>1)).toBe(1);await queue.drained();
  });
});

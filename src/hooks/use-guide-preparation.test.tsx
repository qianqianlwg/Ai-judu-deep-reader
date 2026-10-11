// @vitest-environment jsdom
import { act,useEffect } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { useGuidePreparation,type GuidePreparationScope } from './use-guide-preparation';
import type { GuidePreparation } from '@/lib/guide-preparation';
let root:Root,host:HTMLDivElement,latest:ReturnType<typeof useGuidePreparation>;
const fetcher=vi.fn<typeof fetch>(),scope={threadId:'t',editionId:'e',messageId:'m'};
const state=(status:GuidePreparation['status'],messageId='m'):GuidePreparation=>({messageId,status,total:2,completed:status==='completed'?2:0,failed:status==='failed'?2:0,error:status==='failed'?'模型暂不可用':null});
function Harness({value=scope}:{value?:GuidePreparationScope}){const result=useGuidePreparation(value);useEffect(()=>{latest=result;},[result]);return <span>{result.state?.status??result.error??'loading'}</span>;}
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',fetcher);vi.spyOn(document,'hidden','get').mockReturnValue(false);vi.useFakeTimers();fetcher.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
it('真实状态轮询到完成即停止，卡片不制造模型百分比',async()=>{fetcher.mockResolvedValueOnce(Response.json(state('pending'))).mockResolvedValueOnce(Response.json(state('processing'))).mockResolvedValueOnce(Response.json(state('completed')));await act(async()=>root.render(<Harness/>));expect(latest.state?.status).toBe('pending');await act(async()=>vi.advanceTimersByTimeAsync(1800));expect(latest.state?.status).toBe('processing');await act(async()=>vi.advanceTimersByTimeAsync(1800));expect(latest.state?.status).toBe('completed');await act(async()=>vi.advanceTimersByTimeAsync(10000));expect(fetcher).toHaveBeenCalledTimes(3);});
it('失败重试只请求本次状态接口，返回排队后继续轮询',async()=>{fetcher.mockResolvedValueOnce(Response.json(state('failed'))).mockResolvedValueOnce(Response.json(state('pending'))).mockResolvedValueOnce(Response.json(state('completed')));await act(async()=>root.render(<Harness/>));await act(async()=>latest.retry());expect(fetcher.mock.calls[1][1]?.method).toBe('POST');expect(latest.state?.status).toBe('completed');});
it('切换句读时旧响应不能覆盖新状态，旧请求会取消',async()=>{let resolve:(r:Response)=>void=()=>{};fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValueOnce(Response.json(state('completed','new')));await act(async()=>root.render(<Harness/>));await act(async()=>root.render(<Harness value={{...scope,messageId:'new'}}/>));await act(async()=>resolve(Response.json(state('pending'))));expect(latest.state?.messageId).toBe('new');expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);});
it('状态读取失败明确展示可恢复错误，不把失败显示为已整理',async()=>{vi.spyOn(console,'error').mockImplementation(()=>{});fetcher.mockRejectedValueOnce(new Error('连接失败'));await act(async()=>root.render(<Harness/>));expect(latest.state).toBeNull();expect(latest.error).toBe('连接失败');});

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach,it,expect,vi } from 'vitest';
import type { GuidePreparation } from '@/lib/guide-preparation';
const fixture=vi.hoisted(()=>({state:null as GuidePreparation|null,error:'',busy:false,retry:vi.fn(),refresh:vi.fn()}));
vi.mock('@/hooks/use-guide-preparation',()=>({useGuidePreparation:()=>fixture}));
import { GuidePreparationStatus } from './guide-preparation-status';
const scope={threadId:'t',editionId:'e',messageId:'m'};
const set=(status:GuidePreparation['status'])=>{fixture.state={messageId:'m',status,total:2,completed:status==='completed'?2:0,failed:status==='failed'?2:0,error:status==='failed'?'模型暂不可用':null};};
afterEach(()=>{fixture.state=null;fixture.error='';vi.clearAllMocks();vi.unstubAllGlobals();});
it('处理中展示扫光状态，完成移除扫光且提供跳转入口',()=>{set('processing');const working=renderToStaticMarkup(<GuidePreparationStatus scope={scope}/>);expect(working).toContain('正在整理本次句读思维导图');expect(working).toContain('working');expect(working).not.toContain('%');set('completed');const done=renderToStaticMarkup(<GuidePreparationStatus scope={scope} onOpenGuide={()=>{}}/>);expect(done).toContain('思维导图已整理');expect(done).toContain('转到思维导图');expect(done).not.toContain('working');expect(done).not.toContain('<section');expect(done).not.toContain('<p');expect(done).not.toContain('<strong');});
it('失败反馈和重试入口保留，不伪装为生成成功',()=>{set('failed');const html=renderToStaticMarkup(<GuidePreparationStatus scope={scope}/>);expect(html).toContain('未完成');expect(html).toContain('模型暂不可用');expect(html).toContain('重新整理');expect(html).not.toContain('working');});
it('点击已完成状态行跳转，未关联来源不显示完成状态行',async()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);set('completed');const host=document.createElement('div'),root=createRoot(host),open=vi.fn();document.body.append(host);try{await act(async()=>root.render(<GuidePreparationStatus scope={scope} onOpenGuide={open}/>));await act(async()=>host.querySelector('button')!.click());expect(open).toHaveBeenCalledOnce();set('none');await act(async()=>root.render(<GuidePreparationStatus scope={scope}/>));expect(host.textContent).toBe('');}finally{await act(async()=>root.unmount());host.remove();}});

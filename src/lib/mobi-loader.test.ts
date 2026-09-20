// @vitest-environment jsdom
import {expect,it,vi,beforeEach} from 'vitest';
import {loadMobiPublication} from './mobi-loader';
import type {MobiPublication} from './mobi-publication-model';
const state=vi.hoisted(()=>({create:vi.fn()}));vi.mock('./mobi-render',()=>({createMobiFoliateBook:state.create}));
const model:MobiPublication={schema:'mobi-publication-v1',sourceHash:'a'.repeat(64),layoutHash:'b'.repeat(64),title:'书',authors:[],chapters:[{id:'mobi-v1/mobi/0',title:'章',html:'<p>文</p>',head:'',htmlHash:'c'.repeat(64)}],resources:[],navigation:[],toc:[],warnings:['提示']};
beforeEach(()=>{state.create.mockReset().mockResolvedValue({sections:[]});});
it('成功响应仅将当前来源的布局交给渲染器并传递提示',async()=>{expect(await loadMobiPublication(Response.json(model),model.sourceHash)).toEqual({book:{sections:[]},warnings:['提示']});expect(state.create).toHaveBeenCalledWith(model);});
it('空响应和错误JSON都有明确失败，不吞掉解析错误',async()=>{await expect(loadMobiPublication(new Response('',{headers:{'content-type':'application/json'}}),model.sourceHash)).rejects.toThrow('为空');await expect(loadMobiPublication(new Response('bad',{headers:{'content-type':'application/json'}}),model.sourceHash)).rejects.toThrow();expect(state.create).not.toHaveBeenCalled();});
it('失败HTTP、错误类型与错版本都不会建立blob',async()=>{await expect(loadMobiPublication(new Response('oops',{status:500}),model.sourceHash)).rejects.toThrow('读取失败');await expect(loadMobiPublication(new Response('{}'),model.sourceHash)).rejects.toThrow('格式');await expect(loadMobiPublication(Response.json(model),'b'.repeat(64))).rejects.toThrow('来源');expect(state.create).not.toHaveBeenCalled();});

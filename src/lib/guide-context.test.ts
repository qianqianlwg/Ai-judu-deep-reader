import { describe, expect, it } from 'vitest';
import type { GuideNode } from './guide';
import { guideReadSchema, latestGuideBranchId, projectGuideFramework, readGuideSnapshot, readBudgetedGuideSnapshot } from './guide-context';
import { estimateTextTokens } from './token-usage';
const node=(id:string,parentId:string|null,updated:number,summary='这是由Agent提供的完整真实摘要内容，不得本地替换。'):GuideNode=>({id,parentId,title:id,summary,sourceIds:['reading'],timeline:{created:updated,updated,createdAt:'t',updatedAt:'t'}});
const tree=[node('old',null,1),node('old-3','old',2),node('old-4','old-3',3),node('old-5','old-4',4),node('new',null,5),node('new-3','new',6),node('new-4','new-3',7),node('new-5','new-4',8)];
describe('导图按层级和真实时间投影',()=>{
 it('书名为一级，最新二级分支全部展开，其他分支只到三级',()=>{
  const projection=projectGuideFramework(tree);expect(projection.latestBranchId).toBe('new');
  expect(projection.nodes.map(n=>n.id)).toEqual(['new','new-3','new-4','new-5','old','old-3']);
  expect(projection.nodes.find(n=>n.id==='old-3')).toMatchObject({level:3,childCount:1,omittedChildren:1});
  expect(projection.omittedNodes).toBe(2);expect(projection.budgetLimited).toBe(false);
  expect(projection.nodes.every(n=>!('position' in n)&&!('timeline' in n))).toBe(true);
 });
 it('更新旧分支的深层内容会将其二级祖先作为最新分支，节点原字段不被修改',()=>{
  const changed=structuredClone(tree);changed[3].timeline!.updated=100;
  expect(latestGuideBranchId(changed)).toBe('old');expect(projectGuideFramework(changed).nodes.some(n=>n.id==='old-5')).toBe(true);
  expect(changed[3].summary).toBe(tree[3].summary);
 });
 it('超预算只省略真实字段并标记入口，不伪造摘要或静默截断',()=>{
  const large=[node('n',null,1,'整'.repeat(6000)),...Array.from({length:500},(_,i)=>node('c'+i,'n',i+2))];
  const projection=projectGuideFramework(large,800);
  expect(estimateTextTokens(JSON.stringify(projection))).toBeLessThanOrEqual(800);
  expect(projection.budgetLimited).toBe(true);expect(projection.omittedNodes).toBeGreaterThan(0);
  expect(projection.nodes.find(n=>n.id==='n')).toMatchObject({detailsIncluded:false});
  expect(projection.nodes.find(n=>n.id==='n')).not.toHaveProperty('summary');
  expect(large[0].summary).toHaveLength(6000);
 });
 it('没有图时返回空投影，断开的父节点或循环显式报错',()=>{
  expect(projectGuideFramework([])).toMatchObject({nodes:[],latestBranchId:null,totalNodes:0});
  expect(()=>projectGuideFramework([node('a','missing',1)])).toThrow('父节点');
  expect(()=>projectGuideFramework([node('a','b',1),node('b','a',2)])).toThrow('循环');
 });
});
describe('按需展开和详情分页',()=>{
 it('展开只返回直接子节点及继续读取游标，可逐级找到未注入节点',()=>{
  const page=readGuideSnapshot(tree,guideReadSchema.parse({action:'children',nodeId:null,limit:1}));
  expect(page).toMatchObject({nodes:[{id:'old',childCount:1}],nextOffset:1,total:2});
  const last=readGuideSnapshot(tree,guideReadSchema.parse({action:'children',nodeId:null,limit:1,offset:1}));expect(last).toMatchObject({nodes:[{id:'new'}],nextOffset:null});
  expect(readGuideSnapshot(tree,guideReadSchema.parse({action:'children',nodeId:'old-3'}))).toMatchObject({nodes:[{id:'old-4'}]});
 });
 it('大摘要和大量来源显式分页，Unicode字符不拆坏，完整读回与原文逐字一致',()=>{
  const original=node('a',null,1,'😀'.repeat(1200));original.sourceIds=Array.from({length:23},(_,i)=>'s'+i);
  const pages=[0,500,1000].map(summaryOffset=>readGuideSnapshot([original],guideReadSchema.parse({action:'details',nodeId:'a',summaryOffset})));
  const details=pages.filter(page=>page.action==='details');expect(details.map(page=>page.summary).join('')).toBe(original.summary);
  expect(details[0]).toMatchObject({summaryCharacters:1200,nextSummaryOffset:500,sourceCount:23,nextSourceOffset:10});
  expect(details[2].nextSummaryOffset).toBeNull();
  expect(readGuideSnapshot([original],guideReadSchema.parse({action:'details',nodeId:'a',sourceOffset:20}))).toMatchObject({sourceIds:['s20','s21','s22'],nextSourceOffset:null});
 });
 it('不允许查询未知ID、根节点详情或越界分页，查询不改写原节点',()=>{
  expect(()=>readGuideSnapshot(tree,guideReadSchema.parse({action:'details',nodeId:'fake'}))).toThrow('真实ID');
  expect(()=>readGuideSnapshot(tree,guideReadSchema.parse({action:'details',nodeId:null}))).toThrow('具体节点');
  expect(()=>readGuideSnapshot(tree,guideReadSchema.parse({action:'children',nodeId:'old',offset:100}))).toThrow('超出');
  expect(()=>readGuideSnapshot(tree,guideReadSchema.parse({action:'details',nodeId:'old',summaryOffset:6000}))).toThrow('超出');
 });
});

it('读取也受Token预算控制，动态缩小分页并给出真实续读游标',()=>{
 const original=node('a',null,1,'字'.repeat(5000));original.sourceIds=Array.from({length:50},(_,i)=>'long-source-'+i+'x'.repeat(100));
 const result=readBudgetedGuideSnapshot([original],guideReadSchema.parse({action:'details',nodeId:'a',summaryLimit:1000,limit:20}),800);
 expect(estimateTextTokens(JSON.stringify({ok:true,...result}))+64).toBeLessThanOrEqual(800);
 if(result.action==='details') { expect(result.summary).toBe(original.summary.slice(0,result.summary.length));expect(result.nextSummaryOffset).toBe(result.summary.length);expect(result.nextSourceOffset).toBe(result.sourceIds.length); }
});

it('一万节点的深树仍用迭代投影，超预算后保留入口，不递归溢出或改写图',()=>{
 const nodes=Array.from({length:10000},(_,i)=>node('n'+i,i?'n'+(i-1):null,i));
 const result=projectGuideFramework(nodes,1000);expect(result.totalNodes).toBe(10000);expect(result.nodes[0].id).toBe('n0');
 expect(result.budgetLimited).toBe(true);expect(estimateTextTokens(JSON.stringify(result))).toBeLessThanOrEqual(1000);
});

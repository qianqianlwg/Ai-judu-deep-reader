import {createHash} from 'node:crypto';
import {defaultTreeAdapter, serialize} from 'parse5';
import {describe, expect, it} from 'vitest';
import {parseMobiSanitizerTree, captureMobiPoints, rebaseMobiPoints, MOBI_TREE_LIMITS} from './mobi-sanitizer-tree.mjs';
import type {MobiLayoutPoint} from './mobi-layout-snapshot';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const textPoint=(path:number[],text:string,offset=0):MobiLayoutPoint=>({kind:'text',path,textLength:text.length,textHash:hash(text),offset});
describe('MOBI净化树与来源重投影',()=>{
 it('body片段保留前导空白，不因注释的html字符串改变上下文',()=>{
  const root=parseMobiSanitizerTree('  <!-- <html> --><p>正文</p>','body');
  expect(captureMobiPoints(root,[textPoint([0],'  ')])[0].node.nodeName).toBe('#text');
  expect(serialize(root)).toBe('  <!-- <html> --><p>正文</p>');
 });
 it.each(['form','template'])('在删除%s前限制全树预算，包括template.content',tag=>{
  expect(()=>parseMobiSanitizerTree('<'+tag+'>'+ '<p>x</p>'.repeat(50_000)+'</'+tag+'>','body')).toThrow('节点预算');
 });
 it('深层树先报预算错误，不等待serialize递归栈溢出',()=>{
  expect(()=>parseMobiSanitizerTree('<div>'.repeat(MOBI_TREE_LIMITS.depth+1),'body')).toThrow('嵌套过深');
 });
 it('重复段落绑定原对象，删除前段后准确移动后一段而不按文本猜测',()=>{
  const root=parseMobiSanitizerTree('<p>重复</p><p>重复</p>','body');
  const points=captureMobiPoints(root,[textPoint([0,0],'重复'),textPoint([1,0],'重复',1)]);
  defaultTreeAdapter.detachNode(root.childNodes[0]);
  const result=rebaseMobiPoints(root,parseMobiSanitizerTree(serialize(root),'body'),points);
  expect(result).toEqual([null,textPoint([0,0],'重复',1)]);
 });
 it('删除夹在两个文本间的注释后合并offset和hash，含emoji不截半字符',()=>{
  const root=parseMobiSanitizerTree('<p>A😀<!--x-->B😀C</p>','body');
  const points=captureMobiPoints(root,[textPoint([0,0],'A😀',1),textPoint([0,2],'B😀C',3)]);
  const p=root.childNodes[0];if(!defaultTreeAdapter.isElementNode(p))throw Error('expected p');
  defaultTreeAdapter.detachNode(p.childNodes[1]);
  expect(rebaseMobiPoints(root,parseMobiSanitizerTree(serialize(root),'body'),points)).toEqual([textPoint([0,0],'A😀B😀C',1),textPoint([0,0],'A😀B😀C',6)]);
 });
 it('拒绝半代理项、错误hash、越界路径与伪造tag',()=>{
  const root=parseMobiSanitizerTree('<p>A😀B</p>','body');
  for(const point of [textPoint([0,0],'A😀B',2),textPoint([0,0],'坏'),textPoint([2],'坏'),{kind:'element',path:[0],tag:'div',offset:0}] as MobiLayoutPoint[])expect(()=>captureMobiPoints(root,[point])).toThrow();
 });
 it('序列化后结构/文本有变化不伪造目标',()=>{
  const root=parseMobiSanitizerTree('<p id="a">正文</p>','body');
  for(const html of ['<div id="a">正文</div>','<p id="b">正文</p>','<p id="a">别文</p>',''])expect(()=>rebaseMobiPoints(root,parseMobiSanitizerTree(html,'body'),[])).toThrow();
 });
 it('document/head模式显式，畸形mode不能自动猜测',()=>{
  expect(serialize(parseMobiSanitizerTree('<title>题</title>','head'))).toBe('<title>题</title>');
  expect(serialize(parseMobiSanitizerTree('<html lang="zh"><head><title>题</title></head><body>x</body></html>','document'))).toContain('<html lang="zh">');
  expect(()=>parseMobiSanitizerTree('x','guess' as 'body')).toThrow('上下文');
 });
});

import { expect,it } from 'vitest';
import { bookNavigation,readBookNavigation } from './book-navigation';
const chapters=[{id:'c',title:'未命名章节',sourceHref:'OPS/a%20b.xhtml',paragraphs:[{id:'p',text:'标题',sourceOrdinal:0},{id:'q',text:'正文',sourceOrdinal:1}]}];
it('真实层级和同一分片多个片段保留，未命名spine不充当目录',()=>{
 const items=bookNavigation([{label:'编',href:null,children:[{label:'第一章',href:'OPS/a b.xhtml#chapter',children:[]},{label:'第二节',href:'OPS/a b.xhtml#section',children:[]}]}],chapters,[{sourceHref:'OPS/a%20b.xhtml',fragmentOrdinals:{chapter:0,section:1}}]);
 expect(items[0].children.map(x=>[x.label,x.paragraphId])).toEqual([['第一章','p'],['第二节','q']]);expect(new Set(items[0].children.map(x=>x.id)).size).toBe(2);expect(JSON.stringify(items)).not.toContain('未命名');
 expect(readBookNavigation(items)).toEqual(items);
});
it('缺失片段不冒充分片首段，空标签不生成标题，缺少目录显式空树',()=>{
 const items=bookNavigation([{label:'真实目录',href:'OPS/a b.xhtml#missing',children:[]}],chapters,[]);
 expect(items[0].paragraphId).toBeUndefined();expect(bookNavigation([],chapters,[])).toEqual([]);
 expect(bookNavigation([{label:'',href:null,children:[]}],chapters,[])).toEqual([]);
});
it('目录协议拒绝外链、坏字段与重复ID',()=>{
 expect(()=>readBookNavigation([{id:'a',label:'章',href:'https://evil.test',children:[]}])).toThrow('外部');
 expect(()=>readBookNavigation([{id:'a',label:'',children:[]}])).toThrow();
 expect(()=>readBookNavigation([{id:'a',label:'章',children:[]},{id:'a',label:'另一章',children:[]}])).toThrow('重复');
});

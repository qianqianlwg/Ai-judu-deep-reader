import {describe,it,expect} from 'vitest';
import {bookResumeEdition,readBookResumes,bookResumeHref} from './book-resume';
const edition=(id:string)=>({id,fileName:id+'.epub',fileType:'.epub',createdAt:'2026-09-21'});
const books=[{id:'a',title:'同名',author:'作者',editions:[edition('a-new'),edition('a-old')]},{id:'b',title:'同名',author:'作者',editions:[edition('b-v1')]}];
const storage=(data:Record<string,string>)=>({getItem:(key:string)=>data[key]??null});
describe('每本书的继续阅读记录',()=>{
 it('不受全局active-book影响，旧版与另一书的记录同时保留',()=>{const store=storage({'judu:active-book':'b','judu:edition:a':'a-old','judu:edition:b':'b-v1'});expect(readBookResumes(store,books)).toEqual({a:'a-old',b:'b-v1'});});
 it('拒绝串版和失效版本，不把未读书伪装为已读',()=>{expect(bookResumeEdition(storage({'judu:edition:a':'b-v1'}),books[0])).toBeUndefined();expect(readBookResumes(storage({}),books)).toEqual({});expect(bookResumeEdition(storage({'judu:edition:a':'removed'}),books[0])).toBeUndefined();});
 it('旧接口缺版本列表时可传递缓存候选，链接编码独立BookID和EditionID',()=>{expect(bookResumeEdition(storage({'judu:edition:a':'a-old'}),{id:'a',title:'书',author:''})).toBe('a-old');const url=new URL(bookResumeHref('书 a','a-old'),'http://localhost');expect(url.searchParams.get('bookId')).toBe('书 a');expect(url.searchParams.get('editionId')).toBe('a-old');expect(bookResumeHref('a')).toBe('/?bookId=a');});
 it('存储失败上抛供界面反馈，不清空或改写记录',()=>{expect(()=>readBookResumes({getItem:()=>{throw new Error('denied');}},books)).toThrow('denied');});
});

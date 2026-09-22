import {describe,it,expect} from 'vitest';
import {normalizeModelChoices,selectRequestModel,readModelChoices,saveModelChoices} from './model-choices';
import {createRequire} from 'node:module';
type TestDb={exec(sql:string):void;close():void;prepare(sql:string):{get(...args:unknown[]):Record<string,unknown>|undefined;all(...args:unknown[]):Record<string,unknown>[];run(...args:unknown[]):unknown}};
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite') as {DatabaseSync:new(file:string)=>TestDb};
describe('模型列表',()=>{
 it('按行/逗号拆分和去重，拒绝空列表和无效结构',()=>{expect(normalizeModelChoices('a\nb，a,c','x')).toEqual(['a','b','c']);expect(()=>normalizeModelChoices([], 'x')).toThrow();expect(()=>normalizeModelChoices([2],'x')).toThrow();});
 it('列表持久化且默认模型兼容旧配置，只允许已配置的模型',()=>{const db=new DatabaseSync(':memory:');saveModelChoices(db,['a','b']);expect(readModelChoices(db,'a')).toEqual(['a','b']);const config={provider:'openai' as const,baseUrl:'https://unit.invalid',apiKey:'fake',model:'a'};expect(selectRequestModel(config,'b',['a','b']).model).toBe('b');expect(()=>selectRequestModel(config,'unknown',['a'])).toThrow();expect(selectRequestModel(config,undefined,[])).toBe(config);db.close();});
});

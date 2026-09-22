import {it,expect,vi} from "vitest";
import {readShelfHistory,writeShelfHistory,SHELF_HISTORY_PREFIX} from "./bookshelf-history";
it("保存摘要不覆盖定位，并拒绝跨书版本和损坏记录",()=>{
 const data=new Map<string,string>();const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};
 const books=[{id:"a",title:"书",author:"",editions:[{id:"v",fileName:"a",fileType:"pdf",createdAt:"2026"}]}];
 writeShelfHistory(storage,"a",{editionId:"v",updatedAt:123,location:"第 2 页"});expect(readShelfHistory(storage,books).a.location).toBe("第 2 页");
 writeShelfHistory(storage,"a",{editionId:"other",updatedAt:123,location:"wrong"});expect(readShelfHistory(storage,books)).toEqual({});
 const log=vi.spyOn(console,"warn").mockImplementation(()=>{});data.set(SHELF_HISTORY_PREFIX+"a","{");expect(readShelfHistory(storage,books)).toEqual({});expect(log).toHaveBeenCalled();log.mockRestore();
});

it("损坏的超范围时间不能进入日期渲染",()=>{const books=[{id:"a",title:"书",author:"",editions:[{id:"v",fileName:"a",fileType:"pdf",createdAt:"2026"}]}];expect(readShelfHistory({getItem:()=>JSON.stringify({editionId:"v",updatedAt:1e100,location:"第一章"})},books)).toEqual({});});

import {it,expect,vi} from "vitest";
const change=vi.hoisted(()=>vi.fn(()=>true));vi.mock("@/lib/db",()=>({getDb:()=>({})}));vi.mock("@/lib/book-display-title",async original=>({...await original<typeof import("@/lib/book-display-title")>(),setBookDisplayTitle:change}));
import {PATCH} from "./route";
const call=(body:unknown,id="a")=>PATCH(new Request("http://localhost/api/books/a/display-title",{method:"PATCH",body:JSON.stringify(body)}),{params:Promise.resolve({bookId:id})});
it("校验显示名并返回保存后的身份",async()=>{expect(await(await call({displayTitle:" 新书名 "})).json()).toEqual({bookId:"a",displayTitle:"新书名"});expect((await call({displayTitle:""})).status).toBe(400);expect((await call({displayTitle:"名字"},"../a")).status).toBe(400);change.mockReturnValueOnce(false);expect((await call({displayTitle:null})).status).toBe(404);});

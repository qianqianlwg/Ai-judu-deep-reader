import {createRequire} from "node:module";
import {it,expect} from "vitest";
import type {ShelfStore} from "./book-shelf";
import {normalizeDisplayTitle,setBookDisplayTitle,bookDisplayTitles} from "./book-display-title";
const {DatabaseSync}=createRequire(import.meta.url)("node:sqlite") as {DatabaseSync:new(file:string)=>ShelfStore&{close():void}};
it("显示名独立于原始书名，可恢复且不影响同名书",()=>{
 const db=new DatabaseSync(":memory:");try{db.exec("CREATE TABLE books(id TEXT,title TEXT);INSERT INTO books VALUES('a','原名'),('b','原名')");expect(setBookDisplayTitle(db,"a",normalizeDisplayTitle(" 新名字 "))).toBe(true);expect(bookDisplayTitles(db)).toEqual({a:"新名字"});expect(db.prepare("SELECT title FROM books WHERE id='a'").get()).toEqual({title:"原名"});expect(setBookDisplayTitle(db,"missing","标题")).toBe(false);setBookDisplayTitle(db,"a",null);expect(bookDisplayTitles(db)).toEqual({});}finally{db.close();}
});
it("拒绝空白、超长、控制字符和非字符串",()=>{for(const value of ["", "   ", "a".repeat(201),"bad\nname",{},undefined])expect(()=>normalizeDisplayTitle(value)).toThrow();expect(normalizeDisplayTitle(null)).toBeNull();});

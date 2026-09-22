import {describe, it, expect} from "vitest";
import {selectShelfBooks, coverTone, formatName} from "./bookshelf-model";
const books=[{id:"b", title:"Beta",author:"乙",createdAt:"2026-09-22",editions:[{id:"v",fileName:"论文.pdf",fileType:".pdf",createdAt:"2026-09-22"}]},{id:"a",title:"Alpha",author:"甲",createdAt:"2026-09-20"}];
const options={query:"",format:"",status:"all" as const,sort:"imported" as const,resumes:{b:"v"}};
describe("书架投影",()=>{
 it("筛选文件名和格式，保留精确身份",()=>{expect(selectShelfBooks(books,{...options,query:"论文",format:"PDF"}).map(b=>b.id)).toEqual(["b"]);});
 it("按状态筛选并排序，不改变原数组",()=>{expect(selectShelfBooks(books,{...options,status:"unread"}).map(b=>b.id)).toEqual(["a"]);expect(selectShelfBooks(books,{...options,sort:"title"}).map(b=>b.id)).toEqual(["a","b"]);expect(books[0].id).toBe("b");});
 it("最近阅读按真实时间，不用导入时间冒充",()=>{expect(selectShelfBooks(books,{...options,sort:"recent",recent:{a:10,b:5}})[0].id).toBe("a");});
 it("同名条目不去重，封面颜色不依赖排序",()=>{expect(selectShelfBooks(books.map(b=>({...b,title:"同名"})),options)).toHaveLength(2);expect(coverTone("b")).toBe(coverTone("b"));expect(formatName(".epub")).toBe("EPUB");});
});

import { expect, it } from "vitest";
import { analysisOnlySource, readSourceMode, analysisOnlyTextError } from "./analysis-only-source";
const input={sourceMode:"analysis-only",selectedText:"一 泛论逻辑"};
it("短标题可分析，协议没有伪造位置",()=>{
  expect(analysisOnlySource(input)).toEqual({sourceMode:"analysis-only",text:input.selectedText});
  expect(analysisOnlyTextError("题")).toBeNull();expect(readSourceMode({selectedText:"正文"})).toBeUndefined();
});
it.each(["paragraphId","chapterId","selectionStart","selectionEnd","selectionAnchors","readingStyle","sectionId","forceRead","context","textHash"])("仅分析拒绝混入来源字段 %s",field=>{
  expect(()=>readSourceMode({...input,[field]:field==="selectionAnchors"?[]:field==="forceRead"?false:0})).toThrow("不能携带");
});
it("空文字、超限和未知来源模式拒绝，不暗中转成仅分析",()=>{
  expect(()=>readSourceMode({...input,sourceMode:"guess"})).toThrow("模式无效");
  expect(()=>readSourceMode({...input,selectedText:" "})).toThrow();
  expect(()=>readSourceMode({...input,selectedText:"😀".repeat(3001)})).toThrow();
  expect(analysisOnlyTextError("😀".repeat(3000))).toBeNull();
});

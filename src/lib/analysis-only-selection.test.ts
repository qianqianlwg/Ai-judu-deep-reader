// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { readAnalysisOnlySelection } from "./analysis-only-selection";
afterEach(()=>{window.getSelection()?.removeAllRanges();document.body.innerHTML="";});
function choose(html:string,reverse=false){const root=document.createElement("article");root.innerHTML=html;document.body.append(root);const range=document.createRange();range.selectNodeContents(root);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);if(reverse)selection.setBaseAndExtent(range.endContainer,range.endOffset,range.startContainer,range.startOffset);return {root,selection};}
it.each(["h1","h2","h3","h4","h5","h6","div","span","custom-text","pre","td","figcaption"])("不按标签 %s 拒绝可选文字",tag=>{
  const {root,selection}=choose("<"+tag+">标题 😀</"+tag+">");expect(readAnalysisOnlySelection(selection,root)).toEqual({sourceMode:"analysis-only",text:"标题 😀"});
});
it("aria-hidden 仅影响无障碍语义，可见选文仍可分析",()=>{const {root,selection}=choose('<h3 aria-hidden="true">可见标题</h3>');expect(readAnalysisOnlySelection(selection,root)?.text).toBe("可见标题");});
it("混合标题、裸文本容器、SVG文字与正文全部进入分析，不生成锚点",()=>{
  const {root,selection}=choose('<h1>第一篇</h1><div>容器直接文字<span>内联</span><p>正文</p></div><svg><text>图中文字</text></svg>');
  const result=readAnalysisOnlySelection(selection,root)!;for(const text of ["第一篇","容器直接文字内联","正文","图中文字"])expect(result.text).toContain(text);expect(result).not.toHaveProperty("paragraphId");
});
it("排除脚本、装饰、按钮和不可见元素，不把聊天混进阅读选区",()=>{
  const {root,selection}=choose('<h1>标题</h1><script>脚本</script><style>样式</style><span hidden>隐藏</span><span style="display:none">不可见</span><button>按钮</button><span data-reader-decoration>AI标记</span><p>正文</p>');
  expect(readAnalysisOnlySelection(selection,root)?.text).toBe("标题\n正文");
  const outside=document.createTextNode("聊天");document.body.append(outside);const range=document.createRange();range.setStart(root,0);range.setEnd(outside,2);selection.removeAllRanges();selection.addRange(range);expect(readAnalysisOnlySelection(selection,root)).toBeNull();
});
it.each([false,true])("3000字限制同步可见范围，逆选=%s，不拆 emoji",reverse=>{
  const {root,selection}=choose('<span>'+"甲".repeat(10)+"😀".repeat(3005)+"乙".repeat(10)+'</span>',reverse),limited=()=>{};
  const result=readAnalysisOnlySelection(selection,root,limited)!;expect(Array.from(result.text)).toHaveLength(3000);expect(selection.toString()).toBe(result.text);expect(result.text).not.toMatch(/[\uD800-\uDBFF]$/u);expect(reverse?result.text.endsWith("乙".repeat(10)):result.text.startsWith("甲".repeat(10))).toBe(true);
});
it("跨块限制计算换行而不是假造来源段数",()=>{const {root,selection}=choose('<h2>'+"题".repeat(2000)+'</h2><p>'+"文".repeat(2000)+'</p>');const result=readAnalysisOnlySelection(selection,root)!;expect(Array.from(result.text)).toHaveLength(3000);expect(result.text).toContain("\n");expect(readAnalysisOnlySelection(selection,root)).toEqual(result);});
it("保留内联换行，不因 br 把两句粘在一起",()=>{const {root,selection}=choose("<span>上句<br/>下句</span>");expect(readAnalysisOnlySelection(selection,root)?.text).toBe("上句\n下句");});
it("图片和空范围没有文字时不伪造 OCR",()=>{const {root,selection}=choose('<img alt="照片内有文字"/>');expect(readAnalysisOnlySelection(selection,root)).toBeNull();selection.collapse(root,0);expect(readAnalysisOnlySelection(selection,root)).toBeNull();});

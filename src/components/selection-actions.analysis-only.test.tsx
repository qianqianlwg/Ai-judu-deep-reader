// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,expect,it,vi} from "vitest";
import {SelectionActions} from "./selection-actions";
afterEach(()=>vi.unstubAllGlobals());
it("仅分析禁用原文写入和扩展，但短标题仍可发起分析",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);const host=document.createElement("div");document.body.append(host);const root=createRoot(host),analyze=vi.fn(),write=vi.fn();
 try{await act(async()=>root.render(<SelectionActions analysisOnly selectedText="题" reason="无可靠原文位置" left={100} top={100} onAnalyze={analyze} onHighlight={write} onFavorite={write} onNote={write} onExtend={write}/>));
 const buttons=[...host.querySelectorAll("button")],analysis=buttons.find(b=>b.textContent==="分析选文")!;expect(analysis.disabled).toBe(false);await act(async()=>analysis.click());expect(analyze).toHaveBeenCalledOnce();
 for(const button of buttons.filter(b=>/标亮/.test(b.getAttribute("aria-label")??"")||["添加笔记","收藏","继续选取"].includes(b.textContent??""))){expect(button.disabled).toBe(true);await act(async()=>button.click());}
 expect(write).not.toHaveBeenCalled();expect(host.textContent).toContain("仅分析，无原文位置");expect(host.textContent).not.toContain("仍可标亮");expect(host.textContent).not.toContain("1 段");
 }finally{await act(async()=>root.unmount());host.remove();}
});

it("已打开笔记后切换为仅分析，不留下可保存的笔记表单",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);const host=document.createElement("div");document.body.append(host);const root=createRoot(host),write=vi.fn();const props={left:100,top:100,selectedText:"正文",onAnalyze:vi.fn(),onHighlight:write,onFavorite:write,onNote:write};
 try{await act(async()=>root.render(<SelectionActions {...props}/>));await act(async()=>[...host.querySelectorAll("button")].find(b=>b.textContent==="添加笔记")!.click());expect(host.querySelector("form")).not.toBeNull();await act(async()=>root.render(<SelectionActions {...props} analysisOnly/>));expect(host.querySelector("form")).toBeNull();expect(write).not.toHaveBeenCalled();}finally{await act(async()=>root.unmount());host.remove();}
});

// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,expect,it,vi} from "vitest";
import {AnalysisOnlySourceCard} from "./analysis-only-source-card";
afterEach(()=>vi.unstubAllGlobals());
it("只读保存选文，明确无回跳位置，没有定位按钮",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try{await act(async()=>root.render(<AnalysisOnlySourceCard source={{sourceMode:"analysis-only",text:"标题\n可选中的全部原文"}}/>));
 expect(host.textContent).toContain("仅分析选文");expect(host.textContent).toContain("没有可靠原文位置");expect(host.textContent).toContain("标题");expect(host.querySelector('[data-source-paragraph]')).toBeNull();expect([...host.querySelectorAll("button")].some(button=>button.textContent?.includes("定位"))).toBe(false);
 }finally{await act(async()=>root.unmount());host.remove();}
});

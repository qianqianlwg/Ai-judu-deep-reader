// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import Settings from "./page";
afterEach(()=>{vi.unstubAllGlobals();localStorage.clear();});
it("可设置200K、400K、1M输入和独立输出预算，不再宣称保留最近消息",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("requestAnimationFrame",(callback:FrameRequestCallback)=>{callback(0);return 1;});
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({provider:"openai",baseUrl:"https://example.test/v1",model:"test"})));
  const node=document.createElement("div");document.body.append(node);const root=createRoot(node);
  try{await act(async()=>root.render(<Settings/>));
    const input=node.querySelector<HTMLSelectElement>('select[aria-label="最大输入 Token"]')!,detail=node.querySelector<HTMLSelectElement>('select[aria-label="句读详细程度"]')!,output=node.querySelector<HTMLSelectElement>('select[aria-label="最大输出 Token"]')!;
    expect(Array.from(input.options).map(option=>option.value)).toEqual(["200000","400000","1000000"]); expect(Array.from(detail.options).map(option=>option.value)).toEqual(["concise","standard","detailed"]);
    await act(async()=>{input.value="1000000";input.dispatchEvent(new Event("change",{bubbles:true}));detail.value="detailed"; detail.dispatchEvent(new Event("change",{bubbles:true})); output.value="2048";output.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(localStorage.getItem("judu:maxInputTokens")).toBe("1000000");expect(localStorage.getItem("judu:readingDetail")).toBe("detailed");expect(localStorage.getItem("judu:maxOutputTokens")).toBe("2048");expect(node.textContent).not.toContain("保留最近消息");expect(node.textContent).toContain("检查点");
  }finally{await act(async()=>root.unmount());node.remove();}
});

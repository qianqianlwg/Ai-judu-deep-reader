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
    expect(node.querySelector(".settings-card")).toBeNull(); expect(node.textContent).toContain("阅读外观"); expect(node.textContent).not.toContain("正文大小");
    expect(Array.from(input.options).map(option=>option.value)).toEqual(["200000","400000","1000000"]); expect(Array.from(detail.options).map(option=>option.value)).toEqual(["concise","standard","detailed"]);
    await act(async()=>{input.value="1000000";input.dispatchEvent(new Event("change",{bubbles:true}));detail.value="detailed"; detail.dispatchEvent(new Event("change",{bubbles:true})); output.value="2048";output.dispatchEvent(new Event("change",{bubbles:true}));});
    const theme = node.querySelector<HTMLInputElement>('input[type="radio"][value="dark"]')!; await act(async()=>theme.click());
    expect(localStorage.getItem("judu:readingAppearance:v1")).toContain('"theme":"dark"'); expect(document.documentElement.dataset.readingTheme).toBe("dark");
    expect(localStorage.getItem("judu:fontScale")).toBeNull(); expect(localStorage.getItem("judu:theme")).toBeNull();
    expect(localStorage.getItem("judu:maxInputTokens")).toBe("1000000");expect(localStorage.getItem("judu:readingDetail")).toBe("detailed");expect(localStorage.getItem("judu:maxOutputTokens")).toBe("2048");expect(node.textContent).not.toContain("保留最近消息");expect(node.textContent).toContain("检查点");
  }finally{await act(async()=>root.unmount());node.remove();}
});

it("首次进入设置页将旧外观迁移为唯一新偏好源",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true); vi.stubGlobal("requestAnimationFrame",(callback:FrameRequestCallback)=>{callback(0);return 1;});
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({provider:"openai",baseUrl:"",model:""})));
  localStorage.setItem("judu:theme","paper"); localStorage.setItem("judu:fontScale","1.15");
  const node=document.createElement("div"); document.body.append(node); const root=createRoot(node);
  try { await act(async()=>root.render(<Settings/>));
    expect(localStorage.getItem("judu:readingAppearance:v1")).toContain('"theme":"paper"');
    expect(localStorage.getItem("judu:theme")).toBeNull(); expect(localStorage.getItem("judu:fontScale")).toBeNull();
  } finally { await act(async()=>root.unmount()); node.remove(); }
});

it("设置页样式没有会破坏首个选择器的 BOM，滚动仅由页面容器承担",async()=>{
 const {readFile}=await import('node:fs/promises');
 const css=await readFile('src/app/settings/settings.module.css','utf8');
 expect(css.charCodeAt(0)).not.toBe(0xfeff);
 expect(css.startsWith('.page {')).toBe(true);
 expect(css).toContain('height: 100dvh');
 expect(css).toContain('overflow-y: auto');
 expect(css).toContain('box-sizing: border-box');
 expect(css).not.toContain('!important');
});

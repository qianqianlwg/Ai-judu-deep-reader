// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SelectionActions } from "./selection-actions";
afterEach(()=>{ vi.unstubAllGlobals(); });
it("提供句读、高亮、笔记、收藏并可提交笔记",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const note=vi.fn(), analyze=vi.fn();
  try {
    await act(async()=>root.render(<SelectionActions left={100} top={100} onAnalyze={analyze} onHighlight={vi.fn()} onFavorite={vi.fn()} onNote={note}/>));
    await act(async()=>host.querySelector<HTMLButtonElement>('.selection-primary-actions > button:nth-of-type(2)')!.click());
    const input=host.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"我的笔记");input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:"我的笔记"}));});
    await act(async()=>host.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
    expect(note).toHaveBeenCalledWith("我的笔记");expect(host.textContent).toContain("收藏");
    await act(async()=>Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "句读一下")!.click());expect(analyze).toHaveBeenCalled();
  } finally { await act(async()=>root.unmount());host.remove(); }
});
it("选区操作栏与继续选取共用 3000 字符上限，1000 字仍可继续", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); const extend = vi.fn();
  const props = { left: 100, top: 100, onAnalyze: vi.fn(), onHighlight: vi.fn(), onFavorite: vi.fn(), onNote: vi.fn(), onExtend: extend };
  try {
    await act(async () => root.render(<SelectionActions {...props} selectedText={"甲".repeat(214)} paragraphCount={1}/>));
    expect(host.querySelector(".selection-preview summary")?.textContent).toBe("已选 214 / 3000 字符 · 1 段");
    await act(async () => root.render(<SelectionActions {...props} selectedText={"甲".repeat(1000)}/>));
    const continueButton = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "继续选取")!;
    expect(continueButton.disabled).toBe(false);
    await act(async () => continueButton.click()); expect(extend).toHaveBeenCalledOnce();
    await act(async () => root.render(<SelectionActions {...props} selectedText={"😀".repeat(3000)}/>));
    expect(host.querySelector(".selection-preview summary")?.textContent).toContain("已选 3000 / 3000 字符");
    expect(continueButton.disabled).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

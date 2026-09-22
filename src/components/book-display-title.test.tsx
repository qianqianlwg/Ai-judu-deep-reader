// @vitest-environment jsdom
import {act} from "react";import {createRoot} from "react-dom/client";import {it,expect,vi} from "vitest";
import {BookDisplayTitle} from "./book-display-title";
it("保存显示名使用独立接口，失败可见，恢复原名传null",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);const fetcher=vi.fn().mockResolvedValueOnce(Response.json({error:"保存失败"},{status:500})).mockResolvedValueOnce(Response.json({bookId:"a",displayTitle:null}));vi.stubGlobal("fetch",fetcher);const log=vi.spyOn(console,"error").mockImplementation(()=>{});const host=document.createElement("div"),root=createRoot(host),saved=vi.fn();
 try{await act(async()=>root.render(<BookDisplayTitle book={{id:"a",title:"原始标题",displayTitle:"新标题",author:""}} onSaved={saved}/>));await act(async()=>host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));expect(host.querySelector('[role="alert"]')?.textContent).toContain("保存失败");expect(saved).not.toHaveBeenCalled();await act(async()=>host.querySelector<HTMLButtonElement>('button[type="button"]')!.click());expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({displayTitle:null});expect(saved).toHaveBeenCalledOnce();expect(host.querySelector("input")?.value).toBe("原始标题");}
 finally{act(()=>root.unmount());log.mockRestore();vi.unstubAllGlobals();}
});

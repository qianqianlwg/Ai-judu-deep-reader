// @vitest-environment jsdom
import {act} from "react";import {createRoot} from "react-dom/client";import {it,expect,vi} from "vitest";
import {useShelfHistoryRecorder} from "./use-shelf-history-recorder";
it("只记录正在阅读的版本，切换书架和恢复加载不重写阅读时间",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);localStorage.clear();const host=document.createElement("div"),root=createRoot(host),error=vi.fn();const anchor={paragraphId:"p",offset:12};
 function View({active,location}:{active:boolean;location:string}){useShelfHistoryRecorder({bookId:"a",editionId:"old",active,anchor,location,onError:error});return null;}
 try{await act(async()=>root.render(<View active={true} location="第三章"/>));const saved=localStorage.getItem("judu:resume-meta:a");expect(JSON.parse(saved!).location).toBe("第三章");expect(JSON.parse(localStorage.getItem("judu:position:a:old")!)).toEqual(anchor);await act(async()=>root.render(<View active={false} location="错误章节"/>));expect(localStorage.getItem("judu:resume-meta:a")).toBe(saved);expect(error).not.toHaveBeenCalled();}
 finally{act(()=>root.unmount());localStorage.clear();vi.unstubAllGlobals();}
});

it("缺少可靠锚点时不猜测第一页或章节",async()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);localStorage.clear();const host=document.createElement("div"),root=createRoot(host);function View(){useShelfHistoryRecorder({bookId:"image-book",editionId:"v",active:true,anchor:null,location:"",onError:()=>{}});return null;}try{await act(async()=>root.render(<View/>));expect(JSON.parse(localStorage.getItem("judu:resume-meta:image-book")!).location).toBe("已打开，尚未记录位置");expect(localStorage.getItem("judu:position:image-book:v")).toBeNull();}finally{act(()=>root.unmount());localStorage.clear();vi.unstubAllGlobals();}});

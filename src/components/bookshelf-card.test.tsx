// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi} from "vitest";
import {BookshelfCard} from "./bookshelf-card";
it("默认折叠身份和版本，键盘可展开并准确打开旧版本",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);const host=document.createElement("div"),root=createRoot(host),open=vi.fn();
 const book={id:"book-a",title:"同名书",author:"作者",editions:[{id:"old",fileName:"旧.pdf",fileType:".pdf",createdAt:"2026-01-01"}]};
 try {await act(async()=>root.render(<BookshelfCard book={book} currentBookId="book-a" currentEditionId="old" onOpen={open} onChanged={()=>{}}/>));const details=host.querySelector("details")!;expect(details.open).toBe(false);expect(details.textContent).toContain("book-a");expect(details.querySelector('[aria-label="下架《同名书》"]')).not.toBeNull();act(()=>{details.open=true;host.querySelector<HTMLButtonElement>('[data-edition-id="old"]')!.click();});expect(open).toHaveBeenCalledWith("book-a","old");act(()=>details.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));expect(details.open).toBe(false);}
 finally{act(()=>root.unmount());vi.unstubAllGlobals();}
});

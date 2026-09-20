import type {FoliateBook} from "./foliate-types";
import {readMobiPublication} from "./mobi-publication-model";
import {createMobiFoliateBook} from "./mobi-render";
export async function loadMobiPublication(response:Response,sourceHash:string):Promise<{book:FoliateBook;warnings:string[]}>{
 if(!response.ok)throw new Error("MOBI原版读取失败");
 if(!response.headers.get("content-type")?.includes("application/json"))throw new Error("MOBI原版响应格式无效，请重试");
 // WHY：空响应不能直接response.json；流式限制包体后再解析，失败由阅读器呈现重试/精读操作。
 const reader=response.body?.getReader();if(!reader)throw new Error("MOBI原版响应为空，请重试");
 let length=0;const chunks:Uint8Array[]=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>200*1024*1024)throw new Error("MOBI原版响应超限");chunks.push(value);}}
 catch(cause:unknown){await reader.cancel(cause);throw cause;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const source=new TextDecoder("utf-8",{fatal:true}).decode(bytes);if(!source.trim())throw new Error("MOBI原版响应为空，请重试");
 const value:unknown=JSON.parse(source),model=readMobiPublication(value,sourceHash);
 return {book:await createMobiFoliateBook(model),warnings:model.warnings};
}

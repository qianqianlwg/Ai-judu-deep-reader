import {importBodyTooLarge,MAX_IMPORT_BODY_BYTES,IMPORT_BODY_TOO_LARGE,IMPORT_SIZE_LABEL} from './import-limits';
export class ImportFormError extends Error{constructor(readonly status:400|413,message:string){super(message);}}
export async function readImportForm(request:Request,maxBytes=MAX_IMPORT_BODY_BYTES):Promise<FormData>{
 if(importBodyTooLarge(request.headers,maxBytes))throw new ImportFormError(413,IMPORT_BODY_TOO_LARGE);
 if(!request.body)throw new ImportFormError(400,'上传内容为空，请重新选择文件');
 let received=0,overflow=false;
 // WHY：不能只信Content-Length；无长度或分块上传也逐块计数，超限先给413，不交给formData误报损坏。
 const bounded=request.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){received+=chunk.byteLength;if(received>maxBytes){overflow=true;throw new ImportFormError(413,IMPORT_BODY_TOO_LARGE);}controller.enqueue(chunk);}}));
 try{return await new Response(bounded,{headers:{'Content-Type':request.headers.get('content-type')??''}}).formData();}
 catch(cause:unknown){
  if(overflow)throw new ImportFormError(413,IMPORT_BODY_TOO_LARGE);
  console.warn('上传表单读取失败',{name:cause instanceof Error?cause.name:'UnknownError',receivedBytes:received});
  throw new ImportFormError(400,'上传未完成或表单格式不正确，请重新上传（单文件最大 '+IMPORT_SIZE_LABEL+'）。');
 }
}

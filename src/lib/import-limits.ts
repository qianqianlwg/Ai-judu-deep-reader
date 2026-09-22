// WHY：沿用文件大小的二进制计量，前端、接口及代理共享同一上限，避免提示300MB而代理仅接收10MB。
export const MAX_IMPORT_FILE_BYTES=300*1024*1024;
export const IMPORT_SIZE_LABEL='300 MB';
export const MAX_IMPORT_BODY_BYTES=MAX_IMPORT_FILE_BYTES+1024*1024;
// WHY：给multipart边界和字段预留1MiB；代理再多留1MiB，让业务计数器先返回明确413而不是被代理截断。
export const IMPORT_PROXY_BUFFER_BYTES=MAX_IMPORT_BODY_BYTES+1024*1024;
export const IMPORT_TOO_LARGE='文件过大：单个文件最大支持 '+IMPORT_SIZE_LABEL+'，请选择较小的文件后重试。';
export const IMPORT_BODY_TOO_LARGE='上传内容超过大小限制：单个文件最大支持 '+IMPORT_SIZE_LABEL+'，请一次只上传一个文件。';
export function importFileSizeError(size:number):string|undefined{
 if(size<=MAX_IMPORT_FILE_BYTES)return undefined;
 return '文件大小为 '+(size/1024/1024).toFixed(2)+' MB，超过单文件 '+IMPORT_SIZE_LABEL+' 上限，请选择较小的文件后重试。';
}
export function importBodyTooLarge(headers:Headers,maxBytes=MAX_IMPORT_BODY_BYTES):boolean{
 const length=headers.get('content-length');return length!==null&&/^\d+$/u.test(length)&&Number(length)>maxBytes;
}

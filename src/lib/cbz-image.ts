import sharp from 'sharp';
export const CBZ_MAX_IMAGE_PIXELS=16_777_216;
export type CbzImageInfo={width:number;height:number;mime:'image/jpeg'|'image/png'|'image/gif'|'image/webp'};
const typeFor:Record<string,string>={jpg:'jpeg',jpeg:'jpeg',png:'png',gif:'gif',webp:'webp'};
export async function validateCbzImage(name:string,bytes:Buffer,decode=true):Promise<CbzImageInfo>{
 const extension=name.split('.').at(-1)?.toLowerCase(),expected=extension&&Object.hasOwn(typeFor,extension)?typeFor[extension]:undefined;
 if(!expected||!bytes.length||bytes.length>24*1024*1024)throw new Error('CBZ图片格式或字节大小无效');
 void decode;
 const trailer=expected==='png'?Buffer.from([0,0,0,0,0x49,0x45,0x4e,0x44,0xae,0x42,0x60,0x82]):expected==='gif'?Buffer.from([0x3b]):expected==='jpeg'?Buffer.from([0xff,0xd9]):null;
 if(trailer&&!bytes.subarray(bytes.length-trailer.length).equals(trailer))throw new Error('CBZ图片文件尾部不完整，疑似截断');
 if(expected==='webp'&&(bytes.length<12||bytes.readUInt32LE(4)+8!==bytes.length))throw new Error('CBZ WebP容器长度不完整');
 // WHY：不只相信扩展名/文件头；用已固定的本地图像解码库验证类型、尺寸与实际像素，不允许SVG伪装栅格或超大解码分配。
 const image=sharp(bytes,{failOn:'warning',limitInputPixels:CBZ_MAX_IMAGE_PIXELS,animated:true});
 try{const metadata=await image.metadata();if(metadata.format!==expected)throw new Error('CBZ图片内容与扩展名不一致');const {width,height}=metadata;
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||!width||!height||width>20000||height>20000||width*height>CBZ_MAX_IMAGE_PIXELS)throw new Error('CBZ图片尺寸超过安全上限');
  if((metadata.pages??1)!==1||metadata.loop===0)throw new Error('CBZ当前仅支持静态图片，不支持动画或多帧图片');
  // WHY：metadata可能只读取头部；stats强制完整解码并校验尾部，截断图片不能作为可阅读页面。
  await image.clone().stats();await image.raw().toBuffer();return {width,height,mime:('image/'+expected)as CbzImageInfo['mime']};
 }catch(cause:unknown){if(cause instanceof Error&&/pixel limit|dimensions|image size/iu.test(cause.message))throw new Error('CBZ图片尺寸或像素超过安全上限',{cause});throw cause;}finally{image.destroy();}
}

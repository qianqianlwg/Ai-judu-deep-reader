import {expect,it} from 'vitest';
import {reconstructKf8Source,decodeMobiSource,parseMobiSourceLocator} from './mobi-source-bytes.mjs';
const bytes=(text:string)=>new TextEncoder().encode(text);
it('KF8连续插入、向前插入和片段内部插入同步切分来源范围',()=>{
 const value=reconstructKf8Source(bytes('ab'),[{fid:0,insertOffset:1,bytes:bytes('1234')},{fid:1,insertOffset:3,bytes:bytes('XY')},{fid:2,insertOffset:0,bytes:bytes('先')}]);
 expect(new TextDecoder().decode(value.bytes)).toBe('先a12XY34b');
 expect(value.spans).toEqual([{fid:0,start:0,end:2,targetStart:4},{fid:0,start:2,end:4,targetStart:8},{fid:1,start:0,end:2,targetStart:6},{fid:2,start:0,end:3,targetStart:0}]);
});
it.each([-1,3,1.2,NaN])('非法插入偏移%s失败而不裁短',offset=>expect(()=>reconstructKf8Source(bytes('ab'),[{fid:0,insertOffset:offset,bytes:bytes('x')}])).toThrow());
it('重复FID拒绝；输出快照不共享原输入',()=>{const input=bytes('ab'),value=reconstructKf8Source(input,[]);input.fill(0);expect(new TextDecoder().decode(value.bytes)).toBe('ab');expect(()=>reconstructKf8Source(bytes('a'),[{fid:0,insertOffset:0,bytes:bytes('x')},{fid:0,insertOffset:0,bytes:bytes('y')}])).toThrow('重复');});
it('UTF8字节不是UTF16字符，emoji/中文中间字节不能定位',()=>{
 const text='甲😀乙&copy;\r\n'+('中😀'.repeat(600)),input=bytes(text),index=decodeMobiSource(input,65001);expect(index.text).toBe(text);
 let at=0,chars=0;for(const character of text){expect(index.characterOffset(at)).toBe(chars);const width=bytes(character).length;for(let i=1;i<width;i++)expect(index.characterOffset(at+i)).toBeNull();at+=width;chars+=character.length;}
 expect(index.characterOffset(input.length)).toBe(text.length);expect(index.characterOffset(input.length+1)).toBeNull();
});
it('CP1252逐字节字符，保留BOM及拒绝坏UTF8',()=>{const cp=decodeMobiSource(new Uint8Array([0x61,0xe9,0x20,0x61]),1252);expect(cp.text).toBe('aé a');expect(cp.characterOffset(2)).toBe(2);const bom=decodeMobiSource(bytes('\ufeff正文'),65001);expect(bom.text).toBe('\ufeff正文');expect(bom.characterOffset(3)).toBe(1);expect(()=>decodeMobiSource(new Uint8Array([0xc0,0x80]),65001)).toThrow();});
it.each(['filepos:1\n','xfilepos:3','filepos:-1','filepos:9007199254740993','kindle:pos:fid:Z:off:1','https://a/filepos:1','kindle:pos:fid:0:off:-1'])('严格locator拒绝%s',href=>expect(parseMobiSourceLocator(href)).toBeNull());
it('base32数字逐项解析，不使用章节子串猜测',()=>{expect(parseMobiSourceLocator('filepos:000120')).toEqual({kind:'mobi',offset:120});expect(parseMobiSourceLocator('kindle:pos:fid:000A:off:000000001V')).toEqual({kind:'kf8',fid:10,offset:63});});
it('字节边界与解码结果绑定不可变输入快照',()=>{const input=bytes('甲😀乙'),index=decodeMobiSource(input,65001);input.fill(65);expect(index.text).toBe('甲😀乙');expect(index.characterOffset(1)).toBeNull();expect(index.characterOffset(7)).toBe(3);});

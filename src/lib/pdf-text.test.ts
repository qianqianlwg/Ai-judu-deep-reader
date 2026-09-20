import {expect,it} from 'vitest';import {pdfPageNumber,pdfPageText}from './pdf-text';
it('PDF页文字保留公式和HTML外观字符、不混入标记项',()=>{expect(pdfPageText([{str:'x < y'},{type:'marked-content'},{str:' &amp; 😀\n  下一行'}])).toBe('x < y &amp; 😀 下一行');});
it('页locator须是有界正整数',()=>{expect(pdfPageNumber('pdf:page:13')).toBe(13);for(const value of ['pdf:page:0','pdf:page:01','pdf:page:5001','../p1','pdf:page:1x'])expect(pdfPageNumber(value)).toBeNull();});

it('未知NUL字符显式占位，后续公式不能在持久化后被截断',()=>{expect(pdfPageText([{str:'公式甲\0公式乙'}])).toBe('公式甲�公式乙');});

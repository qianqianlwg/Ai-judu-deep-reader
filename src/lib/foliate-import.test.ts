import { expect,it } from 'vitest';
import path from 'node:path';
import { parseWithFoliate, resolveFoliateJsdomEntry } from './foliate-import';
import { makeEpub,EPUB_HREF } from '../app/api/import/fixtures';
import JSZip from 'jszip';
it('实际执行固定上游引擎，NCX目录与spine分离，旧字面百分号资源可读',async()=>{
 const result=await parseWithFoliate(makeEpub());expect(result.sections[0].sourceHref).toBe(EPUB_HREF);
 expect(result.navigation[0].label).toBe('First chapter');expect(result.sections[0].html).toContain('第二段');
},10000);
it('EPUB3 nav优先，保留无href分组和同一文件章内目录层级',async()=>{
 const zip=await JSZip.loadAsync(makeEpub());const opf=await zip.file('OPS/book.opf')!.async('string');
 zip.file('OPS/book.opf',opf.replace('<manifest>','<manifest><item id="nav3" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'));
 zip.file('OPS/nav.xhtml','<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><span>第一编</span><ol><li><a href="Text/chapter%20one.xhtml#part">真实章名</a></li></ol></li></ol></nav></body></html>');
 const parsed=await parseWithFoliate(await zip.generateAsync({type:'nodebuffer'}));expect(parsed.navigation[0].label).toBe('第一编');expect(parsed.navigation[0].children[0].label).toBe('真实章名');expect(parsed.navigation[0].children[0].href).toContain('#part');
},10000);
it('缺失章节或归档失败向上抛，不跳过章节伪造成功',async()=>{
 const zip=await JSZip.loadAsync(makeEpub());zip.remove(EPUB_HREF);await expect(parseWithFoliate(await zip.generateAsync({type:'nodebuffer'}))).rejects.toThrow('章节资源不存在');
},10000);

it('字面百分号和空格资源共存时优先精确寻址，不拒绝无关资源',async()=>{
 const zip=await JSZip.loadAsync(makeEpub());
 zip.file('OPS/Text/chapter one.xhtml','<html xmlns="http://www.w3.org/1999/xhtml"><body><p>空格版本正文</p></body></html>');
 const parsed=await parseWithFoliate(await zip.generateAsync({type:'nodebuffer'}));
 expect(parsed.sections[0].html).toContain('空格版本正文');
 const opf=await zip.file('OPS/book.opf')!.async('string');
 zip.file('OPS/book.opf',opf.replaceAll('chapter%20one.xhtml','chapter%2520one.xhtml'));
 const literal=await parseWithFoliate(await zip.generateAsync({type:'nodebuffer'}));
 expect(literal.sections[0].html).toContain('第二段');
},10000);

it('worker 入口必须是 Node 原生解析出的磁盘绝对路径，拒绝构建器虚拟模块ID', () => {
 expect(path.isAbsolute(resolveFoliateJsdomEntry())).toBe(true);
 expect(() => resolveFoliateJsdomEntry({ resolve: () => 32325 })).toThrow('绝对文件路径');
 expect(() => resolveFoliateJsdomEntry({ resolve: () => 'jsdom' })).toThrow('绝对文件路径');
 const entry = path.resolve('node_modules/jsdom/lib/api.js');
 expect(resolveFoliateJsdomEntry({ resolve(specifier) { expect(specifier).toBe('jsdom'); return entry; } })).toBe(entry);
});

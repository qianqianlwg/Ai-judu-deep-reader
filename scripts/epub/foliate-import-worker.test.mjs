import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import JSZip from 'jszip';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
async function fixture(){const z=new JSZip();z.file('mimetype','application/epub+zip');z.file('META-INF/container.xml','<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');z.file('book.opf','<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>原书</dc:title></metadata><manifest><item id="c" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>');z.file('chapter.xhtml','<html xmlns="http://www.w3.org/1999/xhtml"><body><p>正文</p><script>throw new Error("不得执行")</script></body></html>');return z.generateAsync({type:'nodebuffer'});}
test('上游worker解析spine但不执行书内脚本，也不造目录',async()=>{const bytes=await fixture();const output=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/epub/foliate-import-worker.mjs',require.resolve('jsdom')],{windowsHide:true});const chunks=[];child.on('error',reject);child.stdout.on('data',c=>chunks.push(c));child.on('close',code=>code?reject(Error('worker '+code)):resolve(JSON.parse(Buffer.concat(chunks))));child.stdin.end(bytes);});assert.equal(output.title,'原书');assert.equal(output.sections.length,1);assert.deepEqual(output.navigation,[]);});

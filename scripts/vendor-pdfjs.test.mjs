import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'node_modules','pdfjs-dist'),target=path.join(root,'public','vendor','pdfjs');
async function equalBytes(original,vendored){assert.deepEqual(await readFile(vendored),await readFile(original),vendored);}
async function compareTree(original,vendored){let files=0;for(const entry of await readdir(original,{withFileTypes:true})){const a=path.join(original,entry.name),b=path.join(vendored,entry.name);if(entry.isDirectory())files+=await compareTree(a,b);else if(entry.isFile()){await equalBytes(a,b);files++;}}return files;}
test('离线PDF.js清单与固定安装版本一致',async()=>{const pkg=JSON.parse(await readFile(path.join(source,'package.json'),'utf8')),manifest=JSON.parse(await readFile(path.join(target,'version.json'),'utf8'));assert.equal(pkg.version,'5.4.296');assert.deepEqual(manifest,{name:'pdfjs-dist',version:pkg.version,source:'npm:pdfjs-dist@'+pkg.version,license:'Apache-2.0'});});
test('worker与Apache许可逐字节一致，没有经过补丁',async()=>{await equalBytes(path.join(source,'build','pdf.worker.min.mjs'),path.join(target,'pdf.worker.min.mjs'));await equalBytes(path.join(source,'LICENSE'),path.join(target,'LICENSE'));});
test('CMap、标准字体、wasm、ICC和图标均来自同一安装包',async()=>{let files=0;for(const name of ['cmaps','standard_fonts','wasm','iccs'])files+=await compareTree(path.join(source,name),path.join(target,name));files+=await compareTree(path.join(source,'web','images'),path.join(target,'images'));assert.ok(files>100);});

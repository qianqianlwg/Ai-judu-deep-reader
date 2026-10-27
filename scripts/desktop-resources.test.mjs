import test from'node:test';import assert from'node:assert/strict';import{mkdtemp,mkdir,writeFile,readFile,rm}from'node:fs/promises';import path from'node:path';import os from'node:os';
import{copyDesktopResources}from'./desktop-resources.mjs';import{requiredReleaseFiles,inventoryRelease}from'./release-manifest.mjs';
test('成品核心保留依赖src、类型、许可证及完整原清单',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'judu-desktop-resources-'));t.after(()=>rm(root,{recursive:true,force:true}));const core=path.join(root,'core'),node=path.join(root,'node');
 for(const name of [...requiredReleaseFiles('.next-core'),'.next-core/static/test.js','node_modules/pkg/src/index.js','node_modules/pkg/index.d.ts','node_modules/pkg/LICENSE']){const f=path.join(core,name);await mkdir(path.dirname(f),{recursive:true});await writeFile(f,'fixture');}
 const files=await inventoryRelease(core);const manifest={schemaVersion:1,distDir:'.next-core',sourceRevision:'fixture',lockSha256:'a'.repeat(64),platform:'win32',architecture:'x64',nodeVersion:process.version,files,totalBytes:files.reduce((n,f)=>n+f.bytes,0)};
 await writeFile(path.join(core,'release-manifest.json'),JSON.stringify(manifest));await mkdir(node);for(const name of ['node.exe','LICENSE','README.md'])await writeFile(path.join(node,name),name);
 const appOutDir=path.join(root,'out');await copyDesktopResources({appOutDir,core,node});assert.equal(await readFile(path.join(appOutDir,'resources','app-core','node_modules/pkg/src/index.js'),'utf8'),'fixture');assert.equal(await readFile(path.join(appOutDir,'resources','node','LICENSE'),'utf8'),'LICENSE');
});

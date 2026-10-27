// @ts-check
import path from'node:path';import{mkdir,copyFile}from'node:fs/promises';
import{copyReleaseTree}from'./package-release.mjs';import{verifyRelease}from'./release-manifest.mjs';
/** @param {{appOutDir:string;core:string;node:string}} options */
export async function copyDesktopResources(options){
 await verifyRelease(options.core);
 const target=path.join(options.appOutDir,'resources','app-core');
 // WHY：Electron构建器的默认node_modules过滤不能再次裁剪已验证的standalone闭包；逐字复制再校验，不重写清单。
 await copyReleaseTree(options.core,target);await verifyRelease(target);
 const runtime=path.join(options.appOutDir,'resources','node');await mkdir(runtime,{recursive:true});
 for(const name of ['node.exe','LICENSE','README.md'])await copyFile(path.join(options.node,name),path.join(runtime,name));
}

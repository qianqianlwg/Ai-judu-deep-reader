// @ts-check
import{mkdir,readFile,writeFile,lstat}from'node:fs/promises';import path from'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';import{runReleaseCommand}from'./build-release.mjs';
/** @param {string} root */
export async function buildDesktopGuard(root){
 if(process.platform!=='win32')throw new Error('Windows守护程序仅在Windows构建');
 const source=path.join(root,'desktop','windows-job.cs');const hash=createHash('sha256').update(await readFile(source)).digest('hex');
 const dir=path.join(root,'build','desktop-tools',hash);const file=path.join(dir,'JuduJobGuard.exe');
 try{await lstat(file);return file;}catch(e){if(!(e instanceof Error&&'code'in e&&e.code==='ENOENT'))throw e;}
 await mkdir(dir,{recursive:true});
 const compiler=path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 // WHY：仅构建机调用系统C#编译器；成品带exe，不在用户机器执行ps1、不要求修改脚本策略或安装编译器。
 await runReleaseCommand(compiler,['/nologo','/target:exe','/platform:x64','/optimize+','/out:'+file,source],{cwd:root,env:process.env});
 await writeFile(path.join(root,'build','desktop-tools','guard-location.json'),JSON.stringify({file,sourceSha256:hash}));return file;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await buildDesktopGuard(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')));

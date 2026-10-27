// @ts-check
import {mkdir,readFile,writeFile,copyFile,readdir}from'node:fs/promises';
import path from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';import{createHash}from'node:crypto';
import {execFile}from'node:child_process';import{promisify}from'node:util';
import{buildDesktopGuard}from'./build-desktop-guard.mjs';
import{runReleaseCommand}from'./build-release.mjs';
const VERSION='24.22.1';
/** @param {string} url */
async function download(url){const response=await fetch(url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error('下载失败 HTTP '+response.status);return Buffer.from(await response.arrayBuffer());}
/** @param {string} root */
export async function provisionWindowsNode(root){
 if(process.platform!=='win32'||process.arch!=='x64')throw new Error('只支持Windows x64打包');
 const directory=path.join(root,'build','runtime','node-v'+VERSION+'-win-x64');
 const evidence=directory+'.verified.json';
 try{const saved=JSON.parse(await readFile(evidence,'utf8'));const hash=createHash('sha256').update(await readFile(path.join(directory,'node.exe'))).digest('hex');if(saved.executableSha256!==hash||saved.version!==VERSION)throw new Error('缓存Node校验失败');return directory;}
 catch(e){if(!(e instanceof Error&&'code'in e&&e.code==='ENOENT'))throw e;}
 await mkdir(path.dirname(directory),{recursive:true});
 const file='node-v'+VERSION+'-win-x64.zip';const base='https://nodejs.org/dist/v'+VERSION+'/';
 const sums=(await download(base+'SHASUMS256.txt')).toString('utf8');const expected=sums.split('\n').find(line=>line.endsWith('  '+file))?.split(' ')[0];
 if(!expected||!/^[a-f0-9]{64}$/.test(expected))throw new Error('官方Node校验清单缺少目标');
 const zip=path.join(path.dirname(directory),file);
 let bytes;try{bytes=await readFile(zip);}catch(e){if(!(e instanceof Error&&'code'in e&&e.code==='ENOENT'))throw e;bytes=await download(base+file);await writeFile(zip,bytes,{flag:'wx'});}
 const actual=createHash('sha256').update(bytes).digest('hex');if(actual!==expected)throw new Error('Node官方哈希不匹配');
 await runReleaseCommand('tar.exe',['-xf',zip,'-C',path.dirname(directory)],{cwd:root,env:process.env});
 await writeFile(evidence,JSON.stringify({version:VERSION,url:base+file,zipSha256:actual,officialChecksums:base+'SHASUMS256.txt',executableSha256:createHash('sha256').update(await readFile(path.join(directory,'node.exe'))).digest('hex')},null,2));
 return directory;
}
/** @param {{root:string;stagedApp:string;core:string;node:string;output:string;version:string;afterPack?:string}} options */
export function windowsBuilderConfig(options){
 if(!/^\d+\.\d+\.\d+$/.test(options.version))throw new Error('版本号无效');
 return {appId:'cn.judu.reader.desktop.preview',productName:'Judu Reader',directories:{app:options.stagedApp,output:options.output},
  compression:'normal',electronVersion:'45.0.0',electronDist:path.join(options.root,'node_modules','electron','dist'),asar:false,npmRebuild:false,
  files:['**/*'],extraResources:[],afterPack:options.afterPack,
  win:{target:[{target:'nsis',arch:['x64']}],signAndEditExecutable:false},
  nsis:{oneClick:false,perMachine:false,allowElevation:false,allowToChangeInstallationDirectory:true,deleteAppDataOnUninstall:false,runAfterFinish:false,createDesktopShortcut:false,createStartMenuShortcut:false},
  artifactName:'Judu-Reader-${version}-win-x64-setup.${ext}',publish:null};
}
/** @param {{root:string;core:string;output:string;version:string}} options */
export async function buildWindowsDesktop(options){
 const {verifyRelease}=await import('./release-manifest.mjs');const manifest=await verifyRelease(options.core);
 if(manifest.platform!=='win32'||manifest.architecture!=='x64')throw new Error('运行核心不是Windows x64');
 const output=path.resolve(options.output);if(!output.startsWith(path.join(options.root,'build')+path.sep))throw new Error('安装包只能输出到build下');
 await mkdir(output,{recursive:false});
 const stagedApp=path.join(output,'application');await mkdir(path.join(stagedApp,'desktop'),{recursive:true});await mkdir(path.join(stagedApp,'src','lib'),{recursive:true});
 for(const file of await readdir(path.join(options.root,'desktop'))){
  if(file.endsWith('.test.mjs')||!(/\.(mjs|html|css|ps1)$/.test(file)))continue;
  await copyFile(path.join(options.root,'desktop',file),path.join(stagedApp,'desktop',file));
 }
 await copyFile(await buildDesktopGuard(options.root),path.join(stagedApp,'desktop','JuduJobGuard.exe'));
 await copyFile(path.join(options.root,'src','lib','desktop-secret-codec.mjs'),path.join(stagedApp,'src','lib','desktop-secret-codec.mjs'));
 await writeFile(path.join(stagedApp,'package.json'),JSON.stringify({name:'judu-reader-desktop',version:options.version,description:'句读阅读器 Windows 本地内测客户端',author:'Judu',main:'desktop/main.mjs',type:'module',private:true}));
 await writeFile(path.join(stagedApp,'package-lock.json'),JSON.stringify({name:'judu-reader-desktop',version:options.version,lockfileVersion:3,packages:{'':{name:'judu-reader-desktop',version:options.version}}}));
 await mkdir(path.join(stagedApp,'node_modules'));
 const node=await provisionWindowsNode(options.root);
 const hook=path.join(output,'copy-verified-core.cjs');
 const moduleUrl=pathToFileURL(path.join(options.root,'scripts','desktop-resources.mjs')).href;
 await writeFile(hook,'module.exports=async context=>{const {copyDesktopResources}=await import('+JSON.stringify(moduleUrl)+');await copyDesktopResources({appOutDir:context.appOutDir,core:'+JSON.stringify(options.core)+',node:'+JSON.stringify(node)+'});};');
 const config=windowsBuilderConfig({...options,output,stagedApp,node,afterPack:hook});
 const file=path.join(output,'builder.json');await writeFile(file,JSON.stringify(config,null,2));
 await runReleaseCommand(process.execPath,[path.join(options.root,'node_modules','electron-builder','cli.js'),'--projectDir',stagedApp,'--win','--x64','--config',file],{cwd:options.root,env:process.env});
 const artifacts=[];
 for(const name of await readdir(output)){if(!name.endsWith('.exe'))continue;const bytes=await readFile(path.join(output,name));artifacts.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
 if(!artifacts.length)throw new Error('未生成Windows安装器');
 const desktopSourceRevision=(await promisify(execFile)('git',['rev-parse','HEAD'],{cwd:options.root})).stdout.trim();
 await writeFile(path.join(output,'desktop-artifacts.json'),JSON.stringify({desktopSourceRevision,version:options.version,unsigned:true,nodeVersion:VERSION,electronVersion:'45.0.0',coreSourceRevision:manifest.sourceRevision,artifacts},null,2));
 return artifacts;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const args=process.argv.slice(2);const argument=/** @param {string} name */ name=>{const value=args[args.indexOf(name)+1];if(!args.includes(name)||!value)throw new Error('缺少'+name);return value;};
 await buildWindowsDesktop({root,core:path.resolve(argument('--core')),output:path.resolve(argument('--output')),version:argument('--version')});
}

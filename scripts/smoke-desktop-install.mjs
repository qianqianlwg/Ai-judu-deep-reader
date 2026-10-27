// @ts-check
import{spawn}from'node:child_process';import{readFile,writeFile,mkdtemp,lstat,rm,readdir}from'node:fs/promises';import{createHash}from'node:crypto';import{setTimeout as delay}from'node:timers/promises';import path from'node:path';import os from'node:os';import{fileURLToPath}from'node:url';import assert from'node:assert/strict';
import{runReleaseCommand}from'./build-release.mjs';import{unusedLoopbackPort}from'../desktop/server.mjs';
/** @param {string} root @param {string} target */
export function assertTestDirectory(root,target){if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('句读客户端 验收-')||!path.resolve(target).startsWith(root+path.sep))throw new Error('安装验收路径越界');}
/** @param {string} executable @param {string[]} args @param {{env?:NodeJS.ProcessEnv;verbatim?:boolean}} [options] */
async function run(executable,args,options={}){
 return await new Promise((resolve,reject)=>{const child=spawn(executable,args,{windowsHide:true,windowsVerbatimArguments:options.verbatim,env:options.env??process.env,stdio:['ignore','pipe','pipe']});let text='';child.stdout.on('data',chunk=>{text+=String(chunk);});child.stderr.on('data',chunk=>{text+=String(chunk);});child.once('error',reject);child.once('exit',code=>code===0?resolve(text):reject(new Error('验收命令失败 '+code+': '+text)));});
}
/** @param {()=>Promise<boolean>} check */
async function waitFor(check){const deadline=Date.now()+45000;while(Date.now()<deadline){if(await check())return;await delay(200);}throw new Error('安装验收等待超时');}
/** @param {string} directory */
async function filesDigest(directory){
 /** @type {{path:string;sha256:string}[]} */const result=[];
 /** @param {string} relative */async function walk(relative){for(const entry of await readdir(path.join(directory,relative),{withFileTypes:true})){const rel=path.join(relative,entry.name);if(entry.isDirectory())await walk(rel);else if(entry.isFile())result.push({path:rel,sha256:createHash('sha256').update(await readFile(path.join(directory,rel))).digest('hex')});else throw new Error('测试书库包含链接');}}
 await walk('');return result.sort((a,b)=>a.path.localeCompare(b.path));
}
/** @param {{installer:string;upgradeInstaller?:string;report:string;repository:string}} options */
export async function smokeDesktopInstall(options){
 const root=await mkdtemp(path.join(os.tmpdir(),'句读客户端 验收-'));const install=path.join(root,'程序 空格');const retained=path.join(root,'acceptance');
 assertTestDirectory(root,install);
 const artifacts=path.join(options.repository,'build','desktop-installed-e2e');
 let installed=false,denied=false;
 /** @type {import('node:child_process').ChildProcess|undefined} */let active;
 let sid='';
 async function uninstall(){
  const executable=path.join(install,'Uninstall Judu Reader.exe');await lstat(executable);
  await run(executable,['/S']);
  await waitFor(async()=>{try{await lstat(path.join(install,'Judu Reader.exe'));return false;}catch(e){if(e instanceof Error&&'code'in e&&e.code==='ENOENT')return true;throw e;}});installed=false;
 }
 try{
  // WHY：NSIS /D必须是末尾的原始参数（支持空格）；只运行本任务生成的每用户安装器，不提权。
  await run(options.installer,['/S','/D='+install],{verbatim:true});installed=true;await lstat(path.join(install,'Judu Reader.exe'));
  const env={...process.env,JUDU_DESKTOP_E2E_RELEASE_DIR:path.join(install,'resources','app-core'),JUDU_DESKTOP_E2E_EXECUTABLE:path.join(install,'Judu Reader.exe'),JUDU_DESKTOP_E2E_ARTIFACTS:artifacts,JUDU_DESKTOP_E2E_KEEP_DIR:retained,JUDU_DESKTOP_E2E_PATH_ISOLATED:'1'};
  await runReleaseCommand(process.execPath,['--test',path.join(options.repository,'desktop','main.test.mjs')],{cwd:options.repository,env});
  const library=path.join(retained,'library');const before=await filesDigest(library);
  if(options.upgradeInstaller){await run(options.upgradeInstaller,['/S','/D='+install],{verbatim:true});assert.deepEqual(await filesDigest(library),before);}
  else {await run(options.installer,['/S','/D='+install],{verbatim:true});assert.deepEqual(await filesDigest(library),before);}
  await runReleaseCommand(process.execPath,['--test',path.join(options.repository,'desktop','main.test.mjs')],{cwd:options.repository,env:{...env,JUDU_DESKTOP_E2E_KEEP_DIR:path.join(root,'final-acceptance'),JUDU_DESKTOP_E2E_STABLE_ORIGIN:'1'}});
  const identity=String(await run('whoami.exe',['/user','/fo','csv','/nh']));sid=identity.match(/S-1-(?:\d+-)*\d+/)?.[0]??'';if(!sid)throw new Error('无法确认验收账户SID');
  await run('icacls.exe',[install,'/deny','*'+sid+':(OI)(CI)(WD,AD,WEA,WA)']);denied=true;
  await assert.rejects(writeFile(path.join(install,'write-must-fail.tmp'),'blocked'));
  const debugPort=await unusedLoopbackPort();const profile=path.join(retained,'profile');const start=new Date().toISOString();
  /** @type {NodeJS.ProcessEnv} */const isolatedEnv={...process.env};delete isolatedEnv.Path;delete isolatedEnv.PATH;isolatedEnv.Path=path.join(process.env.SystemRoot||'C:\\Windows','System32');delete isolatedEnv.ELECTRON_RUN_AS_NODE;delete isolatedEnv.NODE_OPTIONS;delete isolatedEnv.NODE_PATH;
  active=spawn(path.join(install,'Judu Reader.exe'),['--profile-dir='+profile,'--remote-debugging-port='+debugPort,'--remote-debugging-address=127.0.0.1'],{windowsHide:true,env:isolatedEnv,stdio:'ignore'});
  let port=0,pid=0;
  await waitFor(async()=>{
   if(active?.exitCode!==null)throw new Error('升级后客户端提前退出');
   const events=(await readFile(path.join(profile,'desktop-events.log'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));const latest=events.findLast(event=>event.event==='started'&&event.at>=start);if(!latest)return false;port=latest.port;pid=latest.pid;return true;
  });
  const actual=String(await run('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); (Get-Process -Id '+pid+').Path'])).trim();assert.equal(actual.toLowerCase(),path.join(install,'resources','node','node.exe').toLowerCase());
  const origin='http://127.0.0.1:'+port;assert.equal((await fetch(origin+'/api/books')).status,200);assert.equal((await(await fetch(origin+'/api/settings/ai')).json()).hasApiKey,true);
  // WHY：仅杀主进程而非/T，真实验证父进程崩溃后的Job关闭和后台清理，不用测试清理代替产品能力。
  const ownedPid=active.pid;assert.ok(ownedPid);await run('taskkill.exe',['/PID',String(ownedPid),'/F']);
  await waitFor(async()=>{try{const probe=await import('node:net').then(({createServer})=>createServer());await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>resolve(undefined));});await new Promise(resolve=>probe.close(resolve));return true;}catch(error){if(error instanceof Error&&'code'in error&&error.code==='EADDRINUSE')return false;throw error;}});
  assert.throws(()=>process.kill(pid,0));const probe=await import('node:net').then(({createServer})=>createServer());await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(debugPort,'127.0.0.1',()=>resolve(undefined));});await new Promise(resolve=>probe.close(resolve));active=undefined;
  await run('icacls.exe',[install,'/remove:d','*'+sid,'/T','/C']);denied=false;
  const afterCrash=await filesDigest(library);await uninstall();assert.deepEqual(await filesDigest(library),afterCrash);
  const report={installer:options.installer,upgradeInstaller:options.upgradeInstaller??options.installer,installedWithoutElevation:true,chineseAndSpacePath:true,externalLibraryPreservedOnUpgrade:true,externalLibraryPreservedOnUninstall:true,readOnlyInstallationConfirmed:true,bundledNodePathConfirmed:true,systemNodeNotOnPath:true,abruptMainExitReleasedBackend:true,ports:[port,debugPort],notCleanSecondMachine:true,realModelCalled:false};
  await writeFile(options.report,JSON.stringify(report,null,2));return report;
 }finally{
  if(active?.pid&&active.exitCode===null)await run('taskkill.exe',['/PID',String(active.pid),'/T','/F']);
  if(denied)await run('icacls.exe',[install,'/remove:d','*'+sid,'/T','/C']);
  if(installed)await uninstall();
  assertTestDirectory(root,install);if(path.dirname(root)!==path.resolve(os.tmpdir()))throw new Error('临时根越界');await rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:250});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);const value=/** @param {string} name */ name=>{const i=args.indexOf(name);if(i<0||!args[i+1])throw new Error('缺少'+name);return path.resolve(args[i+1]);};
 console.log(await smokeDesktopInstall({installer:value('--installer'),report:value('--report'),repository:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),...(args.includes('--upgrade')?{upgradeInstaller:value('--upgrade')}:{})}));
}

import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {unlockLibraryKey} from './vault.mjs';
test('vault重启复用，缺密钥及无法解密失败关闭',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'judu-vault-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const fake={isAsyncEncryptionAvailable:async()=>true,encryptStringAsync:async v=>Buffer.from(v),decryptStringAsync:async v=>({result:v.toString(),shouldReEncrypt:false})};
 const key=await unlockLibraryKey(dir,fake);assert.deepEqual(await unlockLibraryKey(dir,fake),key);
 await assert.rejects(unlockLibraryKey(dir,{...fake,isAsyncEncryptionAvailable:async()=>false}));
 await rm(path.join(dir,'desktop-vault.bin'));await writeFile(path.join(dir,'desktop-library.json'),'{}');
 await assert.rejects(unlockLibraryKey(dir,fake),/密钥缺失/);
});

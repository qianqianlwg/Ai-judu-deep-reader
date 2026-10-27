// @ts-check
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
/** @param {string} directory @param {Pick<import('electron').SafeStorage,'isAsyncEncryptionAvailable'|'encryptStringAsync'|'decryptStringAsync'>} storage */
export async function unlockLibraryKey(directory, storage) {
 if (!await storage.isAsyncEncryptionAvailable()) throw new Error('Windows 保护存储不可用，拒绝明文保存密钥');
 const file=path.join(directory,'desktop-vault.bin');
 try {
  if (!(await lstat(file)).isFile() || (await lstat(file)).isSymbolicLink()) throw new Error('凭据文件不是普通文件');
  const {result}=await storage.decryptStringAsync(await readFile(file));
  const key=Buffer.from(result,'base64'); if(key.length!==32)throw new Error('凭据文件已损坏');
  return key;
 } catch(error) {
  if (!(error instanceof Error && 'code' in error && error.code==='ENOENT')) throw new Error('无法解锁 Windows 书库凭据，请保留备份并使用原 Windows 账户');
  // WHY：有客户端标记却没有密钥时必须报错，不能生成新密钥覆盖原密钥关系。
  try {await lstat(path.join(directory,'desktop-library.json'));throw new Error('书库密钥缺失，不能自动重建');}
  catch(missing){if(!(missing instanceof Error&&'code' in missing&&missing.code==='ENOENT'))throw missing;}
  const key=randomBytes(32);const encrypted=await storage.encryptStringAsync(key.toString('base64'));
  await writeFile(file,encrypted,{flag:'wx',mode:0o600});return key;
 }
}

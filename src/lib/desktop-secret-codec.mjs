// @ts-check
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export const SECRET_PREFIX = 'judu-dpapi-v1:';
const slot = Symbol.for('judu.desktop.secret-key.v1');
/** @param {Buffer} key */
export function installSecretKey(key) {
  if (key.length !== 32) throw new Error('桌面密钥长度无效');
  Reflect.set(globalThis, slot, Buffer.from(key));
}
function masterKey() {
  /** @type {unknown} */ const key = Reflect.get(globalThis, slot);
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Windows 密钥尚未解锁，拒绝读取或保存凭据');
  return key;
}
/** @param {string} value */
export function sealSecret(value) {
  if (!value || !process.env.JUDU_DESKTOP_TOKEN) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  cipher.setAAD(Buffer.from(SECRET_PREFIX));
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return SECRET_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64');
}
/** @param {string} value */
export function openSecret(value) {
  if (!value.startsWith(SECRET_PREFIX)) {
    // WHY：桌面迁移必须在服务启动前完成；遗留明文不能通过业务读取被悄悄继续使用。
    if (value && process.env.JUDU_DESKTOP_TOKEN) throw new Error('书库存在未迁移凭据，请重新打开客户端');
    return value;
  }
  try {
    const bytes = Buffer.from(value.slice(SECRET_PREFIX.length), 'base64');
    if (bytes.length < 28) throw new Error('invalid');
    const decipher = createDecipheriv('aes-256-gcm', masterKey(), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(SECRET_PREFIX));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  } catch { throw new Error('无法解锁书库凭据，请使用原 Windows 账户和完整书库备份'); }
}

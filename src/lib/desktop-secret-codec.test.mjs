import test from 'node:test';
import assert from 'node:assert/strict';
import { installSecretKey, sealSecret, openSecret, SECRET_PREFIX } from './desktop-secret-codec.mjs';
test('Web保持兼容；桌面随机认证加密、篡改与错误账户拒绝', () => {
 const old = process.env.JUDU_DESKTOP_TOKEN;
 try {
  delete process.env.JUDU_DESKTOP_TOKEN; assert.equal(sealSecret('test-key'),'test-key');
  process.env.JUDU_DESKTOP_TOKEN='test'; installSecretKey(Buffer.alloc(32,7));
  const a=sealSecret('假密钥-1234'); assert.ok(a.startsWith(SECRET_PREFIX));
  assert.notEqual(a,sealSecret('假密钥-1234')); assert.equal(openSecret(a),'假密钥-1234');
  assert.throws(()=>openSecret('plaintext')); assert.throws(()=>openSecret(SECRET_PREFIX+'broken'));
  installSecretKey(Buffer.alloc(32,8)); assert.throws(()=>openSecret(a));
 } finally {if(old===undefined)delete process.env.JUDU_DESKTOP_TOKEN;else process.env.JUDU_DESKTOP_TOKEN=old;}
});

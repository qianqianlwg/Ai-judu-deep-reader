import { describe,it,expect } from 'vitest';
import { sealSecret,openSecret } from './secret-storage';
describe('Web密钥兼容边界',()=>{it('非桌面保持原持久化语义',()=>{expect(openSecret(sealSecret('fake-key'))).toBe('fake-key');});});

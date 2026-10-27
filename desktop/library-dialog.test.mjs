import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
test('书库接入仅经原生对话框，源复制不删除',async()=>{const source=await readFile(new URL('./library-dialog.mjs',import.meta.url),'utf8');assert.match(source,/复制不会删除原书库/);assert.ok(!source.includes('rm('));});

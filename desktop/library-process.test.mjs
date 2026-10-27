import test from 'node:test';import assert from 'node:assert/strict';import {runLibraryOperation}from'./library-process.mjs';
test('IPC操作不存在的书库不能假成功',async()=>{await assert.rejects(runLibraryOperation(process.execPath,{operation:'prepare',directory:'Z:\\judu-nonexistent-2026'},Buffer.alloc(32)));});

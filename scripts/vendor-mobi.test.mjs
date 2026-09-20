import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
test('固定MOBI候选源码、许可和provenance可再生成', async () => {
  const provenance = JSON.parse(await readFile(path.join(root, 'vendor/mobi/PROVENANCE.json'), 'utf8'));
  assert.equal(provenance.package, '@lingo-reader/mobi-parser');
  assert.equal(provenance.version, '0.4.6');
  assert.equal(provenance.license, 'MIT');
  assert.deepEqual(provenance.patches, ['absent-EXTH', 'single-flow-KF8-FDST', 'bounded-raw-flow', 'last-MOBI-byte-range', 'body-tag-attributes', 'exclusive-resource-write', 'zero-cover-offset', 'optional-image-recindex', 'preserve-layout-head', 'bounded-resource-write','stable-resource-ids','semantic-resource-rewrite','source-byte-ranges']);
  assert.ok((await readFile(path.join(root, 'vendor/mobi/LICENSE'))).length > 500);
});

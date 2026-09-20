import {expect, it} from 'vitest';
import {
  createMobiResourceGraph,
  resolveMobiResourceReference,
} from './mobi-resource-graph.mjs';

type Role = 'image' | 'style' | 'css' | 'media';
type Resource = {id: string; mediaType: string; bytes: Uint8Array};
type Resolve = (value: string, role: Role) => Promise<string | null>;
type Transform = (resource: Resource, resolve: Resolve) => Promise<Uint8Array>;
type Dependency = {ref: string; role: Role};

const resourceId = (name: string, extension = 'css') => `mobi-resource-v1/${name}.${extension}`;
const resource = (id: string, mediaType = 'text/css', value = id): Resource => ({
  id,
  mediaType,
  bytes: new TextEncoder().encode(value),
});
const identityTransform: Transform = async (value) => new Uint8Array(value.bytes);

it('只允许受控包内路径，并保留规范化后的片段', () => {
  expect(resolveMobiResourceReference('./part.css#section%201', resourceId('main'))).toEqual({
    id: resourceId('part'),
    fragment: '#section%201',
  });
  expect(resolveMobiResourceReference('mobi-resource-v1/part.css#section%201')).toEqual({
    id: resourceId('part'),
    fragment: '#section%201',
  });
  expect(resolveMobiResourceReference('#local%20target', resourceId('main'))).toEqual({
    id: '',
    fragment: '#local%20target',
  });
  expect(resolveMobiResourceReference('../part.css', resourceId('main'))).toEqual({
    blocked: 'path-traversal',
  });
  expect(resolveMobiResourceReference('./nested/part.css', resourceId('main'))).toEqual({
    blocked: 'path-traversal',
  });
  expect(resolveMobiResourceReference('https://example.test/part.css', resourceId('main'))).toEqual({
    blocked: 'external-or-unsafe-path',
  });
  expect(resolveMobiResourceReference('./part.css', null)).toEqual({
    blocked: 'relative-without-origin',
  });
});

it('图中的相对引用进入同一包资源，外链被阻断并留下诊断', async () => {
  const main = resourceId('main');
  const part = resourceId('part');
  const graph = createMobiResourceGraph([resource(main), resource(part)]);
  const seen: string[] = [];
  const result = await graph.process([{ref: main, role: 'style'}], async (value, resolve) => {
    if (value.id === main) {
      seen.push((await resolve('./part.css#section%201', 'style')) ?? '');
      expect(await resolve('https://example.test/part.css', 'style')).toBeNull();
      expect(await resolve('#local', 'image')).toBe('#local');
    }
    return new Uint8Array(value.bytes);
  });

  expect(seen).toEqual([`${part}#section%201`]);
  expect(result.resources.map((value) => value.id)).toEqual([main, part].sort());
  expect(result.edges).toEqual([{from: main, to: part}]);
  expect(result.diagnostics).toContainEqual({
    base: main,
    value: 'https://example.test/part.css',
    reason: 'external-or-unsafe-path',
  });
});

it('按引用角色限制资源类型，不把角色校验交给转换器', async () => {
  const sheet = resourceId('sheet');
  const image = resourceId('cover', 'png');
  const font = resourceId('font', 'woff');
  const audio = resourceId('audio', 'mp3');
  const resources = [
    resource(sheet, 'text/css'),
    resource(image, 'image/png'),
    resource(font, 'font/woff'),
    resource(audio, 'audio/mpeg'),
  ];

  await expect(createMobiResourceGraph(resources).process([{ref: sheet, role: 'image'}], identityTransform))
    .rejects.toThrow('角色与类型不符');
  await expect(createMobiResourceGraph(resources).process([{ref: image, role: 'media'}], identityTransform))
    .rejects.toThrow('角色与类型不符');
  await expect(createMobiResourceGraph(resources).process([{ref: font, role: 'css'}], identityTransform))
    .resolves.toMatchObject({resources: [{id: font}]});
  await expect(createMobiResourceGraph(resources).process([{ref: audio, role: 'media'}], identityTransform))
    .resolves.toMatchObject({resources: [{id: audio}]});
});

it('检测已登记边图中的循环引用', async () => {
  const first = resourceId('first');
  const second = resourceId('second');
  const graph = createMobiResourceGraph([resource(first), resource(second)]);
  const dependencies: Record<string, Dependency[]> = {
    [first]: [{ref: second, role: 'style'}],
    [second]: [{ref: first, role: 'style'}],
  };
  const transform: Transform = async (value, resolve) => {
    for (const dependency of dependencies[value.id] ?? []) await resolve(dependency.ref, dependency.role);
    return new Uint8Array(value.bytes);
  };

  await expect(graph.process([{ref: first, role: 'style'}], transform)).rejects.toThrow('循环引用');
});

it('重复入口只转换一次，并返回每个入口的引用', async () => {
  const id = resourceId('shared');
  const calls = new Map<string, number>();
  const graph = createMobiResourceGraph([resource(id)]);
  const transform: Transform = async (value) => {
    calls.set(value.id, (calls.get(value.id) ?? 0) + 1);
    return new Uint8Array(value.bytes);
  };
  const result = await graph.process([
    {ref: id, role: 'style'},
    {ref: id, role: 'style'},
  ], transform);

  expect(calls.get(id)).toBe(1);
  expect(result.references).toEqual([id, id]);
  expect(result.resources).toHaveLength(1);
});

it('复制输入和输出字节，调用方修改原缓冲区不会污染图', async () => {
  const id = resourceId('copied');
  const source = new Uint8Array([1, 2, 3]);
  const original: Resource = {id, mediaType: 'text/css', bytes: source};
  const graph = createMobiResourceGraph([original]);
  source[0] = 9;
  const produced: Uint8Array[] = [];
  const transform: Transform = async (value) => {
    expect(value.bytes[0]).toBe(1);
    value.bytes[1] = 8;
    const output = new Uint8Array(value.bytes);
    produced.push(output);
    return output;
  };

  const result = await graph.process([{ref: id, role: 'style'}], transform);
  produced[0]![0] = 7;
  expect([...result.resources[0]!.bytes]).toEqual([1, 8, 3]);
  expect([...original.bytes]).toEqual([9, 2, 3]);
});

it('转换失败时不发布半图，失败后的同一图实例仍可重新处理', async () => {
  const first = resourceId('first');
  const second = resourceId('second');
  const graph = createMobiResourceGraph([resource(first), resource(second)]);
  const failing: Transform = async (value, resolve) => {
    if (value.id === first) await resolve(second, 'style');
    if (value.id === second) throw new Error('转换失败');
    return new Uint8Array(value.bytes);
  };
  let published: unknown;
  const attempt = graph.process([{ref: first, role: 'style'}], failing).then((value) => {
    published = value;
    return value;
  });

  await expect(attempt).rejects.toThrow('转换失败');
  expect(published).toBeUndefined();
  const successful: Transform = async (value, resolve) => {
    if (value.id === first) await resolve(second, 'style');
    return new Uint8Array(value.bytes);
  };
  const retry = await graph.process([{ref: first, role: 'style'}], successful);
  expect(retry.resources.map((value) => value.id)).toEqual([first, second].sort());
});

function chainFixture(count: number): {ids: string[]; resources: Resource[]; transform: Transform} {
  const ids = Array.from({length: count}, (_, index) => resourceId(`node-${index}`));
  const resources = ids.map((id) => resource(id));
  const transform: Transform = async (value, resolve) => {
    const index = ids.indexOf(value.id);
    if (index >= 0 && index + 1 < ids.length) await resolve(ids[index + 1]!, 'style');
    return new Uint8Array(value.bytes);
  };
  return {ids, resources, transform};
}

it('共享尾链的根逆序不能绕过最长路径深度预算', async () => {
  const reverse = chainFixture(18);
  const reverseRoots = reverse.ids.slice().reverse().map((ref) => ({ref, role: 'style' as const}));
  await expect(createMobiResourceGraph(reverse.resources).process(reverseRoots, reverse.transform))
    .rejects.toThrow('深度超限');

  const forward = chainFixture(18);
  const forwardRoots = forward.ids.map((ref) => ({ref, role: 'style' as const}));
  await expect(createMobiResourceGraph(forward.resources).process(forwardRoots, forward.transform))
    .rejects.toThrow('深度超限');
});

it('深度边界仍允许十六条边的有效链', async () => {
  const fixture = chainFixture(17);
  const result = await createMobiResourceGraph(fixture.resources).process(
    [{ref: fixture.ids[0]!, role: 'style'}],
    fixture.transform,
  );
  expect(result.resources).toHaveLength(17);
  expect(result.edges).toHaveLength(16);
});

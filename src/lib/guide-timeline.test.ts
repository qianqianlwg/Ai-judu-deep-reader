import { expect, it } from 'vitest';
import { chronologicalGuideNodes, newestGuideNode, stampGuideTimeline } from './guide-timeline';
import { guideNodeSchema, storedGuideNodeSchema, type GuideNode } from './guide';
const node = (id: string, parentId: string | null = null): GuideNode => ({ id, parentId, title: id, summary: '', sourceIds: [] });
const time = '2026-10-01T00:00:00.000Z';
it('新增、AI补充按真实版本更新，用户改字或只调整位置不制造阅读时间', () => {
  const first = stampGuideTimeline([node('a'), node('b')], [], 1, 'ai', time);
  const positions = first.map(item => ({ ...item, position: { x: 1, y: 2 } }));
  expect(stampGuideTimeline(positions, first, 2, 'ai', time).map(item => item.timeline)).toEqual(first.map(item => item.timeline));
  const manual = stampGuideTimeline([{ ...first[0], title: '手动改名' }, first[1]], first, 3, 'user', time);
  expect(manual[0].timeline).toEqual(first[0].timeline);
  const changed = stampGuideTimeline([{ ...manual[0], summary: '新的AI释读', timeline: undefined }, manual[1]], manual, 4, 'ai', time);
  expect(changed[0].timeline?.created).toBe(first[0].timeline?.created);
  expect(changed[0].timeline!.updated).toBeGreaterThan(changed[1].timeline!.updated);
  expect(newestGuideNode(changed)?.id).toBe('a');
});
it('来源新增也算补充，来源数组重排不算新内容', () => {
  const before = stampGuideTimeline([{ ...node('a'), sourceIds: ['x', 'y'] }], [], 1, 'ai', time);
  expect(stampGuideTimeline([{ ...before[0], sourceIds: ['y', 'x'] }], before, 2, 'ai', time)[0].timeline).toEqual(before[0].timeline);
  expect(stampGuideTimeline([{ ...before[0], sourceIds: ['x', 'y', 'z'] }], before, 3, 'ai', time)[0].timeline!.updated).toBeGreaterThan(before[0].timeline!.updated);
});
it('最新深层节点的整条祖先分支排最后，同批用提交顺序，不看标题', () => {
  const first = stampGuideTimeline([node('z'), node('a'), node('old', 'z')], [], 1, 'ai', time);
  const added = stampGuideTimeline([...first, node('latest', 'z'), node('deep', 'latest')], first, 2, 'ai', time);
  const ordered = chronologicalGuideNodes(added);
  expect(ordered.filter(item => !item.parentId).map(item => item.id)).toEqual(['a', 'z']);
  expect(ordered.filter(item => item.parentId === 'z').map(item => item.id)).toEqual(['old', 'latest']);
  expect(newestGuideNode(added)?.id).toBe('deep');
  expect(added.map(item => item.id)).toEqual(['z', 'a', 'old', 'latest', 'deep']);
});
it('空图、无时间旧数据和万层树安全，不递归溢出', () => {
  expect(chronologicalGuideNodes([])).toEqual([]);expect(newestGuideNode([])).toBeUndefined();
  expect(chronologicalGuideNodes([node('z'), node('a')]).map(item => item.id)).toEqual(['z', 'a']);
  const deep = Array.from({ length: 10000 }, (_, index) => node('n' + index, index ? 'n' + (index - 1) : null));
  expect(chronologicalGuideNodes(deep)).toHaveLength(10000);
  expect(() => chronologicalGuideNodes([node('a', 'b'), node('b', 'a')])).toThrow('循环');
});
it('服务端时间可存储但不能由Agent或用户内容工具提交', () => {
  const stamped = stampGuideTimeline([node('a')], [], 1, 'ai', time)[0];
  expect(storedGuideNodeSchema.safeParse(stamped).success).toBe(true);
  expect(guideNodeSchema.safeParse(stamped).success).toBe(false);
});

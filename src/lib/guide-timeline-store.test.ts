import { afterEach, beforeEach, expect, it } from 'vitest';
import { guideFixture } from './guide-test-support';
import { readTimedGuideNodes } from './guide-timeline-store';
import { chronologicalGuideNodes } from './guide-timeline';
let fixture: ReturnType<typeof guideFixture>;
beforeEach(() => { fixture = guideFixture(); });afterEach(() => fixture.db.close());
const node = (id: string) => ({ id, parentId: null, title: id, summary: '', sourceIds: [] });
function revision(nodes: unknown[], parent: number | null, actor = 'ai') {
  fixture.db.prepare('INSERT INTO guide_revisions(book_id,parent_id,nodes_json,actor,reason,created_at) VALUES(?,?,?,?,?,?)').run('b', parent, JSON.stringify(nodes), actor, '排序回归fixture', '2026-10-01T00:00:00.000Z');
  return (fixture.db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}
it('从真实祖先版本恢复旧节点创建和AI更新时间，读取不改写历史', () => {
  const first = revision([node('z'), node('a')], null);
  const manual = revision([{ ...node('z'), position: { x: 10, y: 20 } }, node('a')], first, 'user');
  const last = revision([{ ...node('z'), summary: '新增释读' }, node('a')], manual);
  const recovered = readTimedGuideNodes(fixture.db, last);
  expect(recovered[0].timeline?.created).toBe(first * 10001);
  expect(recovered[0].timeline?.updated).toBe(last * 10001);
  expect(chronologicalGuideNodes(recovered).map(item => item.id)).toEqual(['a', 'z']);
  expect(JSON.parse((fixture.db.prepare('SELECT nodes_json FROM guide_revisions WHERE id=?').get(last) as { nodes_json: string }).nodes_json)[0]).not.toHaveProperty('timeline');
  recovered[0].summary = '不能污染缓存';expect(readTimedGuideNodes(fixture.db, last)[0].summary).toBe('新增释读');
});
it('撤销读取旧版恢复原时间线，重做恢复新版，空图与快照丢失明确反馈', () => {
  const first = revision([node('a')], null), last = revision([node('a'), node('b')], first);
  expect(readTimedGuideNodes(fixture.db, last)).toHaveLength(2);
  expect(readTimedGuideNodes(fixture.db, first)).toHaveLength(1);
  expect(readTimedGuideNodes(fixture.db, last)[1].timeline?.created).toBe(last * 10001 + 1);
  expect(readTimedGuideNodes(fixture.db, null)).toEqual([]);
  expect(() => readTimedGuideNodes(fixture.db, 100)).toThrow('丢失');
});
it('版本祖先损坏不能静默猜顺序', () => {
  const first = revision([node('a')], null);fixture.db.prepare('UPDATE guide_revisions SET parent_id=? WHERE id=?').run(first, first);
  expect(() => readTimedGuideNodes(fixture.db, first)).toThrow('循环');
});

import { describe, expect, it } from 'vitest';
import { placeOutsideSentence, type PopoverBounds } from './reader-popover-placement';
const rect = (left: number, top: number, width: number, height: number): PopoverBounds => ({ left, top, right: left+width, bottom: top+height });
const viewport = rect(0,0,1000,700), bounds = rect(100,60,650,590);
const intersects = (a: PopoverBounds,b: PopoverBounds) => a.left<b.right && b.left<a.right && a.top<b.bottom && b.top<a.bottom;
describe('概念浮窗避让当前句子', () => {
 it.each([80,250,480,590])('多行句子位于 %i 时不被卡片遮挡', top => {
  const avoid = [rect(130,top,560,24),rect(130,top+28,450,24)];
  const result = placeOutsideSentence({bounds,viewport,anchor:rect(200,top,80,24),avoid,width:320,height:180});
  expect(result).not.toBeNull();
  const card = rect(result!.left,result!.top,result!.maxWidth,result!.maxHeight);
  expect(avoid.some(line=>intersects(card,line))).toBe(false);
  expect(card.left).toBeGreaterThanOrEqual(viewport.left+12); expect(card.right).toBeLessThanOrEqual(viewport.right-12);
  expect(card.top).toBeGreaterThanOrEqual(viewport.top+12); expect(card.bottom).toBeLessThanOrEqual(viewport.bottom-12);
 });
 it('长定义缩短卡片并内部滚动，不强行夹回句子中间', () => {
  const avoid=[rect(110,230,600,190)];
  const result=placeOutsideSentence({bounds,viewport,anchor:rect(150,240,80,20),avoid,width:320,height:900});
  expect(result?.maxHeight).toBeLessThan(900);
  expect(intersects(rect(result!.left,result!.top,result!.maxWidth,result!.maxHeight),avoid[0])).toBe(false);
 });
 it('窄窗口仍避开整个句子，不只避开关键词这一行', () => {
  const viewport=rect(0,0,360,640), bounds=rect(12,60,336,520), avoid=[rect(20,210,320,24),rect(20,238,320,24),rect(20,266,180,24)];
  const result=placeOutsideSentence({bounds,viewport,anchor:rect(80,238,60,24),avoid,width:320,height:180});
  expect(result).not.toBeNull(); expect(avoid.some(line=>intersects(rect(result!.left,result!.top,result!.maxWidth,result!.maxHeight),line))).toBe(false);
 });
 it('空间确实不足时明确返回无法放置，不伪装无重叠', () => {
  expect(placeOutsideSentence({bounds:rect(12,12,336,280),viewport:rect(0,0,360,304),anchor:rect(20,20,50,20),avoid:[rect(0,0,360,304)],width:300,height:180})).toBeNull();
 });
});

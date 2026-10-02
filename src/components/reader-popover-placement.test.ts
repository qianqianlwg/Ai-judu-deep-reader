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

const railInput = { bounds: rect(200,60,700,600), viewport: rect(0,0,1400,760), anchor: rect(360,240,60,24), avoid: [rect(250,230,550,60)], width: 320, height: 180, preferredBounds: rect(912,70,450,590) };
describe('优先把概念卡放在右侧聊天栏', () => {
 it('正文上下都有空间也优先右栏，完全不盖整块阅读区', () => {
  const result=placeOutsideSentence(railInput)!;
  expect(result.placement).toBe('chat-rail'); expect(result.left).toBe(924); expect(result.top).toBe(240);
  expect(result.left).toBeGreaterThanOrEqual(railInput.bounds.right+12);
 });
 it.each([70,600])('点击高度 %i 时保留标题与输入区边界', top => {
  const result=placeOutsideSentence({...railInput,anchor:rect(360,top,60,24)})!;
  expect(result.top).toBeGreaterThanOrEqual(82); expect(result.top+result.maxHeight).toBeLessThanOrEqual(648);
 });
 it('长定义在右栏缩短并滚动，不因高度不足退回正文', () => {
  const result=placeOutsideSentence({...railInput,height:2000})!;
  expect(result.placement).toBe('chat-rail'); expect(result.maxHeight).toBe(566);
 });
 it.each([rect(0,0,0,0),rect(910,70,120,500),rect(0,70,1400,500)])('隐藏、过窄或移动覆盖栏回退句子避让', preferredBounds => {
  const result=placeOutsideSentence({...railInput,preferredBounds})!;
  expect(result.placement).not.toBe('chat-rail');
  expect(railInput.avoid.some(line=>intersects(rect(result.left,result.top,result.maxWidth,result.maxHeight),line))).toBe(false);
 });
 it('当前句子占满阅读区时仍可放右栏', () => {
  const result=placeOutsideSentence({...railInput,avoid:[railInput.bounds]})!;
  expect(result.placement).toBe('chat-rail'); expect(result.left).toBeGreaterThan(railInput.bounds.right);
 });
});

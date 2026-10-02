import { describe, expect, it } from 'vitest';
import { placeBelowWord, type PopoverBounds } from './reader-popover-placement';
const rect = (left: number, top: number, width: number, height: number): PopoverBounds => ({ left, top, right: left+width, bottom: top+height });
const bounds = rect(100,60,650,590);
const base = { bounds, anchor: rect(200,240,80,24), width: 320, height: 180 };
describe('概念卡紧贴词下方，底部空间不足时翻到上方', () => {
 it.each([80,240,400])('点击词位于 %i 时默认下方，左边与词对齐', top => {
  const result=placeBelowWord({...base,anchor:rect(200,top,80,24)})!;
  expect(result.placement).toBe('word-below'); expect(result.left).toBe(200); expect(result.top).toBe(top+24+12);
 });
 it('点击词靠近底部时翻到词上方并紧贴词位', () => {
  const result=placeBelowWord({...base,anchor:rect(200,590,80,24)})!;
  expect(result.placement).toBe('word-above'); expect(result.top+result.maxHeight).toBe(590-12);
 });
 it('下方正好够放时不提前上翻', () => {
  const result=placeBelowWord({...base,anchor:rect(200,434,80,24)})!;
  expect(result.placement).toBe('word-below'); expect(result.top+result.maxHeight).toBe(bounds.bottom);
 });
 it('词在右边缘时仅横向收进阅读区，不跳到侧栏', () => {
  const result=placeBelowWord({...base,anchor:rect(720,240,25,24)})!;
  expect(result.placement).toBe('word-below'); expect(result.left+result.maxWidth).toBe(bounds.right);
 });
 it.each([80,590])('长定义在 %i 处缩短高度并内部滚动，不盖词本身', top => {
  const anchor=rect(200,top,80,24),result=placeBelowWord({...base,anchor,height:2000})!;
  expect(result.maxHeight).toBeLessThan(2000);
  expect(result.top).toBeGreaterThanOrEqual(bounds.top); expect(result.top+result.maxHeight).toBeLessThanOrEqual(bounds.bottom);
  expect(result.top>=anchor.bottom+12||result.top+result.maxHeight<=anchor.top-12).toBe(true);
 });
 it('窄屏也只上下放置，不超出可用宽度', () => {
  const result=placeBelowWord({...base,bounds:rect(12,60,336,520),anchor:rect(80,210,60,24)})!;
  expect(result.placement).toBe('word-below'); expect(result.left).toBe(28); expect(result.top).toBe(246);
 });
 it('上下都没有可阅读空间时明确返回无法放置', () => {
  expect(placeBelowWord({...base,bounds:rect(12,12,336,70),anchor:rect(20,35,50,20)})).toBeNull();
 });
});

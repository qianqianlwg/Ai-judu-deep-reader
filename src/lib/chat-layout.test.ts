import { expect, it } from "vitest";
import { maxChatWidth,maxNavWidth } from "./chat-layout";
it("桌面 1280 宽度能把聊天拖到 780px，同时留 280px 正文", () => {
  expect(maxChatWidth(1280)).toBe(780);
  expect(maxChatWidth(1280,true)).toBe(900);
});
it("中等屏幕仍保留正文且最大聊天区不超过页面", () => {
  expect(maxChatWidth(1050)).toBe(580);
  expect(maxChatWidth(940)).toBe(660);
});

it("拉宽目录时聊天边界同步收缩，导读隐藏聊天时允许更多目录宽度",()=>{
 expect(maxChatWidth(1280,false,400)).toBe(600);
 expect(maxChatWidth(1280,true,400)).toBe(900);
 expect(maxNavWidth(980)).toBe(400);
 expect(maxNavWidth(980,true)).toBe(520);
 expect(maxNavWidth(1600)).toBe(520);
});

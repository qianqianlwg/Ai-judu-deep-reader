import { expect, it } from "vitest";
import { maxChatWidth } from "./chat-layout";
it("桌面 1280 宽度能把聊天拖到 780px，同时留 280px 正文", () => {
  expect(maxChatWidth(1280)).toBe(780);
  expect(maxChatWidth(1280,true)).toBe(900);
});
it("中等屏幕仍保留正文且最大聊天区不超过页面", () => {
  expect(maxChatWidth(1050)).toBe(580);
  expect(maxChatWidth(940)).toBe(660);
});

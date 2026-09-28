"use client";
import { useEffect, useState } from "react";
import { DEFAULT_READING_PREFERENCES, readReadingPreferences, writeReadingPreferences, type ReadingPreferences } from "@/lib/reading-preferences";

export function useReadingPreferences(bookId: string, onError: (message: string) => void) {
  const [saved, setSaved] = useState<{ bookId: string; value: ReadingPreferences }>({ bookId: "", value: DEFAULT_READING_PREFERENCES });
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      try { setSaved({ bookId, value: readReadingPreferences(localStorage, bookId) }); }
      catch (error: unknown) { console.error("读取本书解读设置失败", error); setSaved({ bookId, value: DEFAULT_READING_PREFERENCES }); onError("本书解读设置读取失败，已使用正常设置；可在加号菜单重新保存。"); }
    });
    return () => { active = false; };
  }, [bookId, onError]);
  // WHY：切书后的首帧不沿用上一书设置；保存成功才更新状态，失败必须给出反馈。
  const preferences = saved.bookId === bookId ? saved.value : DEFAULT_READING_PREFERENCES;
  function changePreferences(value: ReadingPreferences) {
    try { writeReadingPreferences(localStorage, bookId, value); setSaved({ bookId, value }); }
    catch (error: unknown) { console.error("保存本书解读设置失败", error); onError("本书解读设置未能保存，请检查浏览器存储后重试。"); }
  }
  return { preferences, changePreferences };
}

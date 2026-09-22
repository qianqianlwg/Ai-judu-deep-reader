"use client";
import {useEffect, useState} from "react";
const KEY = "judu:bookshelf-assistant";
export function useBookshelfAssistant() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try { setOpen(localStorage.getItem(KEY) === "true"); }
      catch (cause: unknown) { console.warn("读取书架助手偏好失败", cause); setError("无法读取助手偏好，本次默认收起"); }
    });
    return () => { active = false; };
  }, []);
  function toggle() {
    const next = !open; setOpen(next);
    try { localStorage.setItem(KEY, String(next)); setError(""); }
    catch (cause: unknown) { console.warn("保存书架助手偏好失败", cause); setError("助手已切换，但偏好未保存"); }
  }
  return {open, toggle, error};
}

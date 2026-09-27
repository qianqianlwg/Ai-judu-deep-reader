type Options = { onCommit(): void; onStart(): void; onCancel?(): void };
/** WHY：selectionchange 在拖选途中持续触发；只有释放指针或键盘选区完成后才提交浮层。 */
export function bindSettledSelection(root: HTMLElement | Document, options: Options): () => void {
  const doc = root.nodeType === 9 ? root as Document : root.ownerDocument!;
  const win = doc.defaultView;
  const outer = win?.frameElement?.ownerDocument;
  const releases = outer && outer !== doc ? [doc, outer] : [doc];
  let pressed = false, cancelled = false, committed = false;
  const commit = () => {
    if (pressed || cancelled) return;
    const selection = doc.getSelection();
    if (selection && !selection.isCollapsed && selection.rangeCount && selection.getRangeAt(0).intersectsNode(root)) committed = true;
    options.onCommit();
  };
  const start = (event: Event) => {
    const pointer = event as MouseEvent;
    if (pointer.button !== undefined && pointer.button !== 0) return;
    const target = event.target as Element | null;
    if (target?.closest?.('[data-reader-decoration],button,input,textarea,select,[role="dialog"],.annotationLayer')) return;
    const selected = doc.getSelection();
    const range = selected?.rangeCount ? selected.getRangeAt(0) : null;
    // WHY：原版的 root 是整个 iframe Document；点击其空白 body 不会进入“外层”监听，须同次清除原生与应用选区。
    if (committed && pointer.button === 0 && range && target && (target === root || target === doc.body || target === doc.documentElement)) {
      committed = false; cancelled = true;
      selected?.removeAllRanges(); options.onCancel?.();
      return;
    }
    if (pressed) return;
    pressed = true; committed = false; cancelled = false; options.onStart();
  };
  const release = (event: Event) => {
    if ((event as MouseEvent).button !== undefined && (event as MouseEvent).button !== 0) return;
    if (cancelled) return;
    pressed = false; commit();
  };
  // WHY：选区提交后的 iframe 失焦通常是用户点击外层操作栏，不是拖选取消；只取消尚在进行的手势。
  const cancel = () => { if (!pressed) return; pressed = false; cancelled = true; options.onCancel?.(); };
  // WHY：点击正文外的空白时一次取消原生选区与应用快照；按钮与输入框保留选文用于句读操作。
  const outside = (event: Event) => {
    if (pressed || !committed || (event as MouseEvent).button !== 0) return;
    const target = event.target as Element | null;
    if (!target || root.contains(target) || target.closest?.('[data-reader-decoration],button,input,textarea,select,a,[role="dialog"],.annotationLayer')) return;
    committed = false; cancelled = true;
    doc.getSelection()?.removeAllRanges();
    options.onCancel?.();
  };
  const key = () => { if (!pressed) { cancelled = false; commit(); } };
  root.addEventListener('pointerdown', start); root.addEventListener('mousedown', start);
  root.addEventListener('keyup', key); doc.addEventListener('selectionchange', commit);
  for (const source of releases) {
    source.addEventListener('pointerdown', outside); source.addEventListener('mousedown', outside);
    source.addEventListener('pointerup', release); source.addEventListener('mouseup', release);
    source.addEventListener('pointercancel', cancel);
  }
  win?.addEventListener('blur', cancel);
  return () => {
    root.removeEventListener('pointerdown', start); root.removeEventListener('mousedown', start);
    root.removeEventListener('keyup', key); doc.removeEventListener('selectionchange', commit);
    for (const source of releases) { source.removeEventListener('pointerdown', outside); source.removeEventListener('mousedown', outside); source.removeEventListener('pointerup', release); source.removeEventListener('mouseup', release); source.removeEventListener('pointercancel', cancel); }
    win?.removeEventListener('blur', cancel);
  };
}

type Options = { onCommit(): void; onStart(): void; onCancel?(): void };
/** WHY：selectionchange 在拖选途中持续触发；只有释放指针或键盘选区完成后才提交浮层。 */
export function bindSettledSelection(root: HTMLElement | Document, options: Options): () => void {
  const doc = root.nodeType === 9 ? root as Document : root.ownerDocument!;
  const win = doc.defaultView;
  const outer = win?.frameElement?.ownerDocument;
  const releases = outer && outer !== doc ? [doc, outer] : [doc];
  let pressed = false, cancelled = false;
  const commit = () => { if (!pressed && !cancelled) options.onCommit(); };
  const start = (event: Event) => {
    const pointer = event as MouseEvent;
    if (pointer.button !== undefined && pointer.button !== 0) return;
    const target = event.target as Element | null;
    if (target?.closest?.('[data-reader-decoration],button,input,textarea,select,[role="dialog"],.annotationLayer')) return;
    if (pressed) return;
    pressed = true; cancelled = false; options.onStart();
  };
  const release = (event: Event) => {
    if ((event as MouseEvent).button !== undefined && (event as MouseEvent).button !== 0) return;
    if (cancelled) return;
    pressed = false; commit();
  };
  const cancel = () => { pressed = false; cancelled = true; options.onCancel?.(); };
  const key = () => { if (!pressed) { cancelled = false; commit(); } };
  root.addEventListener('pointerdown', start); root.addEventListener('mousedown', start);
  root.addEventListener('keyup', key); doc.addEventListener('selectionchange', commit);
  for (const source of releases) {
    source.addEventListener('pointerup', release); source.addEventListener('mouseup', release);
    source.addEventListener('pointercancel', cancel);
  }
  win?.addEventListener('blur', cancel);
  return () => {
    root.removeEventListener('pointerdown', start); root.removeEventListener('mousedown', start);
    root.removeEventListener('keyup', key); doc.removeEventListener('selectionchange', commit);
    for (const source of releases) { source.removeEventListener('pointerup', release); source.removeEventListener('mouseup', release); source.removeEventListener('pointercancel', cancel); }
    win?.removeEventListener('blur', cancel);
  };
}

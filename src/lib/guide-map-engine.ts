export type MindNodeInstance = {
  isRoot: boolean;
  getData(key: string): unknown;
  uid: string;
  left: number;
  top: number;
  width: number;
  height: number;
};
export type MindMapEngine = {
  opt: { readonly: boolean };
  renderer: {
    activeNodeList: MindNodeInstance[];
    textEdit: { showTextEdit: boolean; hideEditTextBox(): void };
    findNodeByUid(id: string): MindNodeInstance | undefined;
    moveNodeToCenter(node: MindNodeInstance, reset?: boolean): void;
  };
  command: {
    pause(): void;
    recovery(): void;
    remove(name: string): void;
    add(name: string, fn: () => void): void;
  };
  on(name: string, fn: (...args: unknown[]) => void): void;
  off(name: string, fn: (...args: unknown[]) => void): void;
  getData(): unknown;
  updateData(data: unknown): void;
  resize(): void;
  destroy(): void;
  execCommand(name: string, ...args: unknown[]): void;
  view: {
    scale: number;
    fit(): void;
    enlarge(): void;
    narrow(): void;
    setScale(scale: number): void;
    getTransformData(): unknown;
    setTransformData(value: unknown): void;
  };
  miniMap?: {
    calculationMiniMap(
      width: number,
      height: number,
    ): { svgHTML: string; viewBoxStyle: Record<string, string> };
    onMousedown(event: { clientX: number; clientY: number }): void;
    onMousemove(event: { clientX: number; clientY: number }): void;
    onMouseup(): void;
  };
  export(
    type: string,
    isDownload?: boolean,
    fileName?: string,
  ): Promise<unknown>;
};
export type MindMapConstructor = {
  new (options: Record<string, unknown>): MindMapEngine;
  usePlugin(plugin: unknown): MindMapConstructor;
};
export function isMindNode(value: unknown): value is MindNodeInstance {
  return (
    value !== null &&
    typeof value === "object" &&
    "getData" in value &&
    typeof value.getData === "function"
  );
}
export function asMindMapConstructor(value: unknown): MindMapConstructor {
  if (
    typeof value !== "function" ||
    !("usePlugin" in value) ||
    typeof value.usePlugin !== "function"
  )
    throw new Error("思维导图库未正确加载");
  // WHY：上游npm声明types但发布包缺少声明；只在加载边界断言，经运行时核对后以最小接口使用，不传播any。
  return value as unknown as MindMapConstructor;
}

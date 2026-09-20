/** 本项目worker使用的固定vendor公共接口；仅声明实际存在的方法，不访问私有字段。 */
export type Metadata = { title: string; author: string[] };
export type SpineChapter = { id: string; text?: string; start?: number; end?: number };
export type TocItem = { label: string; href: string; children?: TocItem[] };
export type MobiCandidate = {
  getMetadata(): Metadata;
  getSpine(): SpineChapter[];
  getToc(): TocItem[];
  loadChapter(id: string): { html: string; css: { id: string; href: string }[] } | undefined;
  resolveHref(href: string): { id: string; selector: string } | undefined;
};
export declare function initMobiFile(file: Uint8Array, resourceSaveDir: string): Promise<MobiCandidate>;
export declare function initKf8File(file: Uint8Array, resourceSaveDir: string): Promise<MobiCandidate>;

/** Narrow, pinned foliate-js contract; no vendor imports or browser work at module scope. */
export interface FoliateSection {
  /** Upstream sets this to the resolved manifest item.href, NOT its manifest id. */
  id: string;
  href?: string;
  cfi?: string;
  size?: number;
  linear?: string;
  createDocument(): Promise<Document>;
  load(): Promise<string | null>;
  unload(): void;
}
export interface FoliateTocItem {
  label: string;
  href: string;
  subitems?: FoliateTocItem[];
}
export interface FoliateNavigation {
  index: number;
  anchor: (doc: Document) => Range | Element | number;
}
export interface FoliateBook {
  sections: FoliateSection[];
  toc?: FoliateTocItem[];
  metadata?: { title?: string; language?: string; [key: string]: unknown };
  rendition?: { layout?: string; [key: string]: unknown };
  dir?: string;
  splitTOCHref?(href:string):string[];
  getTOCFragment?(doc:Document,id:string):Element|null;
  isExternal?(href:string):boolean;
  resolveCFI?(cfi: string): FoliateNavigation;
  resolveHref?(href: string): FoliateNavigation | null;
  destroy?(): void;
}
export interface FoliateRenderer extends HTMLElement {
  getContents(): { doc: Document; index: number }[];
  goTo(target: { index: number; anchor: (doc: Document) => Range | Element }): Promise<void>;
  /** Trusted app-owned CSS only; never pass original book/user CSS here. */
  setStyles(css: string): void;
}
export interface FoliateLocation { cfi?: string; index?: number; fraction?: number; range?: Range | null; [key: string]: unknown }
export interface FoliateLoadDetail { doc: Document; index: number }
export interface FoliateViewEvents { load: CustomEvent<FoliateLoadDetail>; relocate: CustomEvent<FoliateLocation> }
export interface FoliateView extends HTMLElement {
  addEventListener<K extends keyof FoliateViewEvents>(type: K, listener: (event: FoliateViewEvents[K]) => void, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
  isFixedLayout: boolean;
  lastLocation?: FoliateLocation | null;
  open(book: FoliateBook): Promise<void>;
  init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
  goTo(target: string | number): Promise<unknown>;
  getCFI(index: number, range?: Range): string;
  resolveCFI(cfi: string): FoliateNavigation;
  next(): Promise<void>;
  prev(): Promise<void>;
  close(): void;
  /** Available after open() resolves. */
  renderer: FoliateRenderer;
}
export interface EpubArchiveEntry {
  filename: string;
  directory: boolean;
  encrypted: boolean;
  compressedSize: number;
  uncompressedSize: number;
  read(limit: number): Promise<Uint8Array<ArrayBuffer>>;
}
export interface EpubArchive {
  entries: EpubArchiveEntry[];
  close(): Promise<void>;
}
export interface EpubResourceLoader {
  loadText(path: string): Promise<string | null>;
  loadBlob(path: string): Promise<Blob | null>;
  getSize(path: string): number;
}
export interface FoliateBridge {
  revision: string;
  openArchive(blob: Blob): Promise<EpubArchive>;
  createBook(original: Blob, loader: EpubResourceLoader): Promise<FoliateBook>;
  createView(): FoliateView;
  sanitizeCss(source: string, resolve: (url: string) => Promise<string | null>, inline?: boolean): Promise<string>;
}

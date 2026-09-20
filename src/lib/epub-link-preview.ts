import type { FoliateSection } from "./foliate-types";
import { sameEpubResource } from "./epub-source-map";
export type EpubLinkPreview = { title: string; text: string; address?: string; index?: number; fragment?: string };
export async function previewEpubLink(href: string, sections: readonly FoliateSection[], index: number, doc: Document): Promise<EpubLinkPreview> {
  const source = sections[index]?.id;
  if (!source) throw new Error("引用来源章节无效");
  const target = new URL(href, new URL(source, "https://epub.invalid/"));
  // WHY：悬停只读取包内文档，不预取网络、不运行书内 HTML，外部地址仅作纯文本展示。
  if (target.origin !== "https://epub.invalid" || /^[a-z][\w+.-]*:/iu.test(href) || href.startsWith("//"))
    return { title: "外部链接", text: "外部链接不自动访问。", address: href };
  const targetIndex = sections.findIndex(section => sameEpubResource(section.id, target.pathname));
  if (targetIndex < 0) throw new Error("找不到引用所在章节");
  const fragment = decodeURIComponent(target.hash.slice(1));
  const targetDoc = targetIndex === index ? doc : await sections[targetIndex].createDocument();
  let element = fragment ? targetDoc.getElementById(fragment) : targetDoc.body;
  if (!element) throw new Error("找不到引用目标");
  if (!element.textContent?.trim()) element = element.closest("p,li,aside,section") ?? element;
  const text = element.textContent?.trim() ?? "";
  // WHY：与PDF引用概览相同，保留2400个UTF-16单位上限，但不能把emoji/增补汉字截成孤立代理项。
  let excerpt = text.slice(0, 2400);
  if (excerpt.length < text.length && /[\uD800-\uDBFF]$/u.test(excerpt)) excerpt = excerpt.slice(0, -1);
  return { title: "引用预览", text: excerpt || "此处没有可预览的文字。", address: target.pathname.slice(1) + target.hash, index: targetIndex, fragment };
}

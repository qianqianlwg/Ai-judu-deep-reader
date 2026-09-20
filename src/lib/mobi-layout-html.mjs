// @ts-check
import { parse } from "parse5";
/** @typedef {import('parse5').DefaultTreeAdapterTypes.Node} Node */
/** @typedef {{attribute:'id'|'name'|'aid',value:string}} Anchor */
/** @param {string} html */
export function indexMobiLayout(html) {
  if (html.length > 20_000_000) throw new Error("MOBI布局HTML超限");
  const tree = parse(html, { scriptingEnabled: false });
  /** @type {Node[]} */ const stack = [tree];
  /** @type {Map<string, number>} */ const anchors = new Map();
  /** @type {Set<string>} */ const links = new Set();
  let nodes = 0;
  while (stack.length) {
    const node = stack.pop(); if (!node || ++nodes > 400_000) throw new Error("MOBI布局节点数超限");
    if ("tagName" in node) {
      if (["script", "style", "template", "noscript"].includes(node.tagName)) continue;
      for (const attr of node.attrs) {
        if (["id", "name", "aid"].includes(attr.name) && attr.value) { const key = JSON.stringify([attr.name, attr.value]); anchors.set(key, (anchors.get(key) ?? 0) + 1); }
        if (node.tagName === "a" && attr.name === "href") links.add(attr.value);
      }
    }
    if ("childNodes" in node) {
      if (stack.length + node.childNodes.length > 200_000) throw new Error("MOBI布局节点栈超限");
      for (let index = node.childNodes.length - 1; index >= 0; index--) stack.push(node.childNodes[index]);
    }
  }
  /** WHY：只核对解析器指向的唯一真实元素，不执行CSS选择器、不猜最近段落；这还不是源字节偏移证明。 @param {string} selector @returns {Anchor|null} */
  const resolve = selector => {
    const match = /^\[(id|name|aid)="([^"\r\n]+)"\]$/u.exec(selector);
    if (!match || anchors.get(JSON.stringify([match[1], match[2]])) !== 1) return null;
    return { attribute: /** @type {Anchor['attribute']} */ (match[1]), value: match[2] };
  };
  return { hrefs: [...links], resolve };
}

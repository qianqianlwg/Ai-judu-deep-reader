export const PDF_PAGE_PREFIX="pdf:page:";
export const MAX_PDF_PAGES=5000;
export const MAX_PDF_INDEX_CHARACTERS=8_000_000;
export function pdfPageNumber(href:string|undefined):number|null {
 const match=href?.match(/^pdf:page:([1-9]\d*)$/u);if(!match)return null;const page=Number(match[1]);return Number.isSafeInteger(page)&&page<=MAX_PDF_PAGES?page:null;
}
/** WHY：PDF缺失字符可能抽取为NUL，当前SQLite驱动读取TEXT会在NUL截断。用明确未知字符占位而非猜公式符号，三层映射一致归一化。 */
export function pdfSafeText(text:string):string{return text.replace(/\u0000/gu,"�");}
export function pdfPageText(items:readonly unknown[]):string {
 // WHY：PDF文本不是HTML；不能把公式中的尖括号或实体字符串当标签解码/删除。保留item顺序，用页号定位而非猜视觉段落。
 return items.flatMap(item=>item!==null&&typeof item==='object'&&'str'in item&&typeof item.str==='string'?[pdfSafeText(item.str)]:[]).join(' ').replace(/\s+/gu,' ').trim();
}

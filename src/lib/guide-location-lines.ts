import { GUIDE_ROOT_ID } from "./guide-map-adapter";
import type { GuideNode } from "./guide";
import { isMindNode, type MindMapEngine, type MindNodeInstance } from "./guide-map-engine";
import { GUIDE_NO_POSITION_COLOR, guideNodePosition, guidePositionColor, type GuideLocations, type GuideColorScale } from "./guide-locations";
const SVG_NS = "http://www.w3.org/2000/svg";
type LineParent = MindNodeInstance & { children: MindNodeInstance[]; _lines: { node: SVGElement }[] };
function isLineParent(value: unknown): value is LineParent {
  return isMindNode(value) && "children" in value && Array.isArray(value.children) && value.children.every(isMindNode) && "_lines" in value && Array.isArray(value._lines) && value._lines.every(line => typeof line === "object" && line !== null && "node" in line && line.node instanceof SVGElement);
}
let svgSequence = 0;
// WHY：仅在内核完成布局后增强现有连线，不改节点内容、上游布局或撤销数据；颜色按真实来源而非节点生成时间决定。
export function applyGuideLocationLines(engine: { renderer: Pick<MindMapEngine["renderer"], "findNodeByUid"> }, nodes: readonly GuideNode[], locations: GuideLocations | null, scale?: GuideColorScale): void {
  const positions = new Map(nodes.map(node => [node.id, locations ? guideNodePosition(node, nodes, locations) : null]));
  const touched = new Set<SVGSVGElement>();
  let index = 0;
  for (const node of nodes) {
    const parent = engine.renderer.findNodeByUid(node.parentId ?? GUIDE_ROOT_ID);
    if (!isLineParent(parent)) continue;
    const childIndex = parent.children.findIndex(child => child.getData("uid") === node.id);
    const path = parent._lines[childIndex]?.node;
    const child = parent.children[childIndex];
    const svg = path?.ownerSVGElement;
    if (!svg || !child) continue;
    let defs = svg.querySelector("defs");
    if (!defs) { defs = document.createElementNS(SVG_NS, "defs"); svg.prepend(defs); }
    if (!touched.has(svg)) {
      defs.querySelectorAll('[data-guide-position-gradient="true"]').forEach(gradient => gradient.remove());
      if (!svg.dataset.guidePositionScope) svg.dataset.guidePositionScope = String(++svgSequence);
      touched.add(svg);
    }
    const position = positions.get(node.id);
    const target = position?.sources.flatMap(source => source.spans.map(span => guidePositionColor((span.start + span.end) / 2, scale))) ?? [];
    path.dataset.guidePositionNode = node.id;
    if (!target.length) { path.setAttribute("stroke", GUIDE_NO_POSITION_COLOR); path.setAttribute("stroke-dasharray", "3 3"); continue; }
    const parentSpan = positions.get(node.parentId ?? "")?.sources[0]?.spans[0];
    const start = parentSpan ? guidePositionColor((parentSpan.start + parentSpan.end) / 2, scale) : target[0];
    const colors = [start, ...target];
    const gradient = document.createElementNS(SVG_NS, "linearGradient");
    const id = "judu-guide-position-" + svg.dataset.guidePositionScope + "-" + index++;
    gradient.id = id; gradient.dataset.guidePositionGradient = "true";
    gradient.setAttribute("gradientUnits", "userSpaceOnUse");
    gradient.setAttribute("x1", String(parent.left + parent.width)); gradient.setAttribute("y1", String(parent.top + parent.height / 2));
    gradient.setAttribute("x2", String(child.left)); gradient.setAttribute("y2", String(child.top + child.height / 2));
    colors.forEach((color, stopIndex) => {
      const stop = document.createElementNS(SVG_NS, "stop");
      stop.setAttribute("offset", String(stopIndex / (colors.length - 1))); stop.setAttribute("stop-color", color); gradient.append(stop);
    });
    defs.append(gradient); path.setAttribute("stroke", "url(#" + id + ")"); path.removeAttribute("stroke-dasharray"); path.setAttribute("stroke-width", "1.6");
  }
}

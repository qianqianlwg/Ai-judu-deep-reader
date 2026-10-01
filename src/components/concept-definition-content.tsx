"use client";

import type { AnnotationConcept } from "@/lib/annotations";
import type { ConceptReadingVersion } from "@/lib/concept-reading";
import styles from "./concept-definition-content.module.css";

function DefinitionText({ definitions }: Pick<AnnotationConcept, "definitions">) {
  const nonEmpty = definitions.filter(item => item.text.trim());
  return nonEmpty.length ? nonEmpty.map((item, index) => <div data-concept-text="" key={index}>{item.text}</div>) : <div data-concept-text="">暂无定义</div>;
}

function VersionTime({ createdAt }: Pick<ConceptReadingVersion, "createdAt">) {
  const date = new Date(createdAt);
  return <time dateTime={createdAt}>{Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN") : createdAt}</time>;
}

/** WHY：只展示当前原文词位的解释；同处重读保留历史，不用其他句子的定义或摘要填空。 */
export function ConceptDefinitionContent({ concept }: { concept: AnnotationConcept }) {
  const [current, ...history] = concept.versions ?? [];
  return <div className={"judu-concept-definition " + styles.content} data-concept-definition={concept.name}
    data-concept-paragraph-id={concept.location?.paragraphId} data-concept-start={concept.location?.startOffset}
    data-concept-end={concept.location?.endOffset}>
    <div className={styles.current} data-concept-unit-id={current?.unitId}>
      {current && <div className={styles.meta}><span>本句解释</span><VersionTime createdAt={current.createdAt}/></div>}
      <DefinitionText definitions={current?.definitions ?? concept.definitions}/>
    </div>
    {history.length > 0 && <details key={current?.unitId} className={styles.history}>
      <summary>此处历史解释（{history.length}）</summary>
      <ol>{history.map(version => <li key={version.annotationId} data-concept-unit-id={version.unitId}>
        <div className={styles.meta}><span>此前句读</span><VersionTime createdAt={version.createdAt}/></div>
        <DefinitionText definitions={version.definitions}/>
      </li>)}</ol>
    </details>}
  </div>;
}

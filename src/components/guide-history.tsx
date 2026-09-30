"use client";
import { useState } from "react";
import type { GuideCommand, GuideState } from "@/lib/guide";
import styles from "./guide-workspace.module.css";
type Props = { revisions: GuideState["revisions"]; busy: boolean; command: (command: GuideCommand) => Promise<boolean>; onClose: () => void; setNotice: (notice: string) => void };
export function GuideHistory({ revisions, busy, command, onClose, setNotice }: Props) {
  const [restoreConfirm, setRestoreConfirm] = useState<number | null>(null);
  return (
              <aside className={styles.inspector} aria-label="导读修改历史">
                <div className={styles.inspectorTop}>
                  <span>修改历史</span>
                  <button
                    aria-label="关闭修改历史"
                    onClick={onClose}
                  >
                    ×
                  </button>
                </div>
                <h2>每一步，都可回看</h2>
                <p className={styles.hint}>
                  AI、内容、结构和画板位置的改动都保留快照。恢复旧版也是一次可撤销的改动。
                </p>
                {revisions.length >= 60 && <p className={styles.hint}>这里显示最近60次修改，更早的改动仍保留，可通过撤销继续回溯。</p>}
                {!revisions.length && (
                  <p className={styles.hint}>还没有改动记录。</p>
                )}
                {revisions.map((revision) => (
                  <article key={revision.id} className={styles.revision}>
                    <div>
                      <span>
                        {revision.actor === "ai" ? "AI 整理" : "你的调整"}
                      </span>
                      <time dateTime={revision.createdAt}>
                        {new Date(revision.createdAt).toLocaleString("zh-CN", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <p>{revision.reason}</p>
                    {revision.current ? (
                      <small>当前版本</small>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() => setRestoreConfirm(revision.id)}
                      >
                        恢复此版本
                      </button>
                    )}
                    {restoreConfirm === revision.id && (
                      <div className={styles.confirm}>
                        <p>将恢复此刻的完整导读。之后的版本仍保留在历史中。</p>
                        <button onClick={() => setRestoreConfirm(null)}>
                          取消
                        </button>
                        <button
                          disabled={busy}
                          onClick={async () => {
                            if (
                              await command({
                                action: "restore",
                                revisionId: revision.id,
                              })
                            ) {
                              setRestoreConfirm(null);
                              setNotice("已恢复历史版本");
                            }
                          }}
                        >
                          确认恢复
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </aside>
  );
}

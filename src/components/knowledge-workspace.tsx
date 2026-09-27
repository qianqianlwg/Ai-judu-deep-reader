"use client";

import type { BookSearchPanelProps } from "./book-search-panel";
import type { KnowledgeMaterial } from "@/lib/knowledge-materials";
import type { MessageAnchor } from "@/lib/chat-stream";
import { KnowledgeLibrary } from "./knowledge-library";
import "./knowledge-workspace.css";

export type KnowledgeWorkspaceProps = {
  editionId: string | null;
  bookTitle?: string;
  refreshToken?: string | number;
  onReturnReading: () => void;
  onRefreshRequested?: () => void;
  onOpenSource?: (anchor: MessageAnchor) => void;
  onOpenMark?: (anchor: MessageAnchor) => void;
  onOpenConversation?: (threadId: string, messageId: string | null) => void;
  onOpenMaterial?: (item: KnowledgeMaterial) => void;
  onOpenConversationMaterial?: (item: KnowledgeMaterial) => void;
  advancedSearch?: BookSearchPanelProps;
};
export function KnowledgeWorkspace({ onOpenMark, ...props }: KnowledgeWorkspaceProps) {
  return <KnowledgeLibrary {...props} onOpenSource={props.onOpenSource ?? onOpenMark} />;
}

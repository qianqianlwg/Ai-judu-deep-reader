import type { getDb } from '../db';
import type { ProviderConfig, ProviderMessage } from '../ai-provider';
import type { ContextSettings } from '../context-compaction';
import type { ChatEvent } from '../chat-stream';
import type { ReadingAnchorPart } from '../reading-anchors';
import type { SemanticReading, SemanticUnit } from '../semantic-reading';
import type { TokenUsage } from '../token-usage';
import type { BookSource, ReadingToolDependencies } from './tools';
import type { ReadingDetail } from '../reading-detail';
import type { ReadingDifficulty } from '../reading-preferences';
import { runReadingAgent, readingAgentFailure, type ReadingAgentOptions, type ToolRun } from './runtime';
import { createSemanticSession } from './semantic-session';
import { readingSystemPrompt } from './prompt';
export type SemanticFlowOptions = { readingStyle?: 'semantic' | 'whole'; db: ReturnType<typeof getDb>; editionId: string; config: ProviderConfig; settings: ContextSettings; sources: ReadingAnchorPart[]; providedSources?: BookSource[]; context: string; messages: ProviderMessage[]; detail: ReadingDetail; difficulty: ReadingDifficulty; forceRead: boolean; previous?: SemanticReading; initialUsage?: TokenUsage; signal: AbortSignal; search: ReadingToolDependencies['search']; external?: ReadingAgentOptions['external']; publish: (s: SemanticReading, content: string) => void; commit: (u: SemanticUnit, s: SemanticReading) => void; emit: (event: ChatEvent) => void; audit: (run: ToolRun) => Promise<void>; read?: ReadingToolDependencies['read'] };
export async function executeSemanticFlow(o: SemanticFlowOptions) {
  const session = createSemanticSession(o);
  const repository = new Map(o.providedSources?.map(source => [source.sourceId, source]));
  try {
    const result = await runReadingAgent({ config: o.config, semantic: session, systemPrompt: readingSystemPrompt('analyze', o.sources.map(s => s.selectedText).join(''), o.detail, o.difficulty),
      messages: [...o.messages, { role: 'user', content: JSON.stringify({ ...session.sourceData, context: o.context }) }],
      signal: o.signal, contextWindow: o.settings.maxInputTokens + (o.settings.maxOutputTokens ?? 0), maxOutputTokens: o.settings.maxOutputTokens,
      initialUsage: o.initialUsage, emit: o.emit, audit: o.audit, external: o.external,
      tools: { messageId: 'semantic', selectedText: '', sources: repository, search: o.search,
        read: o.read ?? (async () => { throw new Error('原文读取依赖未装配'); }),
        save: async () => { throw new Error('统一句读不使用旧保存工具'); },
      },
    });
    return { state: session.state, usage: result.usage };
  } catch (error: unknown) {
    session.interrupt(error instanceof Error ? readingAgentFailure(error)?.message ?? error.message : '句读暂时失败');
    throw error;
  }
}

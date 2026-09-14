export type CitationCandidate = { sourceId: string; paragraphId: string; quote: string };
export type CitationSource = { sourceId: string; paragraphId: string; text: string };
export type ValidatedCitation = CitationCandidate & { messageId: string };

export function sourceIdForParagraph(editionId: string, paragraphId: string): string {
  return `book:${editionId}:paragraph:${paragraphId}`;
}

export function validateCitations(
  candidates: readonly CitationCandidate[],
  sources: readonly CitationSource[],
  messageId: string,
): ValidatedCitation[] {
  const sourceMap = new Map(sources.map((source) => [source.sourceId, source]));
  const seen = new Set<string>();
  const result: ValidatedCitation[] = [];
  for (const candidate of candidates) {
    if (!candidate.sourceId || !candidate.paragraphId || !candidate.quote.trim()) continue;
    const source = sourceMap.get(candidate.sourceId);
    if (!source || source.paragraphId !== candidate.paragraphId) continue;
    if (!source.text.includes(candidate.quote)) continue;
    const key = candidate.sourceId + "\u0000" + candidate.quote;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...candidate, quote: candidate.quote.trim(), messageId });
  }
  return result;
}

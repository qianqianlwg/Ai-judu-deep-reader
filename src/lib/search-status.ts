export type SearchIndexStatus = { backend: "postgres" | "sqlite"; editionId: string; paragraphCount: number; indexedCount: number; vectorIndexed: boolean; note: string };
export function buildSearchIndexStatus(input: Omit<SearchIndexStatus, "vectorIndexed">): SearchIndexStatus { return { ...input, vectorIndexed: input.backend === "postgres" && input.indexedCount > 0 }; }

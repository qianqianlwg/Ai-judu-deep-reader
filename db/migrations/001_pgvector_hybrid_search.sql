-- PostgreSQL/pgvector migration for hybrid paragraph retrieval.
-- WHY：这是独立迁移文档，不会修改当前 SQLite MVP 的 schema 或启动流程。
-- Apply only when PostgreSQL is introduced.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS reader_paragraph_embeddings (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  edition_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  paragraph_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding vector(1536),
  source_type TEXT NOT NULL DEFAULT 'book'
    CHECK (source_type IN ('book', 'translation', 'external')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (edition_id, paragraph_id)
);

ALTER TABLE reader_paragraph_embeddings
  ADD COLUMN IF NOT EXISTS search_document tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;

CREATE INDEX IF NOT EXISTS reader_paragraph_embeddings_search_document_idx
  ON reader_paragraph_embeddings USING GIN (search_document);

-- WHY：HNSW 提供较好的查询延迟；向量维度应与实际 embedding 模型保持一致。
CREATE INDEX IF NOT EXISTS reader_paragraph_embeddings_embedding_hnsw_idx
  ON reader_paragraph_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS reader_paragraph_embeddings_scope_idx
  ON reader_paragraph_embeddings (book_id, edition_id, chapter_id);

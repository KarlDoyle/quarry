import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";
import { createLogger } from "../logger.js";

// Resolve the built-in at runtime via getBuiltinModule so bundlers (vitest/vite)
// don't try to resolve `node:sqlite` themselves — it's newer than their builtin
// lists. Requires Node ≥ 24 launched with `--experimental-sqlite`.
const { DatabaseSync } = process.getBuiltinModule(
  "node:sqlite",
) as typeof import("node:sqlite");

const logger = createLogger("VectorStore");

/** Default embedding dimension (all-MiniLM-L6-v2). Configurable per store. */
export const EMBEDDING_DIM = 384;

export interface ChunkMetadata {
  entityName?: string;
  startLine?: number;
  endLine?: number;
  language?: string;
}

export interface CodeChunk {
  filePath: string;
  chunkType: string;
  content: string;
  embedding: number[];
  metadata: ChunkMetadata;
  similarity?: number;
}

/** Tokenise a query into a safe FTS5 MATCH expression (OR of bare terms). */
function toFtsQuery(query: string): string | null {
  const terms = query.toLowerCase().match(/[a-z0-9_]+/g);
  if (!terms || terms.length === 0) return null;
  return [...new Set(terms)].map((t) => `"${t}"`).join(" OR ");
}

/**
 * Local, embedded store backed by Node's built-in SQLite (`node:sqlite`) — no
 * native compile step. Holds chunk text, a `sqlite-vec` vector index, and an
 * FTS5 full-text index, all keyed by the same rowid. Search is HYBRID: dense
 * (cosine) + BM25 keyword, fused with Reciprocal Rank Fusion.
 *
 * Requires Node ≥ 24 run with `--experimental-sqlite`.
 */
export class VectorStore {
  private db: DatabaseSyncType;
  private dim: number;
  private static readonly RRF_K = 60;

  constructor(dbFilePath: string, dim: number = EMBEDDING_DIM) {
    this.dim = dim;
    this.db = new DatabaseSync(dbFilePath, { allowExtension: true });
    this.db.enableLoadExtension(true);
    this.db.loadExtension(sqliteVec.getLoadablePath());
    this.db.enableLoadExtension(false);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS chunks (
         id INTEGER PRIMARY KEY,
         file_path TEXT NOT NULL,
         chunk_type TEXT NOT NULL,
         content TEXT NOT NULL,
         metadata TEXT NOT NULL
       )`,
    );
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[${this.dim}])`,
    );
    this.db.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(content)",
    );
    logger.debug("Vector store ready", {
      db: dbFilePath,
      dim: this.dim,
      vec: this.vecVersion(),
    });
  }

  vecVersion(): string {
    return (this.db.prepare("select vec_version() as v").get() as { v: string })
      .v;
  }

  /** Wipe everything (used for a clean re-index). */
  clear(): void {
    this.db.exec("DELETE FROM chunks");
    this.db.exec("DELETE FROM vec_chunks");
    this.db.exec("DELETE FROM fts_chunks");
  }

  insert(chunk: Omit<CodeChunk, "similarity">): void {
    if (chunk.embedding.length !== this.dim) {
      throw new Error(
        `Embedding must be ${this.dim}-dim, got ${chunk.embedding.length}`,
      );
    }
    const info = this.db
      .prepare(
        "INSERT INTO chunks (file_path, chunk_type, content, metadata) VALUES (?, ?, ?, ?)",
      )
      .run(
        chunk.filePath,
        chunk.chunkType,
        chunk.content,
        JSON.stringify(chunk.metadata),
      );
    // Bind the BigInt rowid directly — vec0 requires an INTEGER primary key, and
    // node:sqlite binds a plain JS number as REAL.
    const id = info.lastInsertRowid;
    // vec0 demands a true INTEGER rowid; node:sqlite's bound param needs CAST.
    this.db
      .prepare(
        "INSERT INTO vec_chunks (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)",
      )
      .run(id, JSON.stringify(chunk.embedding));
    this.db
      .prepare("INSERT INTO fts_chunks (rowid, content) VALUES (?, ?)")
      .run(id, chunk.content);
  }

  insertMany(chunks: Array<Omit<CodeChunk, "similarity">>): void {
    this.db.exec("BEGIN");
    try {
      for (const c of chunks) this.insert(c);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Hybrid search: dense KNN (sqlite-vec) + BM25 (FTS5), fused with RRF.
   * `similarity` on results is the dense cosine score where available.
   */
  search(queryEmbedding: number[], query: string, limit = 10): CodeChunk[] {
    const pool = Math.max(limit * 4, 20);

    const dense = this.db
      .prepare(
        "SELECT rowid AS id, distance FROM vec_chunks WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
      )
      .all(JSON.stringify(queryEmbedding), pool) as Array<{
      id: number;
      distance: number;
    }>;

    const ftsExpr = toFtsQuery(query);
    const bm25 = ftsExpr
      ? (this.db
          .prepare(
            "SELECT rowid AS id FROM fts_chunks WHERE fts_chunks MATCH ? ORDER BY bm25(fts_chunks) LIMIT ?",
          )
          .all(ftsExpr, pool) as Array<{ id: number }>)
      : [];

    // Reciprocal Rank Fusion
    const fused = new Map<number, number>();
    const cosine = new Map<number, number>();
    dense.forEach((row, rank) => {
      fused.set(
        row.id,
        (fused.get(row.id) ?? 0) + 1 / (VectorStore.RRF_K + rank),
      );
      cosine.set(row.id, 1 - (row.distance * row.distance) / 2);
    });
    bm25.forEach((row, rank) => {
      fused.set(
        row.id,
        (fused.get(row.id) ?? 0) + 1 / (VectorStore.RRF_K + rank),
      );
    });

    const topIds = [...fused.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);
    if (topIds.length === 0) return [];

    const placeholders = topIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT id, file_path AS filePath, chunk_type AS chunkType, content, metadata FROM chunks WHERE id IN (${placeholders})`,
      )
      .all(...topIds) as Array<{
      id: number;
      filePath: string;
      chunkType: string;
      content: string;
      metadata: string;
    }>;
    const byId = new Map(rows.map((r) => [r.id, r]));

    return topIds
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined)
      .map((r) => ({
        filePath: r.filePath,
        chunkType: r.chunkType,
        content: r.content,
        embedding: [],
        metadata: JSON.parse(r.metadata) as ChunkMetadata,
        similarity: cosine.has(r.id)
          ? Number(cosine.get(r.id)?.toFixed(3))
          : undefined,
      }));
  }

  stats(): { totalChunks: number; totalFiles: number } {
    const totalChunks = (
      this.db.prepare("SELECT COUNT(*) AS c FROM chunks").get() as { c: number }
    ).c;
    const totalFiles = (
      this.db
        .prepare("SELECT COUNT(DISTINCT file_path) AS c FROM chunks")
        .get() as { c: number }
    ).c;
    return { totalChunks, totalFiles };
  }

  close(): void {
    this.db.close();
  }
}

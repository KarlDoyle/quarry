import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { createLogger } from "../logger.js";

const logger = createLogger("VectorStore");

/** Embedding dimension for all-MiniLM-L6-v2. */
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

/**
 * Local, embedded vector store backed by SQLite + sqlite-vec.
 * No external database, no Docker — a single file under the data dir.
 */
export class VectorStore {
  private db: Database.Database;

  constructor(dbFilePath: string) {
    this.db = new Database(dbFilePath);
    this.db.pragma("journal_mode = WAL");
    sqliteVec.load(this.db);
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
         embedding float[${EMBEDDING_DIM}],
         +file_path text,
         +chunk_type text,
         +content text,
         +metadata text
       )`,
    );
    logger.debug("Vector store ready", {
      db: dbFilePath,
      vec: this.vecVersion(),
    });
  }

  vecVersion(): string {
    return (this.db.prepare("select vec_version() as v").get() as { v: string })
      .v;
  }

  /** Wipe all vectors (used for a clean re-index). */
  clear(): void {
    this.db.exec("DELETE FROM vec_chunks");
  }

  insert(chunk: Omit<CodeChunk, "similarity">): void {
    if (chunk.embedding.length !== EMBEDDING_DIM) {
      throw new Error(
        `Embedding must be ${EMBEDDING_DIM}-dim, got ${chunk.embedding.length}`,
      );
    }
    this.db
      .prepare(
        `INSERT INTO vec_chunks (embedding, file_path, chunk_type, content, metadata)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        JSON.stringify(chunk.embedding),
        chunk.filePath,
        chunk.chunkType,
        chunk.content,
        JSON.stringify(chunk.metadata),
      );
  }

  insertMany(chunks: Array<Omit<CodeChunk, "similarity">>): void {
    const tx = this.db.transaction(
      (rows: Array<Omit<CodeChunk, "similarity">>) => {
        for (const r of rows) this.insert(r);
      },
    );
    tx(chunks);
  }

  /**
   * KNN semantic search. Embeddings are L2-normalised, so we convert the
   * sqlite-vec L2 distance to a cosine similarity in [0,1].
   */
  search(queryEmbedding: number[], limit = 10): CodeChunk[] {
    const rows = this.db
      .prepare(
        `SELECT file_path AS filePath, chunk_type AS chunkType, content, metadata, distance
         FROM vec_chunks
         WHERE embedding MATCH ?
         ORDER BY distance
         LIMIT ?`,
      )
      .all(JSON.stringify(queryEmbedding), limit) as Array<{
      filePath: string;
      chunkType: string;
      content: string;
      metadata: string;
      distance: number;
    }>;

    return rows.map((row) => ({
      filePath: row.filePath,
      chunkType: row.chunkType,
      content: row.content,
      embedding: [],
      metadata: JSON.parse(row.metadata) as ChunkMetadata,
      similarity: 1 - (row.distance * row.distance) / 2,
    }));
  }

  stats(): { totalChunks: number; totalFiles: number } {
    const totalChunks = (
      this.db.prepare("SELECT COUNT(*) AS c FROM vec_chunks").get() as {
        c: number;
      }
    ).c;
    const totalFiles = (
      this.db
        .prepare("SELECT COUNT(DISTINCT file_path) AS c FROM vec_chunks")
        .get() as { c: number }
    ).c;
    return { totalChunks, totalFiles };
  }

  close(): void {
    this.db.close();
  }
}

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createLogger } from "../logger.js";
import type { CodeChunk, VectorStore } from "../vector-store/index.js";
import { ASTParser, type CodeEntity } from "./ast-parser.js";
import { createSmartChunks } from "./chunking-strategies.js";
import { EmbeddingGenerator } from "./embedding-generator.js";
import {
  detectLanguage,
  FILE_PATTERNS,
  shouldIndexFile,
} from "./file-patterns.js";

const logger = createLogger("Indexer");

export interface IndexResult {
  files: number;
  chunks: number;
}

/**
 * Pick the entity that actually ENCLOSES a chunk: the smallest-span entity whose
 * [startLine, endLine] contains the chunk's start line. Smallest span wins so a
 * chunk inside a method maps to the method rather than the surrounding class.
 * Returns `undefined` when no entity encloses the chunk — the caller must then
 * omit the entity name and line numbers rather than cite something false.
 */
export function findEnclosingEntity(
  entities: CodeEntity[],
  chunkStartLine: number,
): CodeEntity | undefined {
  let best: CodeEntity | undefined;
  for (const e of entities) {
    if (e.startLine <= chunkStartLine && chunkStartLine <= e.endLine) {
      if (!best || e.endLine - e.startLine < best.endLine - best.startLine) {
        best = e;
      }
    }
  }
  return best;
}

/**
 * Indexing orchestrator: walk a repo → chunk each file (language-aware) →
 * embed locally → store vectors. Paths are stored relative to the repo root
 * so the index is portable and readable.
 */
export class RepositoryIndexer {
  private parser = new ASTParser();
  private embedder = new EmbeddingGenerator();

  constructor(private store: VectorStore) {}

  async initialize(): Promise<void> {
    await this.embedder.initialize();
  }

  /** Full (re)index of a repo directory. Clears the store first. */
  async indexRepository(repoPath: string): Promise<IndexResult> {
    const root = path.resolve(repoPath);
    logger.info(`Indexing ${root}`);
    this.store.clear();

    const files = await this.collectFiles(root);
    logger.info(`Found ${files.length} source files`);

    let chunkCount = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        chunkCount += await this.indexFile(file, root);
      } catch (error) {
        logger.warn(`Skipped ${file}`, error);
      }
      if ((i + 1) % 10 === 0 || i === files.length - 1) {
        logger.info(`  ${i + 1}/${files.length} files, ${chunkCount} chunks`);
      }
    }

    logger.info(`Done: ${files.length} files, ${chunkCount} chunks`);
    return { files: files.length, chunks: chunkCount };
  }

  private async collectFiles(root: string): Promise<string[]> {
    const out: string[] = [];
    const skip = new Set(FILE_PATTERNS.skipDirs);
    const walk = async (dir: string): Promise<void> => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (error) {
        logger.warn(`Cannot read ${dir}`, error);
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!skip.has(entry.name) && !entry.name.startsWith("."))
            await walk(full);
        } else if (shouldIndexFile(entry.name)) {
          out.push(full);
        }
      }
    };
    await walk(root);
    return out;
  }

  private async indexFile(filePath: string, root: string): Promise<number> {
    const content = await fs.readFile(filePath, "utf-8");
    if (!content.trim()) return 0;

    const relativePath = path.relative(root, filePath);
    const language = detectLanguage(path.basename(filePath));
    const entities = await this.parser.parseFile(filePath);
    const chunks = createSmartChunks(content, language);

    const rows: Array<Omit<CodeChunk, "similarity">> = [];
    for (const chunk of chunks) {
      if (!chunk.content.trim()) continue;
      const embedding = await this.embedder.generateEmbedding(chunk.content);
      // Attribute the chunk to the entity that genuinely encloses it, carrying
      // that entity's REAL line span. When nothing encloses the chunk we leave
      // entityName/startLine/endLine unset: an honest absence beats a fabricated
      // citation.
      const entity = findEnclosingEntity(entities, chunk.startLine);
      rows.push({
        filePath: relativePath,
        chunkType: entity?.type ?? "code",
        content: chunk.content,
        embedding,
        metadata: entity
          ? {
              entityName: entity.name,
              startLine: entity.startLine,
              endLine: entity.endLine,
              language,
            }
          : { language },
      });
    }
    this.store.insertMany(rows);
    return rows.length;
  }
}

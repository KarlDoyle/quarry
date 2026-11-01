import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createLogger } from "../logger.js";
import type { CodeChunk, VectorStore } from "../vector-store/index.js";
import { ASTParser, type CodeEntity } from "./ast-parser.js";
import { createSmartChunks } from "./chunking-strategies.js";
import { type Embedder, EmbeddingGenerator } from "./embedding-generator.js";
import {
  detectLanguage,
  FILE_PATTERNS,
  shouldIndexFile,
} from "./file-patterns.js";

const logger = createLogger("Indexer");
const MAX_INDEX_FILE_BYTES = 1_000_000;

interface IgnoreRule {
  negated: boolean;
  pattern: RegExp;
}

function compileIgnoreRule(line: string, base: string): IgnoreRule | undefined {
  let source = line.trim();
  if (!source || source.startsWith("#")) return undefined;
  const negated = source.startsWith("!");
  if (negated) source = source.slice(1);
  if (!source) return undefined;
  source = source.replace(/^\//, "");
  const directoryOnly = source.endsWith("/");
  source = source.replace(/\/$/, "");
  const hasSlash = source.includes("/");
  let glob = "";
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "*" && source[i + 1] === "*") {
      glob += ".*";
      i++;
    } else if (char === "*") glob += "[^/]*";
    else if (char === "?") glob += "[^/]";
    else glob += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  const prefix = base ? `${base}/` : "";
  const target = hasSlash ? `${prefix}${glob}` : `${prefix}(?:.*/)?${glob}`;
  try {
    return {
      negated,
      pattern: new RegExp(`^${target}${directoryOnly ? "(?:/.*)?" : ""}$`),
    };
  } catch {
    return undefined;
  }
}

async function readIgnoreRules(
  dir: string,
  root: string,
): Promise<IgnoreRule[]> {
  try {
    const contents = await fs.readFile(path.join(dir, ".gitignore"), "utf8");
    const base = path.relative(root, dir).split(path.sep).join("/");
    return contents
      .split(/\r?\n/)
      .map((line) => compileIgnoreRule(line, base))
      .filter((rule): rule is IgnoreRule => rule !== undefined);
  } catch {
    return [];
  }
}

function isIgnored(relativePath: string, rules: IgnoreRule[]): boolean {
  let ignored = false;
  const normalized = relativePath.split(path.sep).join("/");
  for (const rule of rules) {
    if (rule.pattern.test(normalized)) ignored = !rule.negated;
  }
  return ignored;
}

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

  constructor(
    private store: VectorStore,
    private embedder: Embedder = new EmbeddingGenerator(),
  ) {}

  async initialize(): Promise<void> {
    await this.embedder.initialize();
  }

  /** Full (re)index of a repo directory. Existing data survives a failed run. */
  async indexRepository(repoPath: string): Promise<IndexResult> {
    const root = path.resolve(repoPath);
    logger.info(`Indexing ${root}`);
    const files = await this.collectFiles(root);
    logger.info(`Found ${files.length} source files`);

    this.store.beginReplacement();
    let chunkCount = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        chunkCount += await this.indexFile(file, root);
        if ((i + 1) % 10 === 0 || i === files.length - 1) {
          logger.info(`  ${i + 1}/${files.length} files, ${chunkCount} chunks`);
        }
      }
      this.store.commitReplacement();
    } catch (error) {
      this.store.rollbackReplacement();
      throw error;
    }

    logger.info(`Done: ${files.length} files, ${chunkCount} chunks`);
    return { files: files.length, chunks: chunkCount };
  }

  private async collectFiles(root: string): Promise<string[]> {
    const out: string[] = [];
    const skip = new Set(FILE_PATTERNS.skipDirs);
    const walk = async (
      dir: string,
      inheritedRules: IgnoreRule[],
    ): Promise<void> => {
      const rules = [...inheritedRules, ...(await readIgnoreRules(dir, root))];
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (error) {
        throw new Error(`Cannot read ${dir}: ${String(error)}`);
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const relative = path.relative(root, full);
        if (isIgnored(relative, rules)) continue;
        if (entry.isDirectory()) {
          if (!skip.has(entry.name) && !entry.name.startsWith("."))
            await walk(full, rules);
        } else if (entry.isFile() && shouldIndexFile(entry.name)) {
          out.push(full);
        }
      }
    };
    await walk(root, []);
    return out;
  }

  private async indexFile(filePath: string, root: string): Promise<number> {
    const fileStat = await fs.stat(filePath);
    if (fileStat.size > MAX_INDEX_FILE_BYTES) {
      logger.warn(
        `Skipped oversized file (${fileStat.size} bytes): ${filePath}`,
      );
      return 0;
    }
    const content = await fs.readFile(filePath, "utf-8");
    if (content.includes("\0")) {
      logger.warn(`Skipped binary file: ${filePath}`);
      return 0;
    }
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

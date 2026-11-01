import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Embedder } from "../src/indexer/embedding-generator.js";
import { RepositoryIndexer } from "../src/indexer/index.js";
import { VectorStore } from "../src/vector-store/index.js";

const roots: string[] = [];

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "quarry-indexer-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fakeEmbedder(shouldFail = false): Embedder {
  return {
    initialize: async () => {},
    generateEmbedding: async (text) => {
      if (shouldFail && text.includes("trigger failure")) {
        throw new Error("embedding failed");
      }
      return Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0));
    },
  };
}

function writeSource(root: string, name: string, content: string): void {
  const path = join(root, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

describe("RepositoryIndexer safeguards", () => {
  it("honors ignore rules and skips sensitive, oversized, and binary files", async () => {
    const root = repo();
    writeSource(root, ".gitignore", "generated/\n*.tmp.ts\n!keep.tmp.ts\n");
    writeSource(root, "keep.tmp.ts", "export const safe = true;");
    writeSource(root, "drop.tmp.ts", "export const hidden = true;");
    writeSource(root, "credentials.ts", "export const privateValue = true;");
    writeSource(root, "generated/ignored.ts", "export const ignored = true;");
    writeSource(root, "nested/.gitignore", "skip.ts\n");
    writeSource(root, "nested/skip.ts", "export const skipped = true;");
    writeSource(root, "nested/keep.ts", "export const kept = true;");
    writeSource(root, "large.ts", "x".repeat(1_000_001));
    writeSource(root, "binary.ts", "\0binary");

    const store = new VectorStore(":memory:");
    try {
      const result = await new RepositoryIndexer(
        store,
        fakeEmbedder(),
      ).indexRepository(root);
      expect(result.files).toBe(4);
      expect(store.stats()).toEqual({ totalChunks: 2, totalFiles: 2 });
    } finally {
      store.close();
    }
  });

  it("keeps the prior index if the replacement fails", async () => {
    const root = repo();
    writeSource(root, "replacement.ts", "trigger failure");
    const store = new VectorStore(":memory:");
    store.insert({
      filePath: "previous.ts",
      chunkType: "code",
      content: "previous index",
      embedding: [1, ...Array<number>(383).fill(0)],
      metadata: {},
    });

    try {
      await expect(
        new RepositoryIndexer(store, fakeEmbedder(true)).indexRepository(root),
      ).rejects.toThrow("embedding failed");
      expect(store.stats()).toEqual({ totalChunks: 1, totalFiles: 1 });
    } finally {
      store.close();
    }
  });
});

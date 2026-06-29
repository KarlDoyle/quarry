import { describe, expect, it } from "vitest";
import { EmbeddingGenerator } from "../src/indexer/embedding-generator.js";
import { VectorStore } from "../src/vector-store/index.js";

/**
 * Proves the real pipeline end-to-end (local embeddings + sqlite-vec KNN),
 * no network and no LLM. The LLM `analyze` step is exercised separately and
 * needs a live API key, so it is intentionally not asserted here.
 */
describe("rag retrieval", () => {
  it("ranks the semantically closest chunk first", async () => {
    const store = new VectorStore(":memory:");
    const embedder = new EmbeddingGenerator();
    await embedder.initialize();

    const docs = [
      {
        filePath: "auth.ts",
        text: "hash and verify user login passwords securely",
      },
      {
        filePath: "cart.js",
        text: "calculate shopping cart total with discount and tax",
      },
      {
        filePath: "retry.py",
        text: "retry a failing network request with exponential backoff",
      },
    ];
    for (const d of docs) {
      store.insert({
        filePath: d.filePath,
        chunkType: "code",
        content: d.text,
        embedding: await embedder.generateEmbedding(d.text),
        metadata: { language: "test" },
      });
    }

    const results = store.search(
      await embedder.generateEmbedding("how do I verify a user's password"),
      3,
    );
    expect(results.length).toBe(3);
    expect(results[0].filePath).toBe("auth.ts");
    // top hit should clearly beat the runner-up
    expect(results[0].similarity ?? 0).toBeGreaterThan(
      results[1].similarity ?? 0,
    );

    store.close();
  }, 60_000);

  it("reports accurate stats", async () => {
    const store = new VectorStore(":memory:");
    const embedder = new EmbeddingGenerator();
    await embedder.initialize();
    const emb = await embedder.generateEmbedding("hello world");
    store.insert({
      filePath: "a.ts",
      chunkType: "code",
      content: "x",
      embedding: emb,
      metadata: {},
    });
    store.insert({
      filePath: "a.ts",
      chunkType: "code",
      content: "y",
      embedding: emb,
      metadata: {},
    });
    store.insert({
      filePath: "b.ts",
      chunkType: "code",
      content: "z",
      embedding: emb,
      metadata: {},
    });
    expect(store.stats()).toEqual({ totalChunks: 3, totalFiles: 2 });
    store.close();
  }, 60_000);
});

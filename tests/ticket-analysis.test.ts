import { describe, expect, it } from "vitest";
import { AnalysisAgent } from "../src/agent/index.js";
import type { LLMProvider } from "../src/agent/providers.js";
import { EmbeddingGenerator } from "../src/indexer/embedding-generator.js";
import { RepositoryIndexer } from "../src/indexer/index.js";
import { loadJiraFixture } from "../src/ingest/jira.js";
import { VectorStore } from "../src/vector-store/index.js";

/** Records the prompt and returns a canned answer — no network, no real LLM. */
class MockLLM implements LLMProvider {
  readonly name = "mock";
  readonly model = "mock";
  calls = 0;
  lastUser = "";
  async complete(_system: string, user: string): Promise<string> {
    this.calls++;
    this.lastUser = user;
    return "Approach: fix the order of discount vs tax in src/cart.js.";
  }
}

async function indexedSampleStore(): Promise<{
  store: VectorStore;
  embedder: EmbeddingGenerator;
}> {
  const store = new VectorStore(":memory:");
  const embedder = new EmbeddingGenerator();
  const indexer = new RepositoryIndexer(store);
  await indexer.initialize();
  await indexer.indexRepository("examples/sample-repo");
  return { store, embedder };
}

describe("ticket analysis (offline, LLM mocked)", () => {
  it("triages a fixture ticket against the indexed repo and cites the right file", async () => {
    const { store, embedder } = await indexedSampleStore();
    const ticket = loadJiraFixture("tests/fixtures/jira-issue.json");
    expect(ticket.key).toBe("PROJ-100");

    const llm = new MockLLM();
    const agent = new AnalysisAgent(store, embedder, llm);
    const result = await agent.analyzeTicket(ticket, undefined, 5);
    store.close();

    expect(llm.calls).toBe(1);
    // the retrieved context handed to the LLM should include the cart code
    expect(llm.lastUser).toContain("cart");
    expect(result.sources.some((s) => s.filePath.includes("cart"))).toBe(true);
  }, 90_000);
});

describe("retrieval quality (recall@3 gold set)", () => {
  it("retrieves the expected file in the top 3 for each query", async () => {
    const { store, embedder } = await indexedSampleStore();
    const agent = new AnalysisAgent(store, embedder, new MockLLM());
    const gold: Array<{ q: string; file: string }> = [
      { q: "hash and verify a user password", file: "auth" },
      { q: "retry a network request with backoff", file: "retry" },
      { q: "calculate the shopping cart total with tax", file: "cart" },
    ];
    let hits = 0;
    for (const { q, file } of gold) {
      const chunks = await agent.retrieve(q, 3);
      if (chunks.some((c) => c.filePath.includes(file))) hits++;
    }
    store.close();
    expect(hits / gold.length).toBe(1); // recall@3 == 100%
  }, 90_000);
});

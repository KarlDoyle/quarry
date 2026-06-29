import type { EmbeddingGenerator } from "../indexer/embedding-generator.js";
import { createLogger } from "../logger.js";
import type { CodeChunk, VectorStore } from "../vector-store/index.js";
import type { LLMProvider } from "./providers.js";

const logger = createLogger("Agent");

export interface AnalysisSource {
  filePath: string;
  similarity: number;
  entityName?: string;
}

export interface AnalysisResult {
  answer: string;
  sources: AnalysisSource[];
  model: string;
}

/**
 * Retrieval-augmented analysis: embed the question, pull the most relevant code
 * chunks from the local vector store, and ask the configured LLM to answer
 * grounded ONLY in that context — citing the files it used. The LLM is injected
 * (local Ollama by default), so the agent stays vendor-agnostic.
 */
export class AnalysisAgent {
  constructor(
    private store: VectorStore,
    private embedder: EmbeddingGenerator,
    private llm: LLMProvider,
  ) {}

  /** Retrieve relevant chunks for a query (no LLM call — useful + testable on its own). */
  async retrieve(query: string, topK = 8): Promise<CodeChunk[]> {
    const queryEmbedding = await this.embedder.generateEmbedding(query);
    return this.store.search(queryEmbedding, topK);
  }

  async analyze(query: string, topK = 8): Promise<AnalysisResult> {
    const chunks = await this.retrieve(query, topK);
    if (chunks.length === 0) {
      return {
        answer: "No indexed code matched this query. Have you run `index` yet?",
        sources: [],
        model: this.llm.model,
      };
    }

    const context = chunks
      .map(
        (c, i) =>
          `### Source ${i + 1}: ${c.filePath}${c.metadata.entityName ? ` (${c.metadata.entityName})` : ""}\n\`\`\`\n${c.content}\n\`\`\``,
      )
      .join("\n\n");

    const system =
      "You are a senior engineer answering questions about a codebase. " +
      "Answer ONLY using the provided code context. If the context is insufficient, say so plainly. " +
      "Cite the source file paths you relied on. Be concise and concrete.";

    logger.info(
      `Analyzing with ${chunks.length} sources via ${this.llm.name} (${this.llm.model})`,
    );
    const answer = (
      await this.llm.complete(
        system,
        `Question: ${query}\n\nCode context:\n${context}`,
      )
    ).trim();

    return {
      answer,
      sources: chunks.map((c) => ({
        filePath: c.filePath,
        similarity: Number((c.similarity ?? 0).toFixed(3)),
        entityName: c.metadata.entityName,
      })),
      model: this.llm.model,
    };
  }
}

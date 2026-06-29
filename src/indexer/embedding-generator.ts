import { createLogger } from "../logger.js";

const logger = createLogger("EmbeddingGenerator");

/** Anything that turns text into a vector. Lets the embedding model be swapped. */
export interface Embedder {
  initialize(): Promise<void>;
  generateEmbedding(text: string): Promise<number[]>;
}

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";

/**
 * Local, in-process embeddings via transformers.js — no server, no API key, so
 * indexing + search work fully offline (and inside a container). The model is
 * swappable with DEVTOOL_EMBED_MODEL (any transformers.js feature-extraction
 * model); the default is the 384-dim all-MiniLM-L6-v2.
 */
export class EmbeddingGenerator implements Embedder {
  private model: any;
  readonly modelName: string;

  constructor(
    modelName: string = process.env.DEVTOOL_EMBED_MODEL ?? DEFAULT_MODEL,
  ) {
    this.modelName = modelName;
  }

  async initialize(): Promise<void> {
    try {
      logger.info(`Initializing embedding model (${this.modelName})...`);
      // Dynamically import to avoid WASM issues
      const { pipeline } = await import("@xenova/transformers");
      logger.info("Loading model (first run downloads it once)...");
      this.model = await pipeline("feature-extraction", this.modelName, {
        quantized: true,
      });
      logger.info("Embedding model initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize embedding model", error);
      throw error;
    }
  }

  /**
   * Generate embedding for a single text chunk
   * Returns a 384-dimensional vector
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      if (!this.model) {
        await this.initialize();
      }

      // Limit text length to avoid memory issues
      const truncatedText = text.substring(0, 2000);

      // Generate embedding
      const result = await this.model(truncatedText, {
        pooling: "mean",
        normalize: true,
      });

      // Convert Tensor to array
      const embedding = Array.from(result.data) as number[];

      logger.debug("Generated embedding", {
        textLength: truncatedText.length,
        embeddingDim: embedding.length,
      });

      return embedding;
    } catch (error) {
      logger.error("Failed to generate embedding", error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts
   */
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];

    for (let i = 0; i < texts.length; i++) {
      logger.info(`Generating embedding ${i + 1}/${texts.length}`);
      const embedding = await this.generateEmbedding(texts[i]);
      embeddings.push(embedding);
    }

    return embeddings;
  }
}

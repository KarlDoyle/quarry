import { createLogger } from "../logger.js";

const logger = createLogger("EmbeddingGenerator");

/**
 * Generates vector embeddings for code chunks
 * Uses Xenova transformers for local, fast embedding generation
 */
export class EmbeddingGenerator {
  private model: any;

  /**
   * Initialize the embedding model (downloads on first run)
   * This happens once and caches locally
   */
  async initialize(): Promise<void> {
    try {
      logger.info("Initializing embedding model...");

      // Dynamically import to avoid WASM issues
      const { pipeline } = await import("@xenova/transformers");

      logger.info(
        "Loading all-MiniLM-L6-v2 model (this may take a minute on first run)...",
      );
      this.model = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
        { quantized: true }, // Use quantized version for faster loading
      );

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

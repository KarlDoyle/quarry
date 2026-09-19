/**
 * Quarry — public library surface.
 * Use the CLI for the common path; import these to embed RAG in your own tools.
 */

export {
  AnalysisAgent,
  type AnalysisResult,
  type AnalysisSource,
} from "./agent/index.js";
export {
  AnthropicProvider,
  FallbackProvider,
  type LLMProvider,
  MossProvider,
  OllamaProvider,
} from "./agent/providers.js";
export { type Config, dbPath, loadConfig } from "./config.js";
export { ASTParser, type CodeEntity } from "./indexer/ast-parser.js";
export {
  type Embedder,
  EmbeddingGenerator,
} from "./indexer/embedding-generator.js";
export { type IndexResult, RepositoryIndexer } from "./indexer/index.js";
export {
  GitHubClient,
  loadRepoFixture,
  parseRepo,
  type RepoInfo,
} from "./ingest/github.js";
export {
  JiraClient,
  loadJiraFixture,
  parseJiraIssue,
  type Ticket,
} from "./ingest/jira.js";
export { createLogger, type ILogger } from "./logger.js";
export {
  type ChunkMetadata,
  type CodeChunk,
  EMBEDDING_DIM,
  VectorStore,
} from "./vector-store/index.js";

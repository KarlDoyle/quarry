/**
 * devtool-rag — public library surface.
 * Use the CLI for the common path; import these to embed RAG in your own tools.
 */
export { loadConfig, dbPath, type Config } from "./config.js";
export {
  VectorStore,
  EMBEDDING_DIM,
  type CodeChunk,
  type ChunkMetadata,
} from "./vector-store/index.js";
export { RepositoryIndexer, type IndexResult } from "./indexer/index.js";
export {
  EmbeddingGenerator,
  type Embedder,
} from "./indexer/embedding-generator.js";
export { ASTParser, type CodeEntity } from "./indexer/ast-parser.js";
export {
  JiraClient,
  parseJiraIssue,
  loadJiraFixture,
  type Ticket,
} from "./ingest/jira.js";
export {
  GitHubClient,
  parseRepo,
  loadRepoFixture,
  type RepoInfo,
} from "./ingest/github.js";
export {
  AnalysisAgent,
  type AnalysisResult,
  type AnalysisSource,
} from "./agent/index.js";
export {
  type LLMProvider,
  OllamaProvider,
  AnthropicProvider,
  FallbackProvider,
} from "./agent/providers.js";
export { createLogger, type ILogger } from "./logger.js";

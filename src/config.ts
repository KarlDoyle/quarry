import * as path from "node:path";

/**
 * All configuration comes from the environment — no config files written to disk,
 * no secrets stored anywhere. Keeps the tool portable and side-effect-free.
 *
 * The `analyze` LLM step defaults to LOCAL Ollama (free, on-device, no API key).
 * Set QUARRY_PROVIDER=anthropic to use the paid Anthropic API instead.
 *
 * Set QUARRY_LLM=moss to route the local path through moss (the local-first
 * deterministic router) as a library instead of calling Ollama directly. moss
 * still resolves to a local lane (Ollama), so this stays key-free; if moss isn't
 * installed/available Quarry falls back to the direct Ollama path automatically.
 */
export type ProviderName = "ollama" | "anthropic";

/** Which engine drives the local path: moss's router, or Quarry's direct Ollama client. */
export type LlmRouter = "moss" | "ollama";

export interface Config {
  /** Where the local index DB + cloned repos live. Defaults to ./data. */
  dataDir: string;
  /** Which LLM backs `analyze`. Defaults to local Ollama. */
  provider: ProviderName;
  /** Engine for the local path. `moss` delegates to moss's router; `ollama` calls Ollama directly (default). */
  llmRouter: LlmRouter;
  /** Model name (provider-specific default if unset). */
  model: string;
  /** Ollama daemon endpoint. */
  ollamaHost: string;
  /** Anthropic key — only read when provider=anthropic. */
  anthropicApiKey: string | undefined;
}

export function loadConfig(): Config {
  const dataDir = process.env.QUARRY_DATA_DIR
    ? path.resolve(process.env.QUARRY_DATA_DIR)
    : path.resolve(process.cwd(), "data");

  const provider: ProviderName =
    process.env.QUARRY_PROVIDER === "anthropic" ? "anthropic" : "ollama";
  const defaultModel =
    provider === "anthropic" ? "claude-haiku-4-5-20251001" : "llama3.1";
  // Default keeps the current behaviour (direct Ollama). Opt into the moss
  // router with QUARRY_LLM=moss.
  const llmRouter: LlmRouter =
    process.env.QUARRY_LLM === "moss" ? "moss" : "ollama";

  return {
    dataDir,
    provider,
    llmRouter,
    model: process.env.QUARRY_MODEL ?? defaultModel,
    ollamaHost: process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  };
}

export function dbPath(config: Config): string {
  return path.join(config.dataDir, "index.db");
}

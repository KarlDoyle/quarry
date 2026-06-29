import * as path from "node:path";

/**
 * All configuration comes from the environment — no config files written to disk,
 * no secrets stored anywhere. Keeps the tool portable and side-effect-free.
 *
 * The `analyze` LLM step defaults to LOCAL Ollama (free, on-device, no API key).
 * Set DEVTOOL_PROVIDER=anthropic to use the paid Anthropic API instead.
 */
export type ProviderName = "ollama" | "anthropic";

export interface Config {
  /** Where the local index DB + cloned repos live. Defaults to ./data. */
  dataDir: string;
  /** Which LLM backs `analyze`. Defaults to local Ollama. */
  provider: ProviderName;
  /** Model name (provider-specific default if unset). */
  model: string;
  /** Ollama daemon endpoint. */
  ollamaHost: string;
  /** Anthropic key — only read when provider=anthropic. */
  anthropicApiKey: string | undefined;
}

export function loadConfig(): Config {
  const dataDir = process.env.DEVTOOL_DATA_DIR
    ? path.resolve(process.env.DEVTOOL_DATA_DIR)
    : path.resolve(process.cwd(), "data");

  const provider: ProviderName =
    process.env.DEVTOOL_PROVIDER === "anthropic" ? "anthropic" : "ollama";
  const defaultModel =
    provider === "anthropic" ? "claude-3-5-haiku-latest" : "llama3.1";

  return {
    dataDir,
    provider,
    model: process.env.DEVTOOL_MODEL ?? defaultModel,
    ollamaHost: process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  };
}

export function dbPath(config: Config): string {
  return path.join(config.dataDir, "index.db");
}

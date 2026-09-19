import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Config, dbPath, loadConfig } from "../src/config.js";

/**
 * Configuration is read from the environment only. These tests pin the defaults
 * (local Ollama, direct router, ./data) and each opt-in override, so a change to
 * the default provider or model can't slip through unnoticed.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

function clearQuarryEnv(): void {
  for (const key of [
    "QUARRY_DATA_DIR",
    "QUARRY_PROVIDER",
    "QUARRY_LLM",
    "QUARRY_MODEL",
    "OLLAMA_HOST",
    "ANTHROPIC_API_KEY",
  ]) {
    vi.stubEnv(key, undefined);
  }
}

describe("loadConfig defaults", () => {
  it("defaults to local Ollama, the direct router and ./data", () => {
    clearQuarryEnv();
    const config = loadConfig();

    expect(config.provider).toBe("ollama");
    expect(config.llmRouter).toBe("ollama");
    expect(config.model).toBe("llama3.1");
    expect(config.ollamaHost).toBe("http://127.0.0.1:11434");
    expect(config.anthropicApiKey).toBeUndefined();
    expect(config.dataDir).toBe(path.resolve(process.cwd(), "data"));
  });

  it("uses the Anthropic default model only when the provider is anthropic", () => {
    clearQuarryEnv();
    vi.stubEnv("QUARRY_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");

    const config = loadConfig();
    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("claude-haiku-4-5-20251001");
    expect(config.anthropicApiKey).toBe("test-key-not-real");
  });

  it("treats an unrecognised provider as ollama", () => {
    clearQuarryEnv();
    vi.stubEnv("QUARRY_PROVIDER", "openai");

    expect(loadConfig().provider).toBe("ollama");
  });
});

describe("loadConfig overrides", () => {
  it("opts into the moss router with QUARRY_LLM=moss and nothing else", () => {
    clearQuarryEnv();
    vi.stubEnv("QUARRY_LLM", "moss");
    expect(loadConfig().llmRouter).toBe("moss");

    vi.stubEnv("QUARRY_LLM", "ollama");
    expect(loadConfig().llmRouter).toBe("ollama");

    vi.stubEnv("QUARRY_LLM", "something-else");
    expect(loadConfig().llmRouter).toBe("ollama");
  });

  it("honours an explicit model and Ollama host", () => {
    clearQuarryEnv();
    vi.stubEnv("QUARRY_MODEL", "qwen3:8b");
    vi.stubEnv("OLLAMA_HOST", "http://ollama.internal:1234");

    const config = loadConfig();
    expect(config.model).toBe("qwen3:8b");
    expect(config.ollamaHost).toBe("http://ollama.internal:1234");
  });

  it("resolves QUARRY_DATA_DIR to an absolute path", () => {
    clearQuarryEnv();
    vi.stubEnv("QUARRY_DATA_DIR", "relative/store");

    expect(loadConfig().dataDir).toBe(
      path.resolve(process.cwd(), "relative/store"),
    );
  });
});

describe("dbPath", () => {
  it("puts index.db inside the configured data dir", () => {
    const config = { dataDir: "/tmp/quarry-test" } as Config;
    expect(dbPath(config)).toBe(path.join("/tmp/quarry-test", "index.db"));
  });
});

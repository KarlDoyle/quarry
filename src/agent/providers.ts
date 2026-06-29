import { createLogger } from "../logger.js";

const logger = createLogger("LLM");

/** A minimal chat-completion provider. Keeps the agent independent of any one vendor. */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(system: string, user: string): Promise<string>;
}

/**
 * Tries `primary`; on failure (e.g. Ollama not running), falls back to `fallback`
 * (e.g. Anthropic if a key is configured). Determinism note: the fallback only
 * fires on error, so the normal path stays predictable.
 */
export class FallbackProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;
  constructor(
    private primary: LLMProvider,
    private fallback: LLMProvider,
  ) {
    this.name = `${primary.name}→${fallback.name}`;
    this.model = primary.model;
  }
  async complete(system: string, user: string): Promise<string> {
    try {
      return await this.primary.complete(system, user);
    } catch (error) {
      logger.warn(
        `${this.primary.name} failed; falling back to ${this.fallback.name}`,
        error,
      );
      return this.fallback.complete(system, user);
    }
  }
}

/**
 * Local Ollama provider — the default. Free, on-device, no API key.
 * Talks to the local Ollama daemon (`ollama serve`).
 */
export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  constructor(
    readonly model: string,
    private readonly host = "http://127.0.0.1:11434",
  ) {}

  async complete(system: string, user: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${this.host}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
    } catch {
      throw new Error(
        `Could not reach Ollama at ${this.host}. Start it with \`ollama serve\` (and \`ollama pull ${this.model}\`).`,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Ollama returned HTTP ${res.status}. Is the model "${this.model}" pulled? ${body}`.trim(),
      );
    }
    const data = (await res.json()) as { message?: { content?: string } };
    logger.debug("Ollama completion received");
    return data.message?.content ?? "";
  }
}

/**
 * Optional Anthropic provider. Only used when explicitly selected
 * (DEVTOOL_PROVIDER=anthropic) — it bills the pay-per-token API, separate from
 * any Claude subscription, so it is never the default.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  constructor(
    readonly model: string,
    private readonly apiKey: string,
  ) {}

  async complete(system: string, user: string): Promise<string> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });
    const msg = await client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    });
    return msg.content
      .filter(
        (b): b is import("@anthropic-ai/sdk").Anthropic.TextBlock =>
          b.type === "text",
      )
      .map((b) => b.text)
      .join("\n")
      .trim();
  }
}

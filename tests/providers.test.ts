import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FallbackProvider,
  type LLMProvider,
  OllamaProvider,
} from "../src/agent/providers.js";

/**
 * Providers are the other network boundary. `fetch` is stubbed throughout — no
 * test may start or reach an Ollama daemon. What matters here is the contract the
 * agent relies on: the fallback fires on error and only on error, and Ollama
 * failures surface as actionable messages rather than raw fetch errors.
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeProvider(
  name: string,
  behaviour: (system: string, user: string) => Promise<string>,
): LLMProvider {
  return { name, model: `${name}-model`, complete: behaviour };
}

describe("FallbackProvider", () => {
  it("names itself after both legs and takes the primary's model", () => {
    const provider = new FallbackProvider(
      fakeProvider("primary", async () => "a"),
      fakeProvider("secondary", async () => "b"),
    );
    expect(provider.name).toBe("primary→secondary");
    expect(provider.model).toBe("primary-model");
  });

  it("never calls the fallback when the primary succeeds", async () => {
    let fallbackCalls = 0;
    const provider = new FallbackProvider(
      fakeProvider("primary", async () => "from primary"),
      fakeProvider("secondary", async () => {
        fallbackCalls += 1;
        return "from secondary";
      }),
    );

    await expect(provider.complete("sys", "user")).resolves.toBe(
      "from primary",
    );
    expect(fallbackCalls).toBe(0);
  });

  it("falls back on error and passes the same prompts through", async () => {
    const seen: [string, string][] = [];
    const provider = new FallbackProvider(
      fakeProvider("primary", async () => {
        throw new Error("ollama down");
      }),
      fakeProvider("secondary", async (system, user) => {
        seen.push([system, user]);
        return "from secondary";
      }),
    );

    await expect(provider.complete("sys", "user")).resolves.toBe(
      "from secondary",
    );
    expect(seen).toEqual([["sys", "user"]]);
  });
});

describe("OllamaProvider", () => {
  it("posts a non-streaming chat request and returns the message content", async () => {
    let url = "";
    let init: RequestInit = {};
    vi.stubGlobal("fetch", async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return new Response(JSON.stringify({ message: { content: "hello" } }), {
        status: 200,
      });
    });

    const provider = new OllamaProvider("llama3.1", "http://localhost:9999");
    await expect(provider.complete("sys", "user")).resolves.toBe("hello");

    expect(provider.name).toBe("ollama");
    expect(url).toBe("http://localhost:9999/api/chat");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "llama3.1",
      stream: false,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "user" },
      ],
    });
  });

  it("returns an empty string when the daemon answers without content", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({}), { status: 200 }),
    );
    await expect(
      new OllamaProvider("llama3.1").complete("sys", "user"),
    ).resolves.toBe("");
  });

  it("turns an unreachable daemon into a start-it-yourself message", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });

    await expect(
      new OllamaProvider("llama3.1", "http://localhost:9999").complete(
        "sys",
        "user",
      ),
    ).rejects.toThrow(/Could not reach Ollama at http:\/\/localhost:9999/);
  });

  it("reports a non-OK status with the response body attached", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("model not found", { status: 404 }),
    );

    await expect(
      new OllamaProvider("missing-model").complete("sys", "user"),
    ).rejects.toThrow(
      /Ollama returned HTTP 404.*missing-model.*model not found/s,
    );
  });
});

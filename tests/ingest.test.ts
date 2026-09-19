import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GitHubClient,
  loadRepoFixture,
  parseRepo,
} from "../src/ingest/github.js";
import { fetchJson } from "../src/ingest/http.js";
import {
  JiraClient,
  loadJiraFixture,
  parseJiraIssue,
} from "../src/ingest/jira.js";

/**
 * The ingest layer is the only code that talks to the network. These tests stub
 * `fetch` outright — nothing here may reach GitHub or Jira — and pin the two
 * behaviours that matter: retry 5xx, never retry 4xx, and parse defensively so a
 * malformed payload yields empty strings rather than throwing.
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(...responses: (Response | Error)[]): { calls: number } {
  const state = { calls: 0 };
  vi.stubGlobal("fetch", async () => {
    const next = responses[Math.min(state.calls, responses.length - 1)];
    state.calls += 1;
    if (next instanceof Error) throw next;
    return next;
  });
  return state;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function fixture(name: string, body: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "quarry-ingest-"));
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(body), "utf-8");
  return file;
}

describe("fetchJson", () => {
  it("returns the parsed body on the first success", async () => {
    const state = stubFetch(json({ ok: true }));
    await expect(fetchJson("https://example.test/a")).resolves.toEqual({
      ok: true,
    });
    expect(state.calls).toBe(1);
  });

  it("retries a 5xx and succeeds on the next attempt", async () => {
    const state = stubFetch(
      new Response("boom", { status: 503 }),
      json([1, 2]),
    );
    await expect(
      fetchJson("https://example.test/b", {}, { baseDelayMs: 1 }),
    ).resolves.toEqual([1, 2]);
    expect(state.calls).toBe(2);
  });

  it("does not retry a 4xx — it throws on the first attempt", async () => {
    const state = stubFetch(new Response("nope", { status: 404 }));
    await expect(
      fetchJson("https://example.test/c", {}, { baseDelayMs: 1 }),
    ).rejects.toThrow(/HTTP 404/);
    expect(state.calls).toBe(1);
  });

  it("gives up after the configured retries and rethrows the last error", async () => {
    const state = stubFetch(new Error("network down"));
    await expect(
      fetchJson("https://example.test/d", {}, { retries: 2, baseDelayMs: 1 }),
    ).rejects.toThrow("network down");
    expect(state.calls).toBe(3);
  });
});

describe("parseRepo", () => {
  it("maps a GitHub repo payload", () => {
    expect(
      parseRepo({
        full_name: "KarlDoyle/quarry",
        description: "code search",
        language: "TypeScript",
        default_branch: "main",
      }),
    ).toEqual({
      fullName: "KarlDoyle/quarry",
      description: "code search",
      language: "TypeScript",
      defaultBranch: "main",
    });
  });

  it("returns empty strings for a null or partial payload", () => {
    expect(parseRepo(null)).toEqual({
      fullName: "",
      description: "",
      language: "",
      defaultBranch: "",
    });
    expect(parseRepo({ full_name: "a/b" }).language).toBe("");
  });

  it("loads a saved repo JSON from disk", () => {
    const file = fixture("repo.json", { full_name: "a/b", language: "Go" });
    expect(loadRepoFixture(file)).toMatchObject({
      fullName: "a/b",
      language: "Go",
    });
  });
});

describe("GitHubClient", () => {
  it("sends a bearer token only when one was supplied", async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      seen.push(init);
      return json({ full_name: "a/b" });
    });

    await new GitHubClient().getRepo("a", "b");
    await new GitHubClient("tok").getRepo("a", "b");

    const headers = seen.map((i) => i.headers as Record<string, string>);
    expect(headers[0].Authorization).toBeUndefined();
    expect(headers[0].Accept).toBe("application/vnd.github+json");
    expect(headers[1].Authorization).toBe("Bearer tok");
  });
});

describe("parseJiraIssue", () => {
  it("flattens an Atlassian Document Format description to text", () => {
    const ticket = parseJiraIssue({
      key: "QUA-1",
      fields: {
        summary: "Search is slow",
        description: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "First" }] },
            { type: "paragraph", content: [{ type: "text", text: "second." }] },
          ],
        },
        status: { name: "To Do" },
        issuetype: { name: "Bug" },
        priority: { name: "High" },
      },
    });

    expect(ticket).toEqual({
      key: "QUA-1",
      summary: "Search is slow",
      description: "First second.",
      status: "To Do",
      type: "Bug",
      priority: "High",
    });
  });

  it("passes a plain-string description through and tolerates a missing one", () => {
    expect(
      parseJiraIssue({ fields: { description: "plain" } }).description,
    ).toBe("plain");
    expect(parseJiraIssue({ fields: {} }).description).toBe("");
    expect(parseJiraIssue(null)).toEqual({
      key: "",
      summary: "",
      description: "",
      status: "",
      type: "",
      priority: "",
    });
  });

  it("loads a saved issue JSON from disk", () => {
    const file = fixture("issue.json", { key: "QUA-2", fields: {} });
    expect(loadJiraFixture(file).key).toBe("QUA-2");
  });
});

describe("JiraClient", () => {
  it("builds a Basic-auth request against the v3 issue endpoint", async () => {
    let url = "";
    let init: RequestInit = {};
    vi.stubGlobal("fetch", async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return json({ key: "QUA-3", fields: { summary: "s" } });
    });

    const ticket = await new JiraClient(
      "https://example.atlassian.net/",
      "me@example.test",
      "token",
    ).getIssue("QUA-3");

    expect(url).toBe("https://example.atlassian.net/rest/api/3/issue/QUA-3");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("me@example.test:token").toString("base64")}`,
    );
    expect(ticket.summary).toBe("s");
  });
});

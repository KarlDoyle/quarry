#!/usr/bin/env -S node --experimental-sqlite
import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { simpleGit } from "simple-git";
import { AnalysisAgent } from "./agent/index.js";
import {
  AnthropicProvider,
  FallbackProvider,
  type LLMProvider,
  MossProvider,
  OllamaProvider,
} from "./agent/providers.js";
import { type Config, dbPath, loadConfig } from "./config.js";
import { EmbeddingGenerator } from "./indexer/embedding-generator.js";
import { RepositoryIndexer } from "./indexer/index.js";
import { loadRepoFixture } from "./ingest/github.js";
import { JiraClient, loadJiraFixture, type Ticket } from "./ingest/jira.js";
import { VectorStore } from "./vector-store/index.js";

const program = new Command();
program
  .name("quarry")
  .description(
    "Local-first hybrid code search + grounded LLM analysis + ticket triage. No SaaS, no DB server, no key.",
  )
  .version("0.2.2");

function openStore(): VectorStore {
  const config = loadConfig();
  fs.mkdirSync(config.dataDir, { recursive: true });
  return new VectorStore(dbPath(config));
}

const isUrl = (s: string): boolean => /^(https?:\/\/|git@)/.test(s);

program
  .command("index")
  .description(
    "Index a local repo path or a git URL into the local vector store",
  )
  .argument("<target>", "path to a local repo, or a git clone URL")
  .action(async (target: string) => {
    const config = loadConfig();
    fs.mkdirSync(config.dataDir, { recursive: true });

    let repoPath = target;
    if (isUrl(target)) {
      const name =
        target
          .replace(/\.git$/, "")
          .split("/")
          .pop() || "repo";
      repoPath = path.join(config.dataDir, "repos", name);
      if (!fs.existsSync(repoPath)) {
        console.log(`Cloning ${target} → ${repoPath} ...`);
        await simpleGit().clone(target, repoPath, ["--depth", "1"]);
      } else {
        console.log(`Using existing clone at ${repoPath}`);
      }
    } else if (!fs.existsSync(repoPath)) {
      console.error(`Path not found: ${repoPath}`);
      process.exit(1);
    }

    const store = new VectorStore(dbPath(config));
    const indexer = new RepositoryIndexer(store);
    console.log("Loading embedding model (first run downloads it once)...");
    await indexer.initialize();
    const result = await indexer.indexRepository(repoPath);
    store.close();
    console.log(
      `\n✓ Indexed ${result.files} files into ${result.chunks} chunks.`,
    );
  });

program
  .command("search")
  .description("Semantic search over the index (no LLM, no API key needed)")
  .argument("<query>", "natural-language query")
  .option("-k, --top <n>", "number of results", "8")
  .action(async (query: string, opts: { top: string }) => {
    const store = openStore();
    const embedder = new EmbeddingGenerator();
    await embedder.initialize();
    const results = store.search(
      await embedder.generateEmbedding(query),
      query,
      Number(opts.top),
    );
    store.close();
    if (results.length === 0) {
      console.log("No matches. Run `index` first.");
      return;
    }
    for (const r of results) {
      const snippet = r.content.replace(/\s+/g, " ").slice(0, 100);
      console.log(
        `\n[${(r.similarity ?? 0).toFixed(3)}] ${r.filePath}${r.metadata.entityName ? ` · ${r.metadata.entityName}` : ""}`,
      );
      console.log(`  ${snippet}…`);
    }
  });

function buildProvider(config: Config): LLMProvider {
  if (config.provider === "anthropic") {
    if (!config.anthropicApiKey) {
      console.error(
        "QUARRY_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.",
      );
      process.exit(1);
    }
    return new AnthropicProvider(config.model, config.anthropicApiKey);
  }
  const ollama = new OllamaProvider(config.model, config.ollamaHost);
  // If an Anthropic key is configured, use it as an automatic fallback for when
  // Ollama isn't running. Local stays primary (free); the key is opt-in safety.
  const localPath: LLMProvider = config.anthropicApiKey
    ? new FallbackProvider(
        ollama,
        new AnthropicProvider(
          "claude-haiku-4-5-20251001",
          config.anthropicApiKey,
        ),
      )
    : ollama;
  // QUARRY_LLM=moss: route generation through moss's local-first router. If moss
  // is unavailable (not linked) or has no available local lane, FallbackProvider
  // transparently drops back to the direct Ollama path so Quarry still works.
  if (config.llmRouter === "moss") {
    return new FallbackProvider(new MossProvider(config.model), localPath);
  }
  return localPath;
}

program
  .command("analyze")
  .description(
    "Ask a question; answered by a local LLM grounded in retrieved code",
  )
  .argument("<query>", "natural-language question about the codebase")
  .option("-k, --top <n>", "number of sources to retrieve", "8")
  .action(async (query: string, opts: { top: string }) => {
    const config = loadConfig();
    const provider = buildProvider(config);
    const store = openStore();
    const embedder = new EmbeddingGenerator();
    await embedder.initialize();
    const agent = new AnalysisAgent(store, embedder, provider);
    const result = await agent.analyze(query, Number(opts.top));
    store.close();
    console.log(`\n${result.answer}\n`);
    console.log("Sources:");
    for (const s of result.sources) {
      console.log(
        `  [${s.similarity}] ${s.filePath}${s.entityName ? ` · ${s.entityName}` : ""}`,
      );
    }
    console.log(`\n(via ${provider.name}: ${result.model})`);
  });

program
  .command("stats")
  .description("Show index statistics")
  .action(() => {
    const store = openStore();
    const s = store.stats();
    store.close();
    console.log(
      `Indexed: ${s.totalChunks} chunks across ${s.totalFiles} files.`,
    );
  });

program
  .command("analyze-ticket")
  .description("Triage a Jira ticket against the indexed codebase")
  .argument(
    "[key]",
    "Jira issue key (live; needs JIRA_BASE_URL/JIRA_EMAIL/JIRA_TOKEN)",
  )
  .option(
    "-f, --fixture <path>",
    "analyse a saved Jira issue JSON instead of fetching live",
  )
  .option(
    "--repo-fixture <path>",
    "optional saved GitHub repo JSON for extra context",
  )
  .option("-k, --top <n>", "number of sources to retrieve", "8")
  .action(
    async (
      key: string | undefined,
      opts: { fixture?: string; repoFixture?: string; top: string },
    ) => {
      let ticket: Ticket;
      if (opts.fixture) {
        ticket = loadJiraFixture(opts.fixture);
      } else if (key) {
        const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_TOKEN } = process.env;
        if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_TOKEN) {
          console.error(
            "Live mode needs JIRA_BASE_URL, JIRA_EMAIL, JIRA_TOKEN — or pass --fixture <path>.",
          );
          process.exit(1);
        }
        ticket = await new JiraClient(
          JIRA_BASE_URL,
          JIRA_EMAIL,
          JIRA_TOKEN,
        ).getIssue(key);
      } else {
        console.error("Provide a Jira key (live) or --fixture <path>.");
        process.exit(1);
      }

      const repo = opts.repoFixture
        ? loadRepoFixture(opts.repoFixture)
        : undefined;
      const config = loadConfig();
      const provider = buildProvider(config);
      const store = openStore();
      const embedder = new EmbeddingGenerator();
      await embedder.initialize();
      const agent = new AnalysisAgent(store, embedder, provider);
      const result = await agent.analyzeTicket(ticket, repo, Number(opts.top));
      store.close();

      console.log(`\n# Triage: ${ticket.key} — ${ticket.summary}\n`);
      console.log(`${result.answer}\n`);
      console.log("Sources:");
      for (const s of result.sources) {
        console.log(
          `  [${s.similarity}] ${s.filePath}${s.entityName ? ` · ${s.entityName}` : ""}`,
        );
      }
      console.log(`\n(via ${provider.name}: ${result.model})`);
    },
  );

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

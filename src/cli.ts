#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { simpleGit } from "simple-git";
import { AnalysisAgent } from "./agent/index.js";
import {
  AnthropicProvider,
  type LLMProvider,
  OllamaProvider,
} from "./agent/providers.js";
import { type Config, dbPath, loadConfig } from "./config.js";
import { EmbeddingGenerator } from "./indexer/embedding-generator.js";
import { RepositoryIndexer } from "./indexer/index.js";
import { VectorStore } from "./vector-store/index.js";

const program = new Command();
program
  .name("devtool-rag")
  .description(
    "Local-first semantic code search + LLM analysis. No SaaS, no Docker.",
  )
  .version("0.1.0");

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
        "DEVTOOL_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.",
      );
      process.exit(1);
    }
    return new AnthropicProvider(config.model, config.anthropicApiKey);
  }
  return new OllamaProvider(config.model, config.ollamaHost);
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

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

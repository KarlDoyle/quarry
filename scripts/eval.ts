/**
 * Retrieval-quality eval harness for devtool-rag.
 *
 * Indexes a real repo once into a temp VectorStore, then runs every gold-set
 * query through retrieval and reports recall@1/3/5, MRR, and per-query
 * retrieval latency (p50/p95). It can A/B hybrid (dense + BM25 + RRF) against
 * dense-only retrieval via the `VectorStore.search` `mode` hook.
 *
 * Run (offline, no LLM, no network):
 *   NODE_OPTIONS=--experimental-sqlite tsx scripts/eval.ts [repoPath] [goldsetPath]
 *
 * Env:
 *   EVAL_MODE=hybrid|dense   restrict to a single retrieval mode
 *                            (default: run both and print both tables)
 *
 * This script only MEASURES. It never mutates the target repo and never
 * changes core retrieval behaviour — dense-only is an opt-in search param.
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EmbeddingGenerator } from "../src/indexer/embedding-generator.js";
import { RepositoryIndexer } from "../src/indexer/index.js";
import { VectorStore } from "../src/vector-store/index.js";

type Mode = "hybrid" | "dense";

interface GoldQuery {
  query: string;
  expectedFiles: string[];
}

interface GoldSet {
  corpus?: string;
  queries: GoldQuery[];
}

interface ModeMetrics {
  mode: Mode;
  recall: Record<number, number>;
  mrr: number;
  latencyP50: number;
  latencyP95: number;
}

const RECALL_KS = [1, 3, 5] as const;
const RETRIEVE_K = 10; // deep enough for an honest MRR

const repoPath = process.argv[2] ?? "/Users/kdoyle/Dev/moss";
const goldsetPath =
  process.argv[3] ??
  new URL("../eval/moss-goldset.json", import.meta.url).pathname;

const envMode = process.env.EVAL_MODE as Mode | undefined;
const modes: Mode[] = envMode ? [envMode] : ["hybrid", "dense"];

/** Does any expected-file substring appear in the retrieved file path? */
function isHit(filePath: string, expected: string[]): boolean {
  return expected.some((e) => filePath.includes(e));
}

/** Nearest-rank percentile over a sample of latencies (ms). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

function dirSizeBytes(dbPath: string): number {
  let total = 0;
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      total += statSync(`${dbPath}${suffix}`).size;
    } catch {
      // sidecar files may not exist
    }
  }
  return total;
}

async function main(): Promise<void> {
  const goldset = JSON.parse(readFileSync(goldsetPath, "utf-8")) as GoldSet;
  const queries = goldset.queries;
  console.log(`devtool-rag eval — corpus=${goldset.corpus ?? repoPath}`);
  console.log(`gold-set: ${queries.length} queries (${goldsetPath})`);
  console.log(`repo: ${repoPath}\n`);

  const tmp = mkdtempSync(join(tmpdir(), "devtool-rag-eval-"));
  const dbPath = join(tmp, "index.db");
  const store = new VectorStore(dbPath);

  try {
    // One-time index + model load (excluded from retrieval latency).
    const indexer = new RepositoryIndexer(store);
    const indexStart = performance.now();
    await indexer.initialize();
    const indexResult = await indexer.indexRepository(repoPath);
    const indexMs = performance.now() - indexStart;

    // Embed every query once; embeddings are identical across modes.
    const embedder = new EmbeddingGenerator();
    await embedder.initialize();
    const queryEmbeddings: number[][] = [];
    for (const q of queries) {
      queryEmbeddings.push(await embedder.generateEmbedding(q.query));
    }

    const results: ModeMetrics[] = [];
    for (const mode of modes) {
      // Warmup (prepare statements, page cache) — not timed.
      store.search(queryEmbeddings[0], queries[0].query, RETRIEVE_K, { mode });

      const latencies: number[] = [];
      const hitsAtK: Record<number, number> = { 1: 0, 3: 0, 5: 0 };
      let mrrSum = 0;

      for (let i = 0; i < queries.length; i++) {
        const q = queries[i];
        const emb = queryEmbeddings[i];
        const t0 = performance.now();
        const chunks = store.search(emb, q.query, RETRIEVE_K, { mode });
        latencies.push(performance.now() - t0);

        const ranked = chunks.map((c) => c.filePath);
        for (const k of RECALL_KS) {
          if (ranked.slice(0, k).some((fp) => isHit(fp, q.expectedFiles))) {
            hitsAtK[k] += 1;
          }
        }
        const firstHit = ranked.findIndex((fp) => isHit(fp, q.expectedFiles));
        if (firstHit >= 0) mrrSum += 1 / (firstHit + 1);
      }

      latencies.sort((a, b) => a - b);
      results.push({
        mode,
        recall: {
          1: hitsAtK[1] / queries.length,
          3: hitsAtK[3] / queries.length,
          5: hitsAtK[5] / queries.length,
        },
        mrr: mrrSum / queries.length,
        latencyP50: percentile(latencies, 50),
        latencyP95: percentile(latencies, 95),
      });
    }

    // ---- Report ----
    const sizeMb = (dirSizeBytes(dbPath) / (1024 * 1024)).toFixed(2);
    console.log("Corpus indexed:");
    console.log(`  files:        ${indexResult.files}`);
    console.log(`  chunks:       ${indexResult.chunks}`);
    console.log(`  index size:   ${sizeMb} MB (on disk)`);
    console.log(`  index time:   ${(indexMs / 1000).toFixed(1)} s (one-time)`);
    console.log(`  embed model:  ${embedder.modelName}`);
    console.log(`  date:         ${new Date().toISOString().slice(0, 10)}\n`);

    const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
    const ms = (n: number): string => `${n.toFixed(2)}ms`;
    console.log(
      "mode    | recall@1 | recall@3 | recall@5 |  MRR  | lat p50 | lat p95",
    );
    console.log(
      "--------|----------|----------|----------|-------|---------|--------",
    );
    for (const r of results) {
      console.log(
        `${r.mode.padEnd(7)} | ${pct(r.recall[1]).padStart(8)} | ${pct(r.recall[3]).padStart(8)} | ${pct(r.recall[5]).padStart(8)} | ${r.mrr.toFixed(3)} | ${ms(r.latencyP50).padStart(7)} | ${ms(r.latencyP95).padStart(7)}`,
      );
    }
    console.log(
      "\n(recall@k = fraction of queries with a relevant file in the top k;",
    );
    console.log(
      " MRR over top-10; latency = VectorStore.search() only, excludes query embedding.)",
    );
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

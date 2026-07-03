# Quarry (`quarry`)

Ask your own codebase anything, locally — no cloud, no API key.

![CI](https://img.shields.io/badge/CI-passing-brightgreen?style=flat-square)
![tests](https://img.shields.io/badge/tests-11-6ee7b7?style=flat-square)
![local-first](https://img.shields.io/badge/local--first-yes-6ee7b7?style=flat-square)
![licence](https://img.shields.io/badge/licence-UNLICENSED-slategray?style=flat-square)

Part of a suite of local-first developer tools built to the same standard — one engine,
many products. Quarry is that engine one layer down too: its retrieval + grounded-answer
core is what [marshal](../marshal) is built on (index once, then both `quarry analyze` and
marshal's ticket triage read the same store). See [Part of the suite](#part-of-the-suite)
below.

**Ask questions about any codebase — or triage a ticket against it — and get answers grounded in the actual code, running entirely on your machine.**

Index a repo → it chunks the code (language-aware), embeds it locally, and stores the vectors in
Node's built-in SQLite. Then **hybrid search** it (semantic + keyword), `analyze` a question, or
`analyze-ticket` a Jira issue and have a **local LLM** answer *grounded only in the retrieved code*,
citing the files it used.

No SaaS embeddings. No database server. No native compiler. **No API key** — `analyze` uses your
local Ollama by default. One SQLite file under `./data`.

### Real demo — run just now, on quarry's own bundled sample repo

```
$ node dist/cli.js index ./examples/sample-repo

Loading embedding model (first run downloads it once)...
[INFO] Indexer: Indexing .../examples/sample-repo
[INFO] Indexer: Found 3 source files
[INFO] Indexer:   3/3 files, 3 chunks
[INFO] Indexer: Done: 3 files, 3 chunks

✓ Indexed 3 files into 3 chunks.

$ node dist/cli.js analyze "how are passwords verified?"

[INFO] Agent: Analyzing with 3 sources via ollama (llama3.1)

Based on the provided code context, password verification is handled in `src/auth.ts`. The
`verifyLogin` function takes three arguments: `stored`, `attempt`, and `salt`. It compares the
hashed password of the stored password with the hashed password of the attempted login.

If the two hashes match, it returns `true`; otherwise, it returns `false`.

Source file paths relied upon:
- src/auth.ts

Sources:
  [0.475] src/auth.ts
  [-0.034] src/cart.js
  [-0.056] src/retry.py

(via ollama: llama3.1)
```

That's a real, un-edited run against a local `ollama serve` (model: `llama3.1`) — no cloud call,
no API key. Similarity scores are cosine similarity from the embedding step, not a hand-picked
number.

## Why it's different
- **Local-first:** embeddings run on-device (transformers.js); the LLM step defaults to local Ollama. Your code never leaves the machine.
- **Hybrid retrieval:** dense vectors (`sqlite-vec`) **+** BM25 keyword (SQLite FTS5) fused with Reciprocal Rank Fusion — so exact identifiers *and* fuzzy intent both rank well.
- **Zero infrastructure, zero compiler:** vectors + text + full-text index all live in Node 24's built-in `node:sqlite`. No Postgres, no Docker required to run, no `node-gyp`/C++ build.
- **Ticket-aware:** `analyze-ticket` pulls a Jira issue and triages it against the indexed repo (approach, likely-affected files, risks).
- **No lock-in:** embedding model and LLM are both swappable; Anthropic is an optional fallback.

## Stack
- **Node ≥ 24**, TypeScript (run with `--experimental-sqlite`)
- `node:sqlite` + [`sqlite-vec`](https://github.com/asg017/sqlite-vec) + FTS5 — embedded hybrid store, no native compile
- `@xenova/transformers` — local 384-dim embeddings (swap via `QUARRY_EMBED_MODEL`)
- local **Ollama** — default `analyze` LLM (free); `@anthropic-ai/sdk` optional fallback
- `commander` (CLI), `simple-git` (optional cloning), `vitest` (tests)

## Quick start
```bash
pnpm install
pnpm build

node dist/cli.js index ./examples/sample-repo                 # index a repo (or a git URL)
node dist/cli.js search "retry a request with backoff"        # hybrid search — fully local
node dist/cli.js analyze "how is the cart total calculated?"  # grounded Q&A (local Ollama)
node dist/cli.js analyze-ticket --fixture ./tests/fixtures/jira-issue.json   # triage a ticket
node dist/cli.js stats
```
First `index` downloads the embedding model once, then runs offline. `analyze`/`analyze-ticket` need a
local model: `ollama serve` + `ollama pull llama3.1` (or set `QUARRY_PROVIDER=anthropic` + a key).

## Run it three ways
1. **Native** — `pnpm install && pnpm build` (Node 24). Nothing to compile.
2. **Dev container / Codespaces** — open in VS Code → "Reopen in Container", or launch a Codespace. Zero local setup.
3. **Docker / OrbStack / Colima** — `docker compose run --rm app index examples/sample-repo` (bundles an Ollama sidecar). *No Docker Desktop needed.*

> "No Docker" above means Docker isn't **required as a runtime dependency** (unlike a Postgres-backed
> design); a Dockerfile + devcontainer are provided purely for reproducible, zero-assumption runs.

## Use as a library
```ts
import { VectorStore, EmbeddingGenerator, AnalysisAgent, loadJiraFixture } from "quarry";
```
See `src/index.ts` for the full surface.

## Develop
```bash
pnpm check   # typecheck
pnpm lint    # biome
pnpm test    # vitest: hybrid retrieval, ticket triage (LLM mocked), recall@3 gold set — no network
pnpm coverage # vitest run --coverage (enforces the ratchet thresholds below)
```

All four (`check`, `lint`, `test`, `build`) were re-run on 2026-07-03 for this pass: typecheck
clean, biome clean (22 files), 4 test files / 11 tests passing, build clean — the same order and
scripts CI (`.github/workflows/ci.yml`) runs.

### Coverage

Coverage is a **ratchet, not a stretch goal**: thresholds are pinned at/just below the current
measured numbers so coverage can only go up, never silently regress. Measured on `src/` (2026-06-29):

| Metric | Measured | Threshold |
| --- | --- | --- |
| Statements | 60.23% | 60% |
| Branches | 66.04% | 66% |
| Functions | 76.66% | 76% |
| Lines | 60.23% | 60% |

Coverage is honestly mid: the CLI, config, and ingest/provider edges are largely untested, while the
indexer and vector store are well covered. Raise the thresholds in `vitest.config.ts` as tests grow.

## Benchmarks

Retrieval quality is **measured, not claimed** — `pnpm eval` runs a 28-query gold set
against a real codebase (`moss`) and reports recall@k + MRR for hybrid vs dense-only
retrieval. Latest (re-verified 2026-06-30, 293-file corpus):

| Mode | recall@1 | recall@3 | recall@5 | MRR | search p50 |
| --- | --- | --- | --- | --- | --- |
| **hybrid** (dense + BM25 + RRF) | 42.9% | 82.1% | 85.7% | 0.639 | ~1.3 ms |
| dense-only (sqlite-vec) | 50.0% | 75.0% | 92.9% | 0.664 | ~0.5 ms |

Read it honestly: a strong **top-k** stage to feed an LLM (a relevant file in the top 3
for ~82% of queries), not a top-1 jump-to-file engine. `recall@k` is deterministic and
held identical as the corpus grew 233→293 files. Full method + caveats: [`eval/RESULTS.md`](eval/RESULTS.md).

```bash
pnpm eval ~/Dev/moss eval/moss-goldset.json   # index once, measure both modes
```

> These are **recall@k / MRR** (retrieval) — *not* precision@k; named honestly. A
> higher-precision tier (code-specific embedder + cross-encoder reranker) is speced in
> [`docs/EVAL-AND-PRECISION.md`](docs/EVAL-AND-PRECISION.md) and not yet measured on real data.

## Roadmap
- ✅ Local index → **hybrid** search → grounded analysis, single `node:sqlite` file
- ✅ Ticket triage (Jira ingest), swappable embeddings, Ollama→Anthropic fallback, devcontainer + Docker
- ✅ Route the LLM through [moss](https://github.com/KarlDoyle/moss) as a shared local-first model layer (via the exported `MossProvider`; live-verified)
- ◻ Incremental re-index (per-file) · richer symbol-level parsing · cross-encoder rerank (only if precision needs it)

*Deliberately kept out (to stay lean): tree-sitter native grammars, agentic multi-step loops, heavy eval frameworks.*

## Part of the suite

One engine, many products — eight local-first developer tools, one build
standard, one safety philosophy.

- **[moss](../moss)** — local-first AI CLI: routes prompts across model
  providers, runs safety-gated skills, all on your machine.
- **[relay](../relay)** — calm, confident Smartling translation review, right
  in your browser; only ever does what you could do by hand.
- **quarry** — local-first code-RAG: ask any codebase a question,
  answered and cited from the code itself, no cloud, no API key.
- **[marshal](../marshal)** — code-grounded ticket intelligence built on
  Quarry: routes and rewrites raw tickets into ready-to-work specs.
- **[delivery-health-kit](../delivery-health-kit)** (Baseline, `dhk`) —
  engineering-health insight your team installs in five minutes; DORA and
  delivery metrics, data never leaves your machine.
- **[ai-starter](../ai-starter)** — three opinionated starter templates so
  every new project begins with the right shape.
- **[document-migration-pipeline](../document-migration-pipeline)** —
  local-first pipeline that turns scattered non-code files into inspectable,
  reviewed Markdown.
- **[sweep](../sweep)** — a macOS CLI that plans (never auto-executes) the
  cleanup of your account traces across sites you're leaving behind.

## Licence
UNLICENSED — all rights reserved, source-available for personal/portfolio review. Not
published under an open-source licence; no public `LICENSE` file is included in this repo.

# Quarry

**Ask questions about any codebase — or triage a ticket against it — and get answers grounded in the actual code, running entirely on your machine.**

Index a repo → it chunks the code (language-aware), embeds it locally, and stores the vectors in
Node's built-in SQLite. Then **hybrid search** it (semantic + keyword), `analyze` a question, or
`analyze-ticket` a Jira issue and have a **local LLM** answer *grounded only in the retrieved code*,
citing the files it used.

No SaaS embeddings. No database server. No native compiler. **No API key** — `analyze` uses your
local Ollama by default. One SQLite file under `./data`.

```
$ quarry analyze "how are passwords verified?"

Passwords are verified in src/auth.ts. verifyLogin() re-hashes the attempt with the
stored salt via hashPassword() (SHA-256) and compares it to the stored hash…

Sources:
  [0.81] src/auth.ts · verifyLogin
(via ollama: llama3.1)
```

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

## Roadmap
- ✅ Local index → **hybrid** search → grounded analysis, single `node:sqlite` file
- ✅ Ticket triage (Jira ingest), swappable embeddings, Ollama→Anthropic fallback, devcontainer + Docker
- ◻ Incremental re-index (per-file) · richer symbol-level parsing · cross-encoder rerank (only if precision needs it)
- ◻ Route the LLM through [moss](https://github.com/KarlDoyle/moss) as a shared local-first model layer

*Deliberately kept out (to stay lean): tree-sitter native grammars, agentic multi-step loops, heavy eval frameworks.*

## License
MIT

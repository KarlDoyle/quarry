# devtool-rag

**Ask questions about any codebase and get answers grounded in the actual code — running entirely on your machine.**

Index a repo → it parses and chunks the code, embeds it locally, and stores the vectors in an
embedded database. Then `search` it semantically, or `analyze` a question and have a **local LLM**
answer *grounded only in the retrieved code*, citing the files it used.

No SaaS embeddings. No Postgres. No Docker. **No API key** — `analyze` uses your local Ollama by
default. One SQLite file under `./data`.

```
$ devtool-rag analyze "how are passwords verified?"

Passwords are verified in src/auth.ts. verifyLogin() re-hashes the attempt with the
stored salt via hashPassword() (SHA-256) and compares it to the stored hash…

Sources:
  [0.81] src/auth.ts · verifyLogin
  [0.52] src/auth.ts · hashPassword
```

## Why it's different
- **Local-first:** embeddings run on-device (`all-MiniLM-L6-v2` via transformers.js). Your code never leaves the machine for indexing.
- **Zero infrastructure:** vectors live in SQLite + [`sqlite-vec`](https://github.com/asg017/sqlite-vec). No database server, no containers.
- **Multi-language:** indexes JS/TS, Python, Go, Java, Rust, and more.
- **Portable:** `clone → install → run`. The only network call is the optional `analyze` step (Claude).

## Stack
- Node ≥ 20, TypeScript
- `better-sqlite3` + `sqlite-vec` — embedded vector store
- `@xenova/transformers` — local 384-dim embeddings
- local **Ollama** — the default `analyze` LLM (free, on-device); `@anthropic-ai/sdk` optional
- `commander` (CLI), `simple-git` (optional repo cloning), `vitest` (tests)

## Quick start
```bash
pnpm install                      # builds the native sqlite bits
pnpm build

# index a local repo (or a git URL)
node dist/cli.js index ./examples/sample-repo

# semantic search — fully local
node dist/cli.js search "retry a network request with backoff"

# grounded Q&A — local by default (needs Ollama: `ollama serve` + `ollama pull llama3.1`)
node dist/cli.js analyze "how is the shopping cart total calculated?"

node dist/cli.js stats
```

First `index` downloads the embedding model once (~a few seconds), then runs offline. `analyze` uses
your local Ollama by default — no API key. To use Anthropic instead, see `.env.example`.

## Use as a library
```ts
import { VectorStore, EmbeddingGenerator, AnalysisAgent } from "devtool-rag";
```
See `src/index.ts` for the full surface.

## Develop
```bash
pnpm check   # typecheck
pnpm lint    # biome
pnpm test    # vitest (real embeddings + sqlite-vec, no network)
```

## Roadmap
- ✅ Local index → semantic search → grounded analysis, single SQLite file
- ✅ Multi-language indexing, library API, integration tests
- ◻ Incremental re-index (per-file update instead of full rebuild)
- ◻ Pluggable LLM provider (via [moss](https://github.com/KarlDoyle/moss) router)
- ◻ Optional richer parsing for symbol-level retrieval

## License
MIT

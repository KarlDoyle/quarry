# AGENTS.md — Quarry agent contract

## Project

Quarry is a local-first, codebase-grounded retrieval engine: it indexes a repo
(language-aware chunking, on-device embeddings, hybrid dense+keyword store in
`node:sqlite`), then answers questions or triages Jira tickets **grounded only
in the retrieved code**, citing the files it used — no cloud call, no API key
required by default. It can be embedded by other applications.

## Build / test / lint

All commands are `package.json` scripts — run exactly as written, no substitutes:

```bash
pnpm install            # dependencies (pnpm, frozen-lockfile in CI)
pnpm build               # tsc -p tsconfig.json -> dist/
pnpm check               # tsc --noEmit -p tsconfig.json (typecheck)
pnpm lint                # biome check .
pnpm test                # NODE_OPTIONS=--experimental-sqlite vitest run
pnpm coverage            # vitest run --coverage (enforces ratchet thresholds in vitest.config.ts)
pnpm eval                # run the harness against the bundled sample fixture
pnpm eval <repo> <goldset.json>   # evaluate a corpus with a matching gold set
```

`dev` runs the CLI directly from source: `pnpm dev -- <command>` (equivalent
to `NODE_OPTIONS=--experimental-sqlite tsx src/cli.ts`). Node ≥ 24 is required
because Quarry uses the built-in `node:sqlite` module with
`--experimental-sqlite`; both `check` and `test` scripts carry that flag
internally, so CI and the pre-push hook just invoke the named script and the
flag rides along.

## Architecture

- **`src/indexer/`** — walks a repo (`file-patterns.ts` decides what's
  indexable), parses source into entities (`ast-parser.ts`), and splits them
  into smart chunks (`chunking-strategies.ts`); `embedding-generator.ts` embeds
  each chunk locally via `@huggingface/transformers` (384-dim,
  `all-MiniLM-L6-v2` by default, swappable via `QUARRY_EMBED_MODEL`).
- **`src/vector-store/`** — stores chunks + embeddings in `node:sqlite`, using
  `sqlite-vec` for dense KNN and FTS5 for BM25 keyword search, fused with
  Reciprocal Rank Fusion (RRF, k=60) for hybrid retrieval (`VectorStore.search()`
  also exposes a `{ mode: "dense" }` hook for dense-only comparison).
  Retrieval flow: **index → embed → hybrid search (dense + BM25 + RRF) → rank**.
- **`src/agent/`** — `AnalysisAgent` takes retrieved chunks and an `LLMProvider`
  (`providers.ts`: Ollama default, Anthropic fallback, or `MossProvider` routing
  through moss) and produces an answer grounded only in that context, citing
  source files; retrieved code is treated as untrusted data, never instructions.
- **`src/ingest/`** — `jira.ts` and `github.ts` pull tickets/repos in for
  `analyze-ticket` and remote indexing.
- **Quality bar:** retrieval quality is measured, not claimed. The bundled
  three-query sample only verifies that the harness runs; it is not a product
  benchmark. Use a representative corpus and matching gold set before making
  performance claims. See `docs/EVAL-AND-PRECISION.md` for methodology and
  possible precision improvements. Re-measure retrieval changes on the same
  representative corpus before claiming an improvement.

## Conventions

- **Runtime:** Node ≥ 24 (`engines.node` in `package.json`), TypeScript, ESM
  (`"type": "module"`), `NodeNext` module resolution, `strict` mode.
- **Package manager:** pnpm (lockfile `pnpm-lock.yaml`; CI installs with
  `--frozen-lockfile`). This repo is also a pnpm workspace member
  (`pnpm-workspace.yaml`).
- **Formatting/linting:** biome (`biome.json`) — 2-space indent, organised
  imports, recommended rules (with `noExplicitAny` off). Run `pnpm lint`
  before committing; it's the same check CI runs.
- **Secret-scan test:** `tests/secret-scan.test.ts` is a generic, deterministic
  pattern scan run as part of `pnpm test` —
  it fails the build on anything credential-shaped in `src`, `tests`, `scripts`,
  `eval`, `docs`, `.github`. `.env.example` must only ever hold empty or
  obvious-placeholder values.
- **Pre-push hook:** `.githooks/pre-push` (the "ai-starter standard", wired via
  `git config core.hooksPath .githooks`, set automatically by the `prepare`
  script on install) runs `check` then `test` locally before a push leaves the
  machine.

## Gates

CI (`.github/workflows/ci.yml`) runs four sequential jobs, cheapest/fastest
first, each gating the next — **the same order the pre-push hook runs, so
green here means green there**:

1. `pnpm check` (typecheck)
2. `pnpm lint` (biome)
3. `pnpm test` (unit tests, including the secret-scan boundary test)
4. `pnpm build`

Merges are governed by `.github/workflows/automerge.yml` and
`.github/automerge-policy.yml` (tiered policy, evaluated fresh from the
GitHub API every run — a PR can never alter the rules that judge it): Tier 0
is bot/allow-listed-path PRs with green checks, Tier 1 is Dependabot
minor/patch bumps after a delay, Tier 2 (everything else, including any change
under `.github/**`) never auto-merges and is merged by hand. No AI review has
merge authority.

## Rules

- Never commit a real `.env` or any credential-shaped value — only
  `.env.example` with placeholders; the secret-scan test is the backstop, not
  the first line of defence.
- Keep `pnpm test` green. Treat the bundled evaluation fixture as a harness
  smoke test, not as a retrieval-quality benchmark.
- **Measure before claiming** — Quarry's own ethos (`docs/EVAL-AND-PRECISION.md`):
  any retrieval-quality change is re-run against a representative corpus and
  matching gold set before quoting a measured result.
- Keep the local-first, zero-infrastructure design intact: no new mandatory
  network calls, database server, or native compiler step in the default path.

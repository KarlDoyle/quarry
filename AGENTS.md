# AGENTS.md — Quarry agent contract

## Project

Quarry is a local-first, codebase-grounded retrieval engine: it indexes a repo
(language-aware chunking, on-device embeddings, hybrid dense+keyword store in
`node:sqlite`), then answers questions or triages Jira tickets **grounded only
in the retrieved code**, citing the files it used — no cloud call, no API key
required. It is the retrieval core one layer down from [moss](../moss) and
[marshal](../marshal), which build on it.

## Build / test / lint

All commands are `package.json` scripts — run exactly as written, no substitutes:

```bash
pnpm install            # dependencies (pnpm, frozen-lockfile in CI)
pnpm build               # tsc -p tsconfig.json -> dist/
pnpm check               # tsc --noEmit -p tsconfig.json (typecheck)
pnpm lint                # biome check src tests scripts
pnpm test                # NODE_OPTIONS=--experimental-sqlite vitest run
pnpm coverage            # vitest run --coverage (enforces ratchet thresholds in vitest.config.ts)
pnpm eval                # NODE_OPTIONS=--experimental-sqlite tsx scripts/eval.ts — retrieval quality harness
pnpm eval ~/Dev/moss eval/moss-goldset.json   # eval against any repo + gold set
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
  each chunk locally via `@xenova/transformers` (384-dim, `all-MiniLM-L6-v2` by
  default, swappable via `QUARRY_EMBED_MODEL`).
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
- **Quality bar:** retrieval quality is measured, not claimed. `pnpm eval` runs
  a 28-query gold set (`eval/moss-goldset.json`) against a real corpus (`moss`)
  and reports recall@k / MRR for hybrid vs dense-only — see
  `eval/RESULTS.md` for the current numbers (hybrid: recall@3 82.1%, recall@5
  85.7%, MRR 0.639) and `docs/EVAL-AND-PRECISION.md` for the ranked levers
  (code-specific embeddings, cross-encoder rerank) not yet adopted. Any change
  to indexing/retrieval that could move these numbers should be re-measured
  with `pnpm eval` before being claimed as an improvement.

## Conventions

- **Runtime:** Node ≥ 24 (`engines.node` in `package.json`), TypeScript, ESM
  (`"type": "module"`), `NodeNext` module resolution, `strict` mode.
- **Package manager:** pnpm (lockfile `pnpm-lock.yaml`; CI installs with
  `--frozen-lockfile`). This repo is also a pnpm workspace member
  (`pnpm-workspace.yaml`) alongside sibling tools such as `moss`.
- **Formatting/linting:** biome (`biome.json`) — 2-space indent, organised
  imports, recommended rules (with `noExplicitAny` off). Run `pnpm lint`
  before committing; it's the same check CI runs.
- **Secret-scan test:** `tests/secret-scan.test.ts` is a generic, deterministic
  pattern scan (lifted from moss's boundary test) run as part of `pnpm test` —
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
- Keep `pnpm test` (including the gold-set-backed retrieval tests) and
  `pnpm eval`'s gold set green; don't weaken or delete a test/gold-set entry
  to make a change look clean.
- **Measure before claiming** — Quarry's own ethos (`docs/EVAL-AND-PRECISION.md`):
  any retrieval-quality change is re-run through `pnpm eval` and the real
  number quoted, never an assumed or hoped-for improvement.
- Keep the local-first, zero-infrastructure design intact: no new mandatory
  network calls, database server, or native compiler step in the default path.

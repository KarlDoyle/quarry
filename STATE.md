# STATE.md — quarry

_Honest, evidence-based snapshot. Authored 2026-08-28. Based on reading source and read-only git plumbing, not running the app._

## 1. What it is
A local-first code-RAG CLI: indexes a repo (language-aware chunking, on-device embeddings via `@xenova/transformers`), stores vectors + BM25 text in Node's built-in `node:sqlite` (`sqlite-vec` + FTS5), and answers natural-language questions grounded in the retrieved code via a local Ollama model (Anthropic SDK as an optional paid fallback) — citing the files it used. Also supports `analyze-ticket` (pull a Jira issue, triage it against the indexed repo). Entry point `src/cli.ts` → `dist/cli.js`, exported library surface in `src/index.ts` (`VectorStore`, `EmbeddingGenerator`, `AnalysisAgent`, `loadJiraFixture`). It is the retrieval engine one layer down from `marshal` (`Dev/marshal`, `README.md:9-14`), which imports it as a `file:../quarry` dependency and consumes its compiled `dist/index.js` (`Dev/marshal/README.md:78-81`). ~2,340 lines of TypeScript in `src/`.

## 2. Status (honest) — **real engine, unmerged branch, small unstaged drift**
The core retrieval path is genuinely built and self-tested, not decorative:
- 11 tests across 4 files (`tests/citation.test.ts`, `integration.test.ts`, `ticket-analysis.test.ts`, `secret-scan.test.ts`) — confirmed by direct count, matching the README's `tests-11` badge.
- A real, dated benchmark exists: `eval/RESULTS.md` reports recall@1/3/5 and MRR for hybrid vs dense-only retrieval against a 293-file real corpus (`moss`), re-verified 2026-06-30 — not a hand-picked number. README explicitly flags this as recall/MRR, not precision, and points to `docs/EVAL-AND-PRECISION.md` for the not-yet-measured precision tier.
- Coverage is a stated ratchet (60.23%/66.04%/76.66%/60.23% stmts/branch/fn/lines, pinned as thresholds in `vitest.config.ts`), and the README itself calls it "honestly mid" — CLI/config/ingest under-tested, indexer/vector-store well covered.
- README asserts all four gates (check/lint/test/build) were re-run clean on 2026-07-03, in CI's exact order — plausible given the CI/pre-push wiring below, but not independently re-run in this pass (read-only triage).

Working-tree state is not fully clean, but the drift is small and inert:
- Current branch `cortex/cx-m3-2-agent-docs` (git log: `95aed63 docs: add AGENTS.md agent contract (CX-M3-2)`) is 1 commit ahead of `main` and already pushed to `origin/cortex/cx-m3-2-agent-docs` — not yet merged.
- `git status --short` shows two untracked items: `.github/workflows/seed-tier0-test.yml` (a real file on disk, not yet committed — the Tier-0 automerge proof-workflow) and `.cx-m1-5/` (not stray content — it's a linked git worktree, `.cx-m1-5/.git` points to `.git/worktrees/-cx-m1-5`, tied to the local `tune/cx-m1-5` branch; it shows as untracked only because a worktree lives inside this checkout's own directory).
- 5 local branches beyond `main` (`arsenal-l9`, `cortex/cx-m3-2-agent-docs`, `l5c/stamp-merge-policy`, `tune/automerge-cron-6h`, `tune/cx-m1-5`), all mirrored on `origin` — normal feature-branch-per-change pattern, not obviously stale.
- No prior `STATE.md` exists in this repo (confirmed).

## 3. Stack & structure
- **Language:** TypeScript, strict mode, ESM (`"type": "module"`, `NodeNext`), Node ≥ 24 (`package.json:9-11`) — required because it uses `node:sqlite` with `--experimental-sqlite`.
- **Key deps:** `@anthropic-ai/sdk@^0.32.1` (optional fallback provider), `@xenova/transformers@^2.17.2` (local embeddings), `sqlite-vec@^0.1.6`, `commander@^12.1.0` (CLI), `simple-git@^3.27.0`, `moss` as `link:../moss` (sibling workspace package, per `README.md:159` — MossProvider wiring "live-verified"). Dev: `@biomejs/biome`, `vitest@^2.1.8`, `tsx`, `typescript@^5.7.2`.
- **Package manager:** pnpm, workspace member (`pnpm-workspace.yaml`), lockfile present, CI installs `--frozen-lockfile`.
- **Structure:** `src/indexer/` (walk → parse → chunk → embed), `src/vector-store/` (hybrid dense+BM25 store, RRF fusion), `src/agent/` (`AnalysisAgent` + swappable `LLMProvider`), `src/ingest/` (`jira.ts`, `github.ts`), `src/cli.ts`, `src/config.ts`, `src/index.ts` (library surface). `examples/sample-repo` is a bundled 3-file demo corpus used in the README's real, un-edited run.
- **Runtime data:** `data/index.db` (1.6 MB SQLite, gitignored) is present locally — a built artefact, not committed. `dist/` and `coverage/` likewise gitignored and present only as local build output.
- **No LICENSE file** — README states this explicitly ("UNLICENSED — all rights reserved... no public LICENSE file is included"), consistent with `.git ls-files` (none found).

## 4. Issues (ranked)
1. **Latest commit unmerged.** `95aed63` (AGENTS.md contract) sits on `cortex/cx-m3-2-agent-docs`, pushed but not merged to `main` — depending on `automerge-policy.yml`'s tier rules, a root-level `AGENTS.md` change is plausibly Tier 2 (never auto-merges) since it isn't in an explicit `allow_paths` bot list; needs a human merge.
2. **One real file uncommitted.** `.github/workflows/seed-tier0-test.yml` exists on disk but isn't tracked — either an intentional in-progress addition or a leftover that should be committed or removed.
3. **Precision, not just recall, is unmeasured.** README and `AGENTS.md` are both explicit that `docs/EVAL-AND-PRECISION.md`'s higher-precision tier (code-specific embedder, cross-encoder rerank) is speced but "not yet adopted" / "not yet measured on real data" — the benchmark table is recall@k/MRR only.
4. **`README.md`'s "LLM-generation quality not yet measured"** is echoed independently in `Taisce/Library/dev-ecosystem-guide.md:442` (June-2026 build-wave table) — retrieval is measured, the actual grounded-answer quality from the LLM step is not.
5. **Coverage gaps concentrated in CLI/config/ingest** (README's own "honestly mid" admission) — the parts a real user hits first (argument parsing, provider selection, ticket ingest) are the least tested.
6. **Two untracked worktree-adjacent artefacts** (`.cx-m1-5/`, the seed workflow file) sitting in the working tree add noise to `git status` for anyone triaging this repo cold — worth a deliberate commit-or-clean pass.

## 5. Company-private to strip (de-company-ify)
**None found.** No named current/former employer or private individual anywhere in the tracked tree (grep for known employer terms and generic confidential/proprietary markers returned nothing). The repo is authored and owned as `KarlDoyle/quarry` (his own identity, not a third party) and `.github/CODEOWNERS` uses `@KarlDoyle` plus illustrative team handles (`@quarry/agent`, `@quarry/retrieval`, etc.) explicitly labelled "illustrative owning teams" — not real organisational data. Nothing to strip before this repo could be shown externally.

## 6. Secrets
**None found.** Ran the Step-3 pattern scan (`AKIA`, `-----BEGIN`, `sk-`, `ghp_`, generic 32+-char key/secret/token/password assignments) across the full tracked tree (`git grep`, 50 tracked files). The only matches were the pattern *definitions themselves* inside `tests/secret-scan.test.ts` (lines 22-31 — `sk-ant-`, `sk-`, `ghp_`, `AKIA`, PEM-block regexes), which is the repo's own deterministic secret-scan test, not a leaked credential. `.env.example` (`/Users/kdoyle/Dev/quarry/.env.example`) holds only commented-out, empty-value placeholders (`ANTHROPIC_API_KEY=` with no value). Real `.env`/`.env.*` files are gitignored and none are tracked. This scan test runs as part of `pnpm test` (and therefore CI and the pre-push hook), so the repo has a live, automated backstop, not just this one-off check.

## 7. Abstraction / productise
**Generic capability:** a fully local, zero-infrastructure code-RAG core — index any repo on one machine, hybrid-retrieve, and get a grounded, cited answer with no cloud call and no API key required by default. That local-first + hybrid-retrieval + citation combination is the reusable core, and it's already exported as a clean library surface (`src/index.ts`) that a sibling product (`marshal`) consumes directly rather than reimplementing.

**Productisation notes:**
- The `marshal` dependency (`file:../quarry`, importing `quarry/dist/index.js`) means **quarry's own build/versioning discipline directly gates marshal's stability** — any change to `src/index.ts`'s exported surface or to `dist/` output shape is a breaking change one repo away, with no semver/package-registry boundary between them (a local `file:` link, not a published package). `marshal/README.md:113-114` confirms marshal expects quarry "checked out at `../quarry`" and both share the `node:sqlite`/`--experimental-sqlite` runtime requirement — so quarry's Node ≥24 constraint and its `NODE_OPTIONS` flag are load-bearing for marshal too, not just quarry's own CI. This is a real coupling risk worth naming if quarry is pitched standalone: it is already infrastructure for another product in this estate, not just a demo.
- To productise beyond internal use: publish `dist/` as a versioned package (even a private registry) rather than a `file:`/workspace link, so marshal (and any future consumer) pins a version instead of tracking quarry's working tree; land the precision-tier work (`docs/EVAL-AND-PRECISION.md`) and measure LLM-generation quality, not just retrieval recall, before claiming end-to-end answer quality; and raise CLI/ingest test coverage before exposing the CLI to anyone outside this workspace.

## 8. Build standard
Compared against `Taisce/Library/dev-ecosystem-guide.md`'s canonical checklist (`~/Dev/ai-starter`: typecheck → lint+format → test → build, in that order, pre-push mirrors CI, deterministic secret scan in the test gate):

| Gate | Present | Evidence |
|------|---------|----------|
| Typecheck | Yes | `pnpm check` = `tsc --noEmit`; CI step 1 (`.github/workflows/ci.yml`) |
| Lint + format | Yes | `pnpm lint` = `biome check src tests scripts`; CI step 2 |
| Test | Yes | `pnpm test` = `vitest run` (11 tests, incl. secret-scan boundary test); CI step 3 |
| Build | Yes | `pnpm build` = `tsc -p tsconfig.json`; CI step 4 |
| Pre-push hook | Yes | `.githooks/pre-push` runs check + test, wired via `git config core.hooksPath .githooks` (auto-set by the `prepare` script); has a graceful no-op if `node_modules`/pnpm/npm are missing, CI is the backstop |
| CI order matches pre-push | Yes | `.github/workflows/ci.yml` comment explicitly states same order as the hook |
| Deterministic secret scan in test gate | Yes | `tests/secret-scan.test.ts`, pattern-based, runs inside `pnpm test` |
| Coverage ratchet | Yes | `pnpm coverage`, thresholds pinned at/just below measured numbers in `vitest.config.ts` |
| Eval/quality harness | Yes (retrieval only) | `pnpm eval`, gold-set-backed, `eval/RESULTS.md` re-verified 2026-06-30 |
| Tiered auto-merge | Yes | `.github/workflows/automerge.yml` + `.github/automerge-policy.yml`, `.github/workflows/seed-tier0-test.yml` (**uncommitted**, see §4) |
| CODEOWNERS | Yes | `.github/CODEOWNERS` |

Fully on the ai-starter build standard by file presence. Not independently re-run in this pass (read-only triage) — README's claim that all four gates were last clean on 2026-07-03 is taken as evidence, not re-verified.

# Retrieval quality — devtool-rag v0.2

Real measurement of hybrid (dense + BM25, fused with RRF) vs dense-only retrieval,
produced by `scripts/eval.ts` (`pnpm eval`). No inflation: numbers are copied
verbatim from the harness output and are deterministic across runs.

## Setup

| | |
|---|---|
| Tool | `devtool-rag` v0.2 (`feat/v0.2`), hybrid retrieval: sqlite-vec KNN + FTS5 BM25, RRF (k=60) |
| Corpus | `moss` — real, clean TypeScript CLI codebase |
| Embedding model | `Xenova/all-MiniLM-L6-v2` (384-dim, quantized, local/offline) |
| LLM | none — retrieval only; no Ollama, no API, no network |
| Gold set | `eval/moss-goldset.json` — **28 queries**, each mapped to the file(s) that truly answer it |
| Date | 2026-06-29 |

### Corpus indexed

| Metric | Value |
|---|---|
| Files indexed | 233 |
| Chunks indexed | 1,459 |
| Index size on disk | 10.76 MB (`index.db` + WAL/SHM) |
| One-time index + model load | ~36 s |

## Results

`recall@k` = fraction of the 28 queries with a relevant file in the top *k*
retrieved chunks. `MRR` = mean reciprocal rank of the first relevant file over
the top 10. Latency is `VectorStore.search()` wall time per query (SQLite
retrieval + RRF only; one-time index/model-load and per-query embedding are
excluded).

| Mode | recall@1 | recall@3 | recall@5 | MRR | latency p50 | latency p95 |
|---|---|---|---|---|---|---|
| **hybrid** (dense + BM25 + RRF) | 42.9% | 82.1% | 85.7% | 0.633 | ~1.3 ms | ~1.7 ms |
| **dense-only** (sqlite-vec) | 50.0% | 75.0% | 92.9% | 0.664 | ~0.45 ms | ~0.51 ms |

(recall@k and MRR are deterministic and identical run-to-run; latency figures
are representative of two runs on the same machine and vary by < 0.5 ms.)

A/B is fair: the index is built once and both modes query the same store. The
only difference is the dense-only path skips the BM25 leg via the optional
`VectorStore.search(..., { mode: "dense" })` hook added for this eval — the
default production code path (hybrid) is unchanged.

## Verdict (honest, 3 lines)

- On this 28-query / 233-file TypeScript corpus, **hybrid does not clearly beat dense-only**: dense wins on recall@1 (50% vs 43%), recall@5 (93% vs 86%) and MRR (0.664 vs 0.633), while hybrid only wins at recall@3 (82% vs 75%). The BM25 leg's OR-of-terms matching appears to inject some lexical noise that RRF can promote, slightly hurting top-1/top-5 precision here.
- Retrieval quality is **good enough to claim for top-k (k≈3–5) developer-question retrieval** — a relevant file lands in the top 5 for 86–93% of realistic questions — but **not** as a precise top-1 answer engine (~43–50% recall@1). It is a strong retrieval stage to feed an LLM, not a standalone "jump to the one file" tool.
- Both modes are effectively instant (sub-2 ms retrieval), so the dense-vs-hybrid choice is purely a quality trade-off, not a latency one.

## Limitations

- Single corpus (moss, ~1.5k chunks, all TypeScript) — results will not generalise to large polyglot repos; BM25's value typically grows with corpus size and with exact-identifier queries, so this small-corpus result likely understates hybrid's general benefit.
- Gold labels are author-judged single-/few-file targets; "relevant" = an expected path substring appears in a retrieved chunk's file path. Other files may also be reasonable answers, so absolute recall is a lower bound.
- Queries are natural-language developer questions, which favour dense semantic matching; an exact-symbol / API-name query mix would likely favour BM25/hybrid more.
- Latency excludes query embedding (~tens of ms with all-MiniLM-L6-v2) and the one-time index build (~36 s); end-to-end per-query latency is dominated by embedding, not retrieval.
- 28 queries is a small sample — treat single-digit-percentage differences as noise, not signal.

## Reproduce

```bash
# offline; embedding model must already be cached under node_modules/@xenova
pnpm eval                       # indexes moss, prints both hybrid and dense tables
EVAL_MODE=dense pnpm eval       # dense-only
EVAL_MODE=hybrid pnpm eval      # hybrid-only
pnpm eval <repoPath> <goldsetPath>   # any repo + gold set
```

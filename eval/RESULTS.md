# Quarry retrieval evaluation

## Current run

Run on 2 November 2026 with `pnpm eval ../moss eval/moss-goldset.json`.

| | Value |
|---|---|
| Corpus | Moss at commit `731ab74` |
| Source files indexed | 223 |
| Chunks indexed | 2,268 |
| Gold set | 28 questions, `eval/moss-goldset.json` |
| Embedding model | `Xenova/all-MiniLM-L6-v2` |
| Index size | 16.03 MB |
| Index time | 25.1 seconds |
| LLM used | None; this run measures retrieval only |

| Mode | recall@1 | recall@3 | recall@5 | MRR | search p50 | search p95 |
|---|---:|---:|---:|---:|---:|---:|
| Hybrid (dense + BM25 + RRF) | 46.4% | 67.9% | 82.1% | 0.600 | 1.48 ms | 2.10 ms |
| Dense-only | 53.6% | 71.4% | 89.3% | 0.667 | 0.63 ms | 0.65 ms |

In this run, dense-only returned an expected file in the top 1 for 15 of 28 questions; hybrid did so for 13. At top 3 the counts were 20 and 19; at top 5 they were 25 and 23. Dense-only had higher MRR and lower search latency on this corpus.

The differences represent one or two questions at each recall cutoff. This single corpus and small, author-written gold set do not establish that dense-only is generally better. The results do show that adding BM25 did not improve this Moss run. Keep the production default unchanged until the comparison is repeated on other corpora, including exact-identifier questions.

## How to read these numbers

- **Recall@k** is the fraction of questions where any expected path appears in the first *k* retrieved chunks. The harness ranks chunks, not unique files.
- **MRR** is the mean reciprocal rank of the first matching chunk within the top 10. Rank 1 contributes 1; rank 2 contributes 0.5; a miss contributes 0.
- **Search p50/p95** is the median and 95th-percentile time for `VectorStore.search()`. It excludes query embedding, model loading and index construction.

The gold-set labels are author judgements. Expected paths were checked to exist at the stated Moss commit; other files may also be valid answers. The evaluation does not measure generated-answer correctness, citation quality under model variation, or end-to-end latency.

## Earlier run

The 29 June 2026 run used an earlier Moss checkout with 233 files and 1,459 chunks. It reported hybrid recall@1/3/5 of 42.9%/82.1%/85.7% and MRR 0.639; dense-only reported 50.0%/75.0%/92.9% and MRR 0.664. A 30 June re-run indexed 293 files and 1,523 chunks. These are historical results from a different corpus state and should not be compared as a controlled before-and-after change.

## Reproduce

From the Quarry repository root:

```sh
pnpm eval ../moss eval/moss-goldset.json
```

The command indexes the current `../moss` checkout and prints both modes. To restrict the run:

```sh
EVAL_MODE=dense pnpm eval ../moss eval/moss-goldset.json
EVAL_MODE=hybrid pnpm eval ../moss eval/moss-goldset.json
```

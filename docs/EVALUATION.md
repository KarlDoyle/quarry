# Evaluation

## Current scope

Run from the Quarry repository root:

```bash
pnpm eval
```

`scripts/eval.ts` indexes `examples/sample-repo` into a temporary SQLite store and runs the three questions in `eval/sample-goldset.json`. It compares hybrid retrieval (dense + BM25 + RRF) with dense-only retrieval using the same query embeddings. It makes no LLM calls; model loading may require a first-use download. The target repository is not modified.

The bundled source fixture and its hand-authored questions are a small, permitted local demo corpus, not a representative benchmark. The harness exercises indexing, embedding, retrieval and metric reporting. It reports scores without enforcing a minimum retrieval score; the test suite separately asserts expected retrieval on sample questions.

## Metric definitions and limits

- **recall@1/3/5:** the harness label for the fraction of questions with any expected-file match among the first k retrieved chunks. This is an any-hit rate, not the fraction of all relevant files recovered.
- **MRR:** mean reciprocal rank of the first matching chunk within the top 10; a miss contributes zero.
- **Search p50/p95:** time in `VectorStore.search()` after a warmup, excluding query embedding, model loading, indexing and answer generation.

Results rank chunks, not unique files. Labels match by path substring, and any one expected-file match counts as a hit. Use distinctive repository-relative paths to avoid accidental matches.

The smoke fixture does not establish quality across repositories, languages or question types. A file match does not prove that a chunk contains sufficient evidence. The harness does not evaluate generated-answer correctness, citation faithfulness, abstention, prompt-injection resistance or end-to-end response latency. A successful run does not prove that hybrid retrieval outperforms dense-only retrieval.

## Plan for a permitted corpus and gold set

1. Choose a repository you have permission to process and pin its revision. Do not publish private source, paths or question text without permission.
2. Write questions representative of the intended work: conceptual behaviour, exact identifiers, error handling and questions that need multiple files. Inspect the source and record acceptable expected files before reviewing retrieval output. The current any-hit metric cannot establish that every file needed for a multi-file answer was recovered.
3. Use the existing JSON shape with a non-empty question list and non-empty labels that exist in the pinned corpus:

```json
{
  "corpus": "repository name and revision",
  "queries": [
    {
      "query": "Where is the shopping cart total calculated?",
      "expectedFiles": ["src/cart.js"]
    }
  ]
}
```

4. Run both existing modes:

```bash
pnpm eval /path/to/repository /path/to/goldset.json
```

5. Review misses and incomplete labels, including questions where either mode performs poorly. Record label corrections rather than quietly tuning the set to favour a mode. Questions with no relevant code need separate manual review; this harness has no abstention metric.
6. Compare retrieval changes on the same corpus revision, gold set, embedding model and runtime conditions. Record the full command, Quarry and corpus revisions, gold-set provenance, model, runtime, hardware and date alongside output. Treat latency from small runs as descriptive, not a stable performance estimate.

For answers, separately inspect whether each factual claim is supported by the retrieved source, whether cited files support it, and whether insufficient context is acknowledged. A single demo is illustrative evidence only.

Existing corpus-specific measurements and their limitations remain in [eval/RESULTS.md](../eval/RESULTS.md). The longer [evaluation and precision note](EVAL-AND-PRECISION.md) contains possible experiments, not evidence of unmeasured gains.

## Verification on 2 November 2026

`pnpm eval` was run on the working tree based on Quarry `e64398e`, using the unchanged bundled sample corpus and gold set, Node 24.16.0 and `Xenova/all-MiniLM-L6-v2`. It indexed three source files into three chunks. Both modes returned an expected file at rank 1 for all three questions (reported recall@1/3/5: 100%; MRR: 1.000). With only three distinct source chunks, top-3 and top-5 hits offer little discrimination. This is a harness smoke result only; it establishes no representative retrieval advantage. No new benchmark corpus was created.

A separate local `llama3.1` answer to “how is the cart total calculated?” retrieved `src/cart.js` but incorrectly claimed the context was insufficient. The file contains the complete calculation. This observed failure illustrates why retrieval hits and a source list do not establish answer correctness.

The same question was then run against the same index with local `qwen2.5-coder:7b`. Its answer cited `src/cart.js` and described subtotal, discount and tax in the source order. The answer and full source list are preserved in the README demo. This was a manual source check of one answer, not a model comparison or answer-quality score.

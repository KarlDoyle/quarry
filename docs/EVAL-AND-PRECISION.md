# Evaluation and precision — how we measure, and what we expect

> **Current result:** Quarry was evaluated on `moss@731ab74` on 2 November 2026 with the 28-query `eval/moss-goldset.json`. The default harness without arguments still uses the three-query smoke set. Full current results and limits are in `eval/RESULTS.md`.

See [Evaluation](EVALUATION.md) for current harness usage, metric definitions and a permitted-corpus evaluation plan. This longer note preserves recorded measurements and possible experiments. **Always measure before claiming.**

## 1. Measured baseline (what we can prove today)

Produced by `scripts/eval.ts` (`pnpm eval ../moss eval/moss-goldset.json`) on the
Moss checkout named in the run. Retrieval metrics are deterministic for a fixed
corpus, model and gold set; measured latency varies by machine. Full detail and
caveats live in `eval/RESULTS.md`.

- **Corpus:** `moss@731ab74` — 223 files, 2,268 chunks.
- **Embedder:** `Xenova/all-MiniLM-L6-v2` (384-dim, quantised, local/offline).
- **Gold set:** `eval/moss-goldset.json` — 28 hand-authored developer questions
  mapped to expected source paths.

| Mode | recall@1 | recall@3 | recall@5 | MRR | search p50 | search p95 |
|---|---:|---:|---:|---:|---:|---:|
| hybrid (dense + BM25 + RRF) | 46.4% | 67.9% | 82.1% | 0.600 | 1.48 ms | 2.10 ms |
| dense-only (sqlite-vec) | 53.6% | 71.4% | 89.3% | 0.667 | 0.63 ms | 0.65 ms |

On this run dense-only retrieved an expected file in the top 1 for 15 of 28
questions, compared with 13 for hybrid. At top 3 the counts were 20 and 19; at
top 5 they were 25 and 23. Dense-only also had higher MRR and lower measured
search latency on this corpus. These are small differences on one 28-question
set, so they do not establish that dense-only is generally better. The harness
measures retrieval, not the quality of generated answers.

## 2. Possible retrieval experiments

These are possible retrieval experiments, not measured Quarry improvements. Their priority and benefit remain unverified; compare each against the same permitted corpus and gold set before making a claim.

1. **Code-specific embeddings**. Potential benefit must be established for Quarry’s corpus and runtime constraints. General text embedders (MiniLM) under-represent code structure;
   embedders trained on code rank function- and API-level matches far better.
   Open options: `jinaai/jina-embeddings-v2-base-code` (small, Apache-2.0),
   `nomic-ai/nomic-embed-code` (7B, open weights, needs a GPU). Current SOTA
   code retrievers (Salesforce CodeXEmbed / SFR-Embedding-Code, Voyage-code) are
   gated or paid and are a **server/GPU tier, not a laptop tier**.
   - <https://huggingface.co/jinaai/jina-embeddings-v2-base-code>
   - <https://huggingface.co/nomic-ai/nomic-embed-code>
   - <https://huggingface.co/Salesforce/SFR-Embedding-Code-2B_R>

2. **Cross-encoder reranker**.
   Retrieve a generous top-k by vector distance, then re-score each candidate
   *jointly* with the query using a cross-encoder. It may help when the right file is in the candidate set but ranks poorly. `BAAI/bge-reranker-v2-m3` is
   568M and CPU-runnable, so it can ship without a GPU. Potential benefit must be established for Quarry’s corpus and runtime constraints.
   - <https://huggingface.co/BAAI/bge-reranker-v2-m3>
   - <https://www.pinecone.io/learn/series/rag/rerankers/>

3. **Hybrid retrieval (dense + BM25 + RRF)** — *already in core.* In the current
   Moss run, dense-only scored higher on recall@1/3/5 and MRR. Test other
   repositories and exact-identifier queries before drawing a broader conclusion
   or changing the default.

4. **AST-aware chunking**. Chunk on syntactic
   boundaries (functions, classes) rather than fixed character windows, so a
   chunk is a coherent unit of code. The core currently uses char-based,
   line-aware chunking (`src/indexer/chunking-strategies.ts`); AST chunking via
   tree-sitter is the next step up and is deliberately kept out of core to stay
   compiler-free.
   - <https://docs.llamaindex.ai/en/stable/api_reference/node_parsers/code/>
   - <https://tree-sitter.github.io/tree-sitter/>

5. **Contextual embeddings (Anthropic technique)** — requires an LLM call per chunk at index time. Prepend a short LLM-generated
   description situating each chunk within its file/repo before embedding, so the
   vector carries context the raw snippet lacks. Powerful, but the heaviest tier:
   index-time LLM cost and complexity.
   - <https://www.anthropic.com/news/contextual-retrieval>

6. **Query transforms (rewriting / HyDE / expansion)** — another possible experiment, with additional query-time complexity. No Quarry comparison is recorded here.

## 3. Current core and proposed opt-in configurations

Only core is the shipped default described here. The other configurations are proposed experiments, not implemented runtime tiers or measured Quarry results.

- **`core`** *(default — laptop / demo)*: MiniLM embeddings in-process, hybrid
  dense + BM25 retrieval, single `node:sqlite` file. No GPU, no server, no API
  key. This is what is proven in §1 and what ships today.
- **`precision`** *(opt-in — heavier)*: code-specific embeddings + cross-encoder
  reranker (levers 1 + 2). The reranker is CPU-runnable; the best code embedders
  want a GPU. This proposed configuration has no recorded Quarry result here (see §5).
- **`contextual`** *(heaviest)*: AST chunking + contextual chunking (levers 4 +
  5), with an LLM at index time. Adds parsing and index-time inference complexity; gains are unmeasured here.

Hardware reality: SOTA 7B code embedders need ~14 GB VRAM — a GPU/server tier,
**not a MacBook Air**. The laptop only ever runs `core`.

## 4. Testing the heavier tiers for free

We do not strain a laptop to measure the precision tier. `eval/precision_benchmark.py`
is a self-contained Python rig that runs on a **free, throwaway cloud GPU** —
Google Colab (T4, ~16 GB) or Kaggle — at **£0**, installing **nothing locally**,
on an **ephemeral** runtime. It indexes a code dir, retrieves, optionally reranks,
and prints a recall@1/@3/@5 + MRR comparison table across configs. Step-by-step
instructions: `eval/COLAB.md`.

The code-specific model is disabled by default because loading it can execute
Python from its model repository. Enable it only after reviewing that code and
pinning `CODE_MODEL_REVISION` to its full commit SHA, as described in
`eval/COLAB.md`.

The benchmark reuses the gold-set shape of `eval/moss-goldset.json`. Point it at a
cloned `moss` + the uploaded gold set for real numbers; leave it unconfigured for
a zero-setup smoke run against a tiny built-in synthetic corpus (directional only).

## 5. Standing metrics and expectations

- **Core has a measured baseline.** The §1 numbers are reproducible for the
  stated corpus, gold set and model. Give those conditions with any result.
- **Precision remains unmeasured here.** No precision-tier number goes into
  the README or docs until it has been measured by `eval/precision_benchmark.py`
  on our gold set and the table recorded.
- **No retrieval target is established here.** Future measurements should report both improvements and regressions against the same baseline.
- **Always measure before claiming.** The options in §2 are hypotheses;
  only the harness output is evidence. When a tier is measured, record the table
  here and in `eval/RESULTS.md` with the model names, corpus, and date.

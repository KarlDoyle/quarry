# Evaluation and precision — how we measure, and what we expect

This is the durable reference for retrieval quality in Quarry:
the numbers we have actually measured, the levers that improve precision (ranked,
with honest expected gains and sources), the tiered architecture that keeps the
laptop lean, and how we test the heavier tiers for free. British English, plain,
no inflation. The standing rule: **always measure before claiming**.

## 1. Measured baseline (what we can prove today)

Produced by `scripts/eval.ts` (`pnpm eval`) on the `moss` corpus — a real, clean
TypeScript CLI codebase. Numbers are copied verbatim from the harness; they are
deterministic run-to-run. Full detail and caveats live in `eval/RESULTS.md`.

- **Corpus:** `moss` — 233 files, 1,459 chunks, ~10.8 MB index.
- **Embedder:** `Xenova/all-MiniLM-L6-v2` (384-dim, quantised, local/offline).
- **Gold set:** `eval/moss-goldset.json` — 28 real developer questions, each
  mapped to the file(s) that truly answer it.

| Mode | recall@1 | recall@3 | recall@5 | MRR |
|---|---|---|---|---|
| hybrid (dense + BM25 + RRF) | 42.9% | 82.1% | 85.7% | 0.633 |
| dense-only (sqlite-vec) | 50.0% | 75.0% | 92.9% | 0.664 |

Read honestly: the core is a **strong top-k (k≈3–5) retrieval stage to feed an
LLM** — a relevant file lands in the top 5 for ~86–93% of realistic questions —
but it is **not** a precise "jump to the one file" engine (~43–50% recall@1).
Retrieval is sub-2 ms either way, so the dense-vs-hybrid choice is a quality
trade-off, not a latency one. On this small single-language corpus hybrid does
not clearly beat dense; BM25's value typically grows with corpus size and with
exact-identifier queries.

## 2. The precision recipe (ranked levers)

Where to spend effort to lift recall@1 from ~50% towards ~85%+, best ROI first.
Expected gains are indicative ranges from the literature and vendor reports, not
promises — each must be **benchmarked on our gold set** before we quote it.

1. **Code-specific embeddings** — *expected ~+15–20% recall.* The single biggest
   lever. General text embedders (MiniLM) under-represent code structure;
   embedders trained on code rank function- and API-level matches far better.
   Open options: `jinaai/jina-embeddings-v2-base-code` (small, Apache-2.0),
   `nomic-ai/nomic-embed-code` (7B, open weights, needs a GPU). Current SOTA
   code retrievers (Salesforce CodeXEmbed / SFR-Embedding-Code, Voyage-code) are
   gated or paid and are a **server/GPU tier, not a laptop tier**.
   - <https://huggingface.co/jinaai/jina-embeddings-v2-base-code>
   - <https://huggingface.co/nomic-ai/nomic-embed-code>
   - <https://huggingface.co/Salesforce/SFR-Embedding-Code-2B_R>

2. **Cross-encoder reranker** — *expected ~+5–10% recall, the "10x multiplier".*
   Retrieve a generous top-k by vector distance, then re-score each candidate
   *jointly* with the query using a cross-encoder. It fixes the cases where the
   right file is in the top-10 but not the top-1/3. `BAAI/bge-reranker-v2-m3` is
   568M and CPU-runnable, so it can ship without a GPU. Highest leverage per line
   of code once a decent embedder is in place.
   - <https://huggingface.co/BAAI/bge-reranker-v2-m3>
   - <https://www.pinecone.io/learn/series/rag/rerankers/>

3. **Hybrid retrieval (dense + BM25 + RRF)** — *we already have this.* Keeps
   exact identifiers and fuzzy intent both ranking well. Its benefit grows with
   corpus size and exact-symbol queries; on the small moss corpus it is roughly
   a wash (see §1). Keep it; re-measure on larger/polyglot corpora.

4. **AST-aware chunking** — *expected ~+3–8% recall.* Chunk on syntactic
   boundaries (functions, classes) rather than fixed character windows, so a
   chunk is a coherent unit of code. The core currently uses char-based,
   line-aware chunking (`src/indexer/chunking-strategies.ts`); AST chunking via
   tree-sitter is the next step up and is deliberately kept out of core to stay
   compiler-free.
   - <https://docs.llamaindex.ai/en/stable/api_reference/node_parsers/code/>
   - <https://tree-sitter.github.io/tree-sitter/>

5. **Contextual embeddings (Anthropic technique)** — *expected ~+5–15% recall,
   but costs an LLM call per chunk at index time.* Prepend a short LLM-generated
   description situating each chunk within its file/repo before embedding, so the
   vector carries context the raw snippet lacks. Powerful, but the heaviest tier:
   index-time LLM cost and complexity.
   - <https://www.anthropic.com/news/contextual-retrieval>

6. **Query transforms (rewriting / HyDE / expansion)** — *low ROI here.* Useful
   in some pipelines but typically a small, noisy gain for code search relative
   to its complexity. Lowest priority.

## 3. Tiered, opt-in architecture

Precision is **opt-in** so the default experience stays lean and runs anywhere.

- **`core`** *(default — laptop / demo)*: MiniLM embeddings in-process, hybrid
  dense + BM25 retrieval, single `node:sqlite` file. No GPU, no server, no API
  key. This is what is proven in §1 and what ships today.
- **`precision`** *(opt-in — heavier)*: code-specific embeddings + cross-encoder
  reranker (levers 1 + 2). The reranker is CPU-runnable; the best code embedders
  want a GPU. This tier is **benchmarked, not claimed** (see §5).
- **`contextual`** *(heaviest)*: AST chunking + contextual chunking (levers 4 +
  5), with an LLM at index time. Largest gains, largest cost.

Hardware reality: SOTA 7B code embedders need ~14 GB VRAM — a GPU/server tier,
**not a MacBook Air**. The laptop only ever runs `core`.

## 4. Testing the heavier tiers for free

We do not strain a laptop to measure the precision tier. `eval/precision_benchmark.py`
is a self-contained Python rig that runs on a **free, throwaway cloud GPU** —
Google Colab (T4, ~16 GB) or Kaggle — at **£0**, installing **nothing locally**,
on an **ephemeral** runtime. It indexes a code dir, retrieves, optionally reranks,
and prints a recall@1/@3/@5 + MRR comparison table across configs. Step-by-step
instructions: `eval/COLAB.md`.

The benchmark reuses the gold-set shape of `eval/moss-goldset.json`. Point it at a
cloned `moss` + the uploaded gold set for real numbers; leave it unconfigured for
a zero-setup smoke run against a tiny built-in synthetic corpus (directional only).

## 5. Standing metrics and expectations

- **Core is proven and runs anywhere.** The §1 numbers are real, deterministic,
  and reproducible with `pnpm eval`. Quote them freely.
- **Precision is benchmarked, not claimed.** No precision-tier number goes into
  the README or docs until it has been measured by `eval/precision_benchmark.py`
  on our gold set and the table recorded.
- **Target:** recall@1 ≥ ~80% for the precision tier (up from ~50% baseline),
  with recall@5 ≥ ~90%. This is the bar the levers in §2 are meant to clear.
- **Always measure before claiming.** Expected-gain ranges in §2 are hypotheses;
  only the harness output is evidence. When a tier is measured, record the table
  here and in `eval/RESULTS.md` with the model names, corpus, and date.

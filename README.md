# Quarry

**Local-first codebase retrieval and grounded analysis.**

Quarry indexes a codebase locally, retrieves relevant source files and uses them as evidence for code questions and ticket analysis. It combines semantic and keyword search, then grounds answers in the retrieved code and cites the files used.

It is designed for engineers who want to explore and understand a codebase without sending source code to a hosted embedding service or requiring a separate database server.

![local-first](https://img.shields.io/badge/local--first-yes-6ee7b7?style=flat-square)
![licence](https://img.shields.io/badge/licence-UNLICENSED-slategray?style=flat-square)

## How it works

1. **Index:** parse and chunk source files using language-aware handling.
2. **Embed:** generate local embeddings with Transformers.js.
3. **Store:** keep vectors, source text and full-text search data in Node's built-in SQLite.
4. **Retrieve:** combine dense vector search and BM25 keyword search using Reciprocal Rank Fusion.
5. **Analyse:** send retrieved context to a local LLM and produce an answer grounded in the source, with file citations.

The default analysis provider is local Ollama. The embedding model and LLM provider can be changed; an Anthropic provider is available as an optional fallback.

## Why hybrid retrieval?

Semantic retrieval can find conceptually related code, while keyword retrieval can be useful for exact identifiers, symbols and error strings. Quarry combines both signals rather than relying on either alone.

The retrieval evaluation is deliberately reported with its limitations.

### Measured retrieval results

The committed evaluation uses a 28-query gold set against a 293-file code corpus. The latest recorded re-verification in the repository is dated **30 June 2026**.

| Mode | recall@1 | recall@3 | recall@5 | MRR | Search p50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Hybrid** (dense + BM25 + RRF) | 42.9% | 82.1% | 85.7% | 0.639 | ~1.3 ms |
| Dense-only (sqlite-vec) | 50.0% | 75.0% | 92.9% | 0.664 | ~0.5 ms |

These results show a useful top-k retrieval stage: a relevant file appeared in the top three for about 82% of the evaluation queries with hybrid retrieval. They do **not** show that hybrid retrieval wins on every metric; dense-only performed better on recall@1, recall@5 and MRR in this run.

This is a small, single-codebase evaluation. It measures retrieval quality and search latency, not end-to-end LLM response quality or latency. The benchmark is evidence for continued investigation, not a general performance claim.

See [the evaluation results and methodology](eval/RESULTS.md) for the full detail and caveats.

Run the evaluation with:

```bash
pnpm eval ~/Dev/moss eval/moss-goldset.json
```

## Ticket analysis

Quarry also exposes an `analyze-ticket` path that can ingest a Jira issue and analyse it against an indexed repository. It retrieves likely relevant code and asks the model to identify an approach, likely affected files and risks.

This capability became the foundation for **Marshal**, a separate workflow that extends the retrieval engine with multi-repository routing, CODEOWNERS-based ownership evidence and structured ticket rewriting.

## Technical design

- **Runtime:** Node.js 24+, TypeScript.
- **Storage:** Node's built-in `node:sqlite`, `sqlite-vec` and SQLite FTS5.
- **Embeddings:** Transformers.js, running locally.
- **Retrieval:** dense vector search + BM25 keyword search, fused with Reciprocal Rank Fusion.
- **LLM:** local Ollama by default; optional Anthropic provider.
- **Interface:** CLI and importable library surface.

No database server or native compiler is required for the native runtime path. The first index run downloads the embedding model; subsequent indexing and retrieval can run locally. LLM analysis requires a configured local model or an optional hosted provider.

## Quick start

```bash
pnpm install
pnpm build

node dist/cli.js index ./examples/sample-repo
node dist/cli.js search "retry a request with backoff"
node dist/cli.js analyze "how is the cart total calculated?"
node dist/cli.js analyze-ticket --fixture ./tests/fixtures/jira-issue.json
node dist/cli.js stats
```

For `analyze` and `analyze-ticket`, start Ollama and pull a model such as `llama3.1`:

```bash
ollama serve
ollama pull llama3.1
```

The first indexing run downloads the embedding model once. The default local path does not require an API key.

## Engineering approach

Quarry was developed through an iterative process: starting with focused code-retrieval experiments, testing how useful the results were, measuring retrieval quality and evolving the strongest ideas into a reusable engine.

AI-assisted development with Claude, alongside shared starter templates, prompts and engineering harnesses, has helped accelerate implementation and expand the testing and evaluation work. The important engineering decisions remain human-led: choosing the retrieval strategy, measuring it against a gold set, inspecting where it performs poorly and documenting the trade-offs rather than presenting the best-looking metric alone.

The evaluation is intentionally candid: hybrid search improves some top-k results but does not outperform dense-only across all reported measures. That result informs the next experiments rather than being hidden.

## Development and quality

```bash
pnpm check
pnpm lint
pnpm test
pnpm coverage
```

The repository's README previously recorded a 3 July 2026 verification of 4 test files / 11 tests and a 29 June 2026 coverage snapshot. Those are historical snapshots, not a claim about the current checkout. The recorded coverage was modest, with the CLI, config and provider edges less tested than the indexer and vector store. Consult the current CI run and coverage output for present status.

## Roadmap

- ✅ Local index → hybrid search → grounded analysis in a local SQLite store.
- ✅ Jira ticket analysis and swappable embedding / LLM providers.
- ◻ Incremental per-file re-indexing.
- ◻ Richer symbol-level parsing.
- ◻ Cross-encoder reranking, if further evaluation shows it is worthwhile.

The project deliberately avoids native tree-sitter grammars, agentic multi-step loops and heavy evaluation frameworks in order to keep the core lean.

## Licence

UNLICENSED — all rights reserved. Source-available for personal/portfolio review; no public open-source licence is included.

# Retrieval design and evidence

Quarry uses two retrieval signals. Dense search can match a question to code with related meaning. FTS5 keyword search can surface exact terms such as identifiers. The store combines their ranked lists with Reciprocal Rank Fusion (RRF); the current constant is in `src/vector-store/index.ts`.

## What the tests establish

- `tests/integration.test.ts` exercises the local index and search path.
- `tests/ticket-analysis.test.ts` uses a fixture ticket and a mock LLM provider.
- `tests/providers.test.ts` checks provider and fallback behaviour without a real model service.
- `tests/citation.test.ts` covers citation metadata.
- The CI workflow builds the package and installs the packed artifact in a clean consumer.

These tests establish behaviour for their fixtures. They do not measure answer quality across models or representative repositories.

## Evaluation status

The checked-in `eval/sample-goldset.json` is a small harness smoke set. The default `pnpm eval` uses it with `examples/sample-repo`. `eval/moss-goldset.json` has 28 questions mapped to expected paths in Moss at commit `731ab74`. The 2 November run is recorded in `eval/RESULTS.md`; rerun `pnpm eval ../moss eval/moss-goldset.json` from the Quarry directory to measure a later checkout.

The harness measures retrieval, not generated-answer quality, citations under model variation, or end-to-end latency. A representative evaluation should record the corpus revision, gold-set provenance, embedding model, retrieval configuration, date and full command alongside the result.

## Limits to report

The bundled smoke set is too small to support general retrieval-quality claims. A single corpus and author-labelled expected paths do not establish performance across languages or projects. Model-generated answer quality remains separate from retrieval recall and needs its own evaluation.

## Decision records

These records describe the current implementation and its trade-offs, rather than asserting a historical decision process.

### Local embeddings and embedded SQLite

**Decision:** keep embeddings on-device and vectors, chunks and FTS5 data in one SQLite store, without a database server in the default path.

**Trade-off:** first use downloads model weights; local model inference and indexing consume host resources. Hosted analysis remains an explicit choice. Revisit storage only if measured corpus requirements justify the operational cost.

### Hybrid retrieval with a dense-only comparison

**Decision:** retain dense + BM25 retrieval fused with RRF as the existing default; keep dense-only as the evaluation comparison.

**Trade-off:** keyword matches can surface exact terms but can also change rankings unfavourably. The recorded Moss run favours dense-only on its labels; that does not establish a general winner. Revisit the default only after controlled comparisons on representative permitted corpora. See [Evaluation](EVALUATION.md) for metric semantics.

### Retrieved context and source citations

**Decision:** pass retrieved code as untrusted data to a provider instructed to use only that context, acknowledge insufficient evidence and cite source paths. Keep the retrieved source list available for inspection.

**Trade-off:** prompt instructions and a source list do not guarantee grounded answers or prevent prompt injection. Source-position tests establish metadata behaviour, not model citation faithfulness. Review real answers against their cited code before presenting them as examples.

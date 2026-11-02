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

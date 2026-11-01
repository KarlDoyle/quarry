# Quarry

**Local-first codebase retrieval and grounded analysis.**

Quarry indexes a codebase locally, retrieves relevant source files and uses them as evidence for code questions and ticket analysis. It combines semantic and keyword search, then grounds answers in the retrieved code and cites the files used.

It is designed for engineers who want to explore and understand a codebase without sending source code to a hosted embedding service or requiring a separate database server.

Maintained by [Karl Doyle](https://github.com/KarlDoyle). Source: [github.com/KarlDoyle/quarry](https://github.com/KarlDoyle/quarry).

![local-first](https://img.shields.io/badge/local--first-yes-6ee7b7?style=flat-square)
![licence](https://img.shields.io/badge/licence-MIT-6ee7b7?style=flat-square)

## How it works

1. **Index:** parse and chunk source files using language-aware handling.
2. **Embed:** generate local embeddings with Transformers.js.
3. **Store:** keep vectors, source text and full-text search data in Node's built-in SQLite.
4. **Retrieve:** combine dense vector search and BM25 keyword search using Reciprocal Rank Fusion.
5. **Analyse:** send retrieved context to a local LLM and produce an answer grounded in the source, with file citations.

The default analysis provider is local Ollama. The embedding model and LLM provider can be changed; an Anthropic provider is available as an optional fallback.

## Why hybrid retrieval?

Semantic retrieval can find conceptually related code, while keyword retrieval can be useful for exact identifiers, symbols and error strings. Quarry combines both signals rather than relying on either alone.

The bundled evaluation is a small smoke test for the evaluation harness, not
evidence of representative retrieval quality. Use a corpus and gold set you
have permission to process before making performance claims.

### Evaluation

The checked-in three-query fixture uses `examples/sample-repo` and exists to
exercise the harness. Its results are not representative and should not be
quoted as product performance. The harness measures retrieval, not end-to-end
LLM response quality or latency.

See [the evaluation methodology](docs/EVAL-AND-PRECISION.md) for guidance on
measuring against a representative corpus.

Run the evaluation with:

```bash
pnpm eval
# Or supply a corpus and a matching JSON gold set:
pnpm eval /path/to/repository /path/to/goldset.json
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

## Package installation

The package name is `@mrkarldoyle/quarry`. Install the CLI globally with:

```bash
npm install --global @mrkarldoyle/quarry
```

To use Quarry as a library in a project, install it as a dependency with `npm install @mrkarldoyle/quarry`.

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

The retrieval evaluation records both the cases where hybrid search helps and the cases where dense-only search performs better. AI assistants helped with implementation and test development. I chose the retrieval design, reviewed the results and decided which trade-offs to keep.

## Development and quality

```bash
pnpm check
pnpm lint
pnpm test
pnpm coverage
```

GitHub Actions runs typecheck, lint, coverage-enforced tests and a build. It also installs the packed tarball in a clean consumer and checks the library exports and CLI. See the [latest workflow run](https://github.com/KarlDoyle/quarry/actions).

## Roadmap

- ✅ Local index → hybrid search → grounded analysis in a local SQLite store.
- ✅ Jira ticket analysis and swappable embedding / LLM providers.
- ◻ Incremental per-file re-indexing.
- ◻ Richer symbol-level parsing.
- ◻ Cross-encoder reranking, if further evaluation shows it is worthwhile.

The project deliberately avoids native tree-sitter grammars, agentic multi-step loops and heavy evaluation frameworks in order to keep the core lean.

## Licence

Quarry is licensed under the MIT License. See [LICENSE](LICENSE).

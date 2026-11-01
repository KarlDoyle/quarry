# Evaluation and precision

Quarry's bundled evaluation is a small smoke test over `examples/sample-repo`.
It checks that indexing, retrieval, and the metrics harness work together. Its
three queries are not representative of real repositories, so their scores
must not be presented as product performance.

## Measure a representative corpus

To measure retrieval quality, choose a repository and a matching gold set that
you are authorized to process. Each gold-set entry should contain a natural
language query and one or more expected file path substrings. Run:

```bash
pnpm eval /path/to/repository /path/to/goldset.json
```

The harness compares hybrid retrieval with dense-only retrieval and reports
recall@k, mean reciprocal rank, and retrieval latency. Record the corpus,
gold-set size, model, date, and caveats with any results. Avoid uploading
private source code or evaluation data to a hosted notebook unless you have
permission to do so.

## Precision experiments

`eval/precision_benchmark.py` is an optional experiment for comparing code
embedders and rerankers. Its built-in synthetic corpus is only a smoke test.
Performance gains are hypotheses until measured on a representative corpus and
matching gold set. Keep the default install local and lightweight; heavier
models remain opt-in.

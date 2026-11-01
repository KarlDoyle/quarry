#!/usr/bin/env python3
"""
precision_benchmark.py — Quarry precision-tier benchmark.

Measures whether the *precision* tier levers actually move retrieval quality,
WITHOUT touching the laptop. Designed to be pasted/uploaded into a free Google
Colab (or Kaggle) GPU runtime and run as-is: no API key, no paid services, no
local install. It pip-installs everything it needs on first run.

What it does
------------
1. Indexes a code directory (char-based, line-aware chunking that mirrors the
   TypeScript core's chunker in src/indexer/chunking-strategies.ts).
2. Embeds chunks with one or more models and retrieves top-k by cosine
   similarity.
3. Optionally reranks the top candidates with a cross-encoder ("the 10x
   multiplier" lever).
4. Reports recall@1 / @3 / @5 and MRR as a single comparison TABLE across
   configs, so you can read the gains per lever at a glance.

Configs compared (see CONFIGS below)
------------------------------------
- baseline      : sentence-transformers/all-MiniLM-L6-v2  (what the core ships)
- code          : an openly-downloadable code embedder
- baseline+rr   : baseline + cross-encoder reranker
- code+rr       : code embedder + cross-encoder reranker

Gold set
--------
Same shape as eval/sample-goldset.json: {"queries": [{"query": ..,
"expectedFiles": [substr, ...]}, ...]}. A query is a "hit@k" if any expected
substring appears in the file path of any top-k retrieved chunk.

- For representative measurements: use a repository and gold set you are
  authorized to process, and set REPO_PATH and GOLDSET_PATH to those files.
- For a zero-setup smoke run: leave both as None. The script writes a tiny
  built-in synthetic corpus + matching gold set so the rig runs out of the box
  and the table renders. Synthetic numbers are not product performance data.

This script only MEASURES. It never claims a number it did not just compute.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

# ---------------------------------------------------------------------------
# CONFIG — edit these (everything parameterised lives here).
# ---------------------------------------------------------------------------

# Baseline = exactly what the laptop/core tier runs today (all-MiniLM-L6-v2).
BASELINE_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

# Code-specific embedder. Pick a FREELY-downloadable one. Good open options:
#   - "jinaai/jina-embeddings-v2-base-code"  (161M, Apache-2.0, open download)
#   - "nomic-ai/nomic-embed-code"            (7B, open weights, needs the GPU)
# Note: the current SOTA code retrievers (e.g. Salesforce CodeXEmbed / SFR-
# Embedding-Code, Voyage-code) are gated or paid and are a server/GPU tier,
# not a laptop tier — left out on purpose. Swap CODE_MODEL freely.
CODE_MODEL = "jinaai/jina-embeddings-v2-base-code"

# Cross-encoder reranker. bge-reranker-v2-m3 is 568M and CPU-runnable; it is
# the "10x multiplier" lever — it re-scores the top candidates jointly with the
# query instead of by independent vector distance.
RERANKER_MODEL = "BAAI/bge-reranker-v2-m3"

# Point these at a real clone + uploaded gold set for real numbers.
# Leave as None to use the built-in synthetic smoke corpus + gold set.
REPO_PATH: str | None = None          # e.g. "/content/your-repository"
GOLDSET_PATH: str | None = None        # e.g. "/content/your-goldset.json"

# Retrieval / rerank depth.
RETRIEVE_K = 10                        # candidates pulled by dense retrieval
RERANK_CANDIDATES = 10                 # how many of those the reranker re-scores
RECALL_KS = (1, 3, 5)                  # report recall at these cut-offs

# Which configs to run. Set RUN_CODE=False to skip the (large) code model, or
# RUN_RERANK=False to skip the reranker, e.g. for a quick baseline-only pass.
RUN_CODE = True
RUN_RERANK = True

# Files to index. Mirrors a code corpus; extend as needed.
CODE_EXTENSIONS = {
    ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java",
    ".rb", ".php", ".c", ".cpp", ".cs", ".sh", ".sql",
}
IGNORE_DIRS = {"node_modules", ".git", "dist", "build", "vendor", ".venv",
               "__pycache__", "target", "coverage"}

# Char-based chunking — mirrors src/indexer/chunking-strategies.ts (~600 chars,
# 100 overlap) so the benchmark is a fair stand-in for the core's behaviour.
CHUNK_SIZE = 600
CHUNK_OVERLAP = 100


# ---------------------------------------------------------------------------
# Dependency bootstrap (Colab/Kaggle-friendly; installs on first run only).
# ---------------------------------------------------------------------------

def _ensure_deps() -> None:
    try:
        import sentence_transformers  # noqa: F401
        import torch  # noqa: F401
    except ImportError:
        print("Installing sentence-transformers + torch (one-time)…", flush=True)
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", "-q",
            "sentence-transformers>=3.0.0",
            "einops",            # required by some code models' remote code
        ])


# ---------------------------------------------------------------------------
# Chunking.
# ---------------------------------------------------------------------------

def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP):
    """Char-based, line-aware chunking with overlap.

    Prefers to break on a newline near the window edge so chunks land on
    natural code boundaries, mirroring the TypeScript core's strategy.
    """
    if not text:
        return []
    if len(text) <= size:
        return [text]
    chunks: list[str] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + size, n)
        if end < n:
            # Look back up to 100 chars for a newline to break cleanly on.
            window = text[max(start, end - 100):end]
            nl = window.rfind("\n")
            if nl != -1:
                end = max(start, end - 100) + nl + 1
        chunk = text[start:end]
        if chunk.strip():
            chunks.append(chunk)
        if end >= n:
            break
        start = max(end - overlap, start + 1)
    return chunks


def collect_chunks(repo_path: Path):
    """Return parallel lists of (chunk_text, relative_file_path)."""
    texts: list[str] = []
    paths: list[str] = []
    for path in sorted(repo_path.rglob("*")):
        if not path.is_file():
            continue
        if any(part in IGNORE_DIRS for part in path.parts):
            continue
        if path.suffix not in CODE_EXTENSIONS:
            continue
        try:
            content = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        rel = str(path.relative_to(repo_path))
        for ch in chunk_text(content):
            texts.append(ch)
            paths.append(rel)
    return texts, paths


# ---------------------------------------------------------------------------
# Built-in synthetic smoke corpus + gold set (used when REPO_PATH is None).
# ---------------------------------------------------------------------------

_SYNTHETIC_FILES: dict[str, str] = {
    "src/auth/password.py": (
        "import hashlib, os\n\n"
        "def hash_password(password: str, salt: bytes) -> str:\n"
        "    \"\"\"Hash a password with SHA-256 and the given salt.\"\"\"\n"
        "    return hashlib.sha256(salt + password.encode()).hexdigest()\n\n"
        "def verify_login(password: str, stored_hash: str, salt: bytes) -> bool:\n"
        "    \"\"\"Re-hash the attempt and compare against the stored hash.\"\"\"\n"
        "    return hash_password(password, salt) == stored_hash\n"
    ),
    "src/net/http_client.py": (
        "import time, urllib.request\n\n"
        "def request_with_backoff(url: str, retries: int = 3):\n"
        "    \"\"\"Retry an HTTP GET with exponential backoff.\"\"\"\n"
        "    delay = 0.5\n"
        "    for attempt in range(retries):\n"
        "        try:\n"
        "            return urllib.request.urlopen(url).read()\n"
        "        except Exception:\n"
        "            time.sleep(delay)\n"
        "            delay *= 2\n"
        "    raise RuntimeError('request failed after retries')\n"
    ),
    "src/cart/totals.py": (
        "def cart_total(items, tax_rate: float = 0.2) -> float:\n"
        "    \"\"\"Sum line items and apply tax to compute the cart total.\"\"\"\n"
        "    subtotal = sum(i['price'] * i['qty'] for i in items)\n"
        "    return round(subtotal * (1 + tax_rate), 2)\n"
    ),
    "src/db/sqlite_store.py": (
        "import sqlite3\n\n"
        "def open_store(path: str):\n"
        "    \"\"\"Open a SQLite vector store and ensure the schema exists.\"\"\"\n"
        "    conn = sqlite3.connect(path)\n"
        "    conn.execute('CREATE TABLE IF NOT EXISTS vectors(id INTEGER, vec BLOB)')\n"
        "    return conn\n"
    ),
    "src/index/chunker.py": (
        "def make_chunks(text: str, size: int = 600, overlap: int = 100):\n"
        "    \"\"\"Split source text into overlapping char-based chunks.\"\"\"\n"
        "    out, start = [], 0\n"
        "    while start < len(text):\n"
        "        out.append(text[start:start + size])\n"
        "        start += size - overlap\n"
        "    return out\n"
    ),
    "src/config/loader.py": (
        "import json\n\n"
        "def load_config(path: str) -> dict:\n"
        "    \"\"\"Load and validate JSON config from disk, localhost-only.\"\"\"\n"
        "    cfg = json.loads(open(path).read())\n"
        "    assert cfg.get('host', 'localhost') == 'localhost'\n"
        "    return cfg\n"
    ),
    "src/cli/commands.py": (
        "import argparse\n\n"
        "def build_parser():\n"
        "    \"\"\"Register all CLI subcommands (index, search, analyze).\"\"\"\n"
        "    p = argparse.ArgumentParser()\n"
        "    sub = p.add_subparsers(dest='command')\n"
        "    sub.add_parser('index')\n"
        "    sub.add_parser('search')\n"
        "    sub.add_parser('analyze')\n"
        "    return p\n"
    ),
    "src/embed/generator.py": (
        "class EmbeddingGenerator:\n"
        "    \"\"\"Generate dense vector embeddings for text locally.\"\"\"\n"
        "    def __init__(self, model_name: str):\n"
        "        self.model_name = model_name\n"
        "    def generate(self, text: str):\n"
        "        raise NotImplementedError\n"
    ),
}

_SYNTHETIC_GOLDSET = {
    "corpus": "synthetic-smoke",
    "queries": [
        {"query": "How are passwords verified against the stored hash?",
         "expectedFiles": ["auth/password.py"]},
        {"query": "How do I retry an HTTP request with exponential backoff?",
         "expectedFiles": ["net/http_client.py"]},
        {"query": "Where is the cart total calculated including tax?",
         "expectedFiles": ["cart/totals.py"]},
        {"query": "How is the SQLite vector store opened and its schema created?",
         "expectedFiles": ["db/sqlite_store.py"]},
        {"query": "How is source code split into overlapping chunks?",
         "expectedFiles": ["index/chunker.py"]},
        {"query": "How is config loaded and validated as localhost-only?",
         "expectedFiles": ["config/loader.py"]},
        {"query": "Where are the CLI subcommands registered?",
         "expectedFiles": ["cli/commands.py"]},
        {"query": "How are dense embeddings generated locally?",
         "expectedFiles": ["embed/generator.py"]},
    ],
}


def write_synthetic_corpus() -> tuple[Path, dict]:
    tmp = Path(tempfile.mkdtemp(prefix="quarry-smoke-"))
    for rel, content in _SYNTHETIC_FILES.items():
        fp = tmp / rel
        fp.parent.mkdir(parents=True, exist_ok=True)
        fp.write_text(content, encoding="utf-8")
    return tmp, _SYNTHETIC_GOLDSET


# ---------------------------------------------------------------------------
# Retrieval + metrics.
# ---------------------------------------------------------------------------

def is_hit(file_path: str, expected: list[str]) -> bool:
    return any(e in file_path for e in expected)


def embed_corpus(model, texts: list[str]):
    return model.encode(
        texts, batch_size=64, convert_to_numpy=True,
        normalize_embeddings=True, show_progress_bar=True,
    )


def retrieve(model, corpus_emb, queries: list[str], k: int):
    """Return, per query, a list of corpus indices ranked by cosine sim."""
    import numpy as np
    q_emb = model.encode(
        queries, convert_to_numpy=True, normalize_embeddings=True,
    )
    sims = q_emb @ corpus_emb.T  # both normalised -> cosine similarity
    ranked = np.argsort(-sims, axis=1)[:, :k]
    return ranked


def rerank(reranker, query: str, candidate_idxs, texts: list[str]):
    """Re-score candidates jointly with the query; return reordered indices."""
    pairs = [[query, texts[i]] for i in candidate_idxs]
    scores = reranker.predict(pairs)
    order = sorted(range(len(candidate_idxs)), key=lambda j: -scores[j])
    return [candidate_idxs[j] for j in order]


def score(ranked_idx_per_query, paths, gold_queries):
    """Compute recall@k + MRR from ranked corpus indices per query."""
    hits = {k: 0 for k in RECALL_KS}
    mrr_sum = 0.0
    n = len(gold_queries)
    for ranks, gq in zip(ranked_idx_per_query, gold_queries):
        ranked_paths = [paths[i] for i in ranks]
        for k in RECALL_KS:
            if any(is_hit(p, gq["expectedFiles"]) for p in ranked_paths[:k]):
                hits[k] += 1
        first = next(
            (r for r, p in enumerate(ranked_paths) if is_hit(p, gq["expectedFiles"])),
            None,
        )
        if first is not None:
            mrr_sum += 1.0 / (first + 1)
    return {
        "recall": {k: hits[k] / n for k in RECALL_KS},
        "mrr": mrr_sum / n,
    }


# ---------------------------------------------------------------------------
# Driver.
# ---------------------------------------------------------------------------

def run_config(name, embed_model_name, texts, paths, queries, gold_queries,
               reranker=None):
    from sentence_transformers import SentenceTransformer

    print(f"\n=== config: {name} (embed={embed_model_name}"
          f"{', rerank=' + RERANKER_MODEL if reranker else ''}) ===", flush=True)
    model = SentenceTransformer(embed_model_name, trust_remote_code=True)
    corpus_emb = embed_corpus(model, texts)
    ranked = retrieve(model, corpus_emb, queries, RETRIEVE_K)

    if reranker is not None:
        reranked = []
        for qi, query in enumerate(queries):
            cands = list(ranked[qi][:RERANK_CANDIDATES])
            reranked.append(rerank(reranker, query, cands, texts))
        ranked_idx = reranked
    else:
        ranked_idx = [list(r) for r in ranked]

    metrics = score(ranked_idx, paths, gold_queries)
    metrics["name"] = name
    return metrics


def print_table(rows, meta):
    print("\n" + "=" * 72)
    print(f"Quarry — precision benchmark")
    print(f"corpus={meta['corpus']}  files={meta['files']}  chunks={meta['chunks']}"
          f"  queries={meta['queries']}")
    print("=" * 72)
    header = "config              | recall@1 | recall@3 | recall@5 |  MRR"
    print(header)
    print("-" * len(header))
    for r in rows:
        rec = r["recall"]
        print(f"{r['name']:<19} | "
              f"{rec[1] * 100:7.1f}% | {rec[3] * 100:7.1f}% | "
              f"{rec[5] * 100:7.1f}% | {r['mrr']:.3f}")
    print("-" * len(header))
    print("recall@k = fraction of queries with a relevant file in the top k;")
    print("MRR over top-{}. These are MEASURED, not claimed.".format(RETRIEVE_K))
    print("Target for the precision tier: recall@1 >= ~80%.")


def main() -> None:
    _ensure_deps()
    from sentence_transformers import CrossEncoder

    # Resolve corpus + gold set.
    if REPO_PATH and GOLDSET_PATH:
        repo = Path(REPO_PATH)
        gold = json.loads(Path(GOLDSET_PATH).read_text(encoding="utf-8"))
        corpus_name = gold.get("corpus", REPO_PATH)
    else:
        print("REPO_PATH/GOLDSET_PATH not set — using built-in synthetic smoke "
              "corpus.\n(These smoke-test numbers are not product results; see eval/COLAB.md.)")
        repo, gold = write_synthetic_corpus()
        corpus_name = gold.get("corpus", "synthetic")

    gold_queries = gold["queries"]
    queries = [q["query"] for q in gold_queries]

    texts, paths = collect_chunks(repo)
    if not texts:
        raise SystemExit(f"No indexable code files found under {repo}")
    print(f"Indexed {len(set(paths))} files into {len(texts)} chunks.")

    reranker = None
    if RUN_RERANK:
        print(f"Loading reranker {RERANKER_MODEL} (CPU-runnable)…", flush=True)
        reranker = CrossEncoder(RERANKER_MODEL)

    rows = []
    rows.append(run_config("baseline", BASELINE_MODEL, texts, paths,
                           queries, gold_queries))
    if RUN_RERANK:
        rows.append(run_config("baseline+rerank", BASELINE_MODEL, texts, paths,
                               queries, gold_queries, reranker=reranker))
    if RUN_CODE:
        rows.append(run_config("code", CODE_MODEL, texts, paths,
                               queries, gold_queries))
        if RUN_RERANK:
            rows.append(run_config("code+rerank", CODE_MODEL, texts, paths,
                                   queries, gold_queries, reranker=reranker))

    meta = {
        "corpus": corpus_name,
        "files": len(set(paths)),
        "chunks": len(texts),
        "queries": len(queries),
    }
    print_table(rows, meta)


if __name__ == "__main__":
    main()

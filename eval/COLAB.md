# Running the precision benchmark for free (Colab / Kaggle)

The laptop only ever runs the lean **core** tier. The **precision** tier
(code-specific embeddings + a cross-encoder reranker) is heavier, so we benchmark
it on a free, throwaway cloud GPU rather than straining a MacBook. It costs **£0**,
installs **nothing locally**, and the runtime is **ephemeral** — when you close the
tab it's gone.

`eval/precision_benchmark.py` is self-contained: it pip-installs its own deps,
indexes a code dir, retrieves, optionally reranks, and prints a comparison table
of **recall@1 / @3 / @5 + MRR** across configs.

## Option A — Google Colab (recommended)

1. Go to <https://colab.research.google.com> → **New notebook**.
2. **Enable the free GPU:** menu **Runtime → Change runtime type → Hardware
   accelerator → T4 GPU → Save**. (T4 has ~16 GB VRAM — plenty for the open
   code embedder and the 568M reranker.)
3. **Get the script in.** Either:
   - Upload it: left sidebar **Files → Upload** → choose `precision_benchmark.py`,
     **or**
   - Paste its contents into a code cell.
4. **Run it.**
   - If you uploaded the file, run in a cell:
     ```python
     !python precision_benchmark.py
     ```
   - If you pasted the contents into a cell, just run the cell.
5. **Read the table** printed at the end. Done.

The first run downloads the models and pip-installs `sentence-transformers`
(a couple of minutes); subsequent runs in the same session are fast.

### Smoke run vs real numbers

- **Out of the box** (no config), the script uses a tiny built-in **synthetic**
  corpus + gold set so the rig runs immediately and the table renders. Those
  numbers are directional only — don't quote them.
- **For representative measurements**, use a code repository and matching gold
  set you are authorized to process. Upload both to the runtime, then edit the
  CONFIG block at the top of `precision_benchmark.py`:
  ```python
  REPO_PATH    = "/content/your-repository"
  GOLDSET_PATH = "/content/your-goldset.json"
  ```
  Re-run. The table reflects only the corpus and gold set you supplied.
  Do not upload private source or evaluation data to a hosted notebook without
  permission.

## Option B — Kaggle Notebooks (alternative)

1. <https://www.kaggle.com/code> → **New Notebook**.
2. **Settings → Accelerator → GPU T4 x2** (free with a verified account).
3. Upload `precision_benchmark.py` as a notebook **Input**, or paste it into a
   cell.
4. Run `!python precision_benchmark.py` (uploaded inputs land under
   `/kaggle/input/...`; adjust the path or copy it to the working dir first).

Kaggle is a good fallback if Colab's free GPU is busy. Same $0, same ephemeral,
same nothing-installed-locally.

## What you're comparing

| config | embedder | reranker |
|---|---|---|
| `baseline` | all-MiniLM-L6-v2 (core ships this) | — |
| `baseline+rerank` | all-MiniLM-L6-v2 | bge-reranker-v2-m3 |
| `code` | open code embedder (jina code) | — |
| `code+rerank` | open code embedder | bge-reranker-v2-m3 |

Read the table top-to-bottom: each row isolates a precision lever so you can see
its gain. See `docs/EVAL-AND-PRECISION.md` for the levers, expected gains, and
our standing metrics + expectations.

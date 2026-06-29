/** Tiny fetch-with-retry helper. Zero dependencies; exponential backoff, no retry on 4xx. */
export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit = {},
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 400;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 400 && res.status < 500) {
        throw new Error(
          `HTTP ${res.status} for ${url} — ${await res.text().catch(() => "")}`.trim(),
        );
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      // Don't retry client errors (4xx) — they won't fix themselves.
      if (err instanceof Error && /HTTP 4\d\d/.test(err.message)) throw err;
      if (attempt < retries)
        await new Promise((r) => setTimeout(r, baseDelay * 2 ** attempt));
    }
  }
  throw lastErr;
}

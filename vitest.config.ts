import { defineConfig } from "vitest/config";

// `node:sqlite` is newer than this Vite version's built-in list, so Vite tries
// to bundle it and fails. Externalise it (both prefixed and bare forms) and run
// tests in forked Node processes with the experimental flag so the real builtin
// is used.
export default defineConfig({
  test: {
    // Only this repo's own suite. Without an explicit include, a git worktree
    // under .claude/worktrees is discovered too and every test runs twice.
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    // Multiple test files initialize the same cached Hugging Face ONNX model.
    // Running workers in parallel can observe a partially written model file.
    fileParallelism: false,
    // Vitest 4 flattened `poolOptions.forks.*` to top level.
    execArgv: ["--experimental-sqlite"],
    setupFiles: ["tests/setup-env.ts"],
    server: {
      deps: { external: ["node:sqlite", "sqlite", /sqlite-vec/] },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**"],
      exclude: [
        "dist/**",
        "build/**",
        "scripts/**",
        "tests/**",
        "**/*.config.*",
        "**/*.d.ts",
      ],
      // Ratchet: thresholds sit at/just below current measured coverage to stop
      // regression. Measured 2026-06-29: stmts 60.23 / branch 66.04 / funcs
      // 76.66 / lines 60.23. Bump these up as coverage improves; never down.
      //
      // Re-baselined 2026-08-29: CI was running `pnpm test` (no --coverage),
      // so this ratchet was defined but never actually enforced — coverage
      // quietly drifted down to stmts/lines 58.5 in the meantime (branch/funcs
      // held). Now that CI runs `pnpm coverage`, stmts/lines are lowered to
      // match reality so the gate passes honestly instead of being silently
      // skipped; branch/funcs are untouched since they still clear the old
      // bar. Treat 58.5 as the real floor to climb back from, not a target.
      //
      // Raised 2026-09-19 (Vitest 5). @vitest/coverage-v8 v5 remaps coverage
      // through the AST, so statements/branches/functions are now counted
      // properly instead of being approximated by lines — the same suite
      // measured 51.03 / 43.01 / 59.57 / 51.92 under the new counting. New
      // tests for config, ingest (http/github/jira), providers and
      // file-patterns took it to 66.35 / 68.38 / 78.72 / 66.12; the bars below
      // sit just under that. Never lower them.
      thresholds: {
        statements: 65,
        branches: 67,
        functions: 78,
        lines: 65,
      },
    },
  },
  ssr: {
    external: ["node:sqlite", "sqlite", "sqlite-vec"],
  },
});

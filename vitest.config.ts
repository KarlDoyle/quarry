import { defineConfig } from "vitest/config";

// `node:sqlite` is newer than this Vite version's built-in list, so Vite tries
// to bundle it and fails. Externalise it (both prefixed and bare forms) and run
// tests in forked Node processes with the experimental flag so the real builtin
// is used.
export default defineConfig({
  test: {
    pool: "forks",
    poolOptions: {
      forks: { execArgv: ["--experimental-sqlite"] },
    },
    server: {
      deps: { external: ["node:sqlite", "sqlite", /sqlite-vec/] },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**"],
      exclude: ["dist/**", "build/**", "scripts/**", "tests/**", "**/*.config.*", "**/*.d.ts"],
      // Ratchet: thresholds sit at/just below current measured coverage to stop
      // regression. Measured 2026-06-29: stmts 60.23 / branch 66.04 / funcs
      // 76.66 / lines 60.23. Bump these up as coverage improves; never down.
      thresholds: {
        statements: 60,
        branches: 66,
        functions: 76,
        lines: 60,
      },
    },
  },
  ssr: {
    external: ["node:sqlite", "sqlite", "sqlite-vec"],
  },
});

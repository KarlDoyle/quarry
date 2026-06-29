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
  },
  ssr: {
    external: ["node:sqlite", "sqlite", "sqlite-vec"],
  },
});

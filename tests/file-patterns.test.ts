import { describe, expect, it } from "vitest";
import {
  detectLanguage,
  FILE_PATTERNS,
  getAllExtensions,
  getSpecialFiles,
  shouldIndexFile,
  supportsASTParsing,
} from "../src/indexer/file-patterns.js";

/**
 * The indexer's front gate: what gets read, what gets skipped, and what language
 * a file is tagged with. Worth pinning — a mistake here silently indexes a lock
 * file or silently drops a whole language, and neither shows up as a failure.
 */
describe("getAllExtensions / getSpecialFiles", () => {
  it("flattens every language's extensions into one list", () => {
    const all = getAllExtensions();
    expect(all).toContain(".ts");
    expect(all).toContain(".py");
    expect(all).toContain(".go");
    expect(all.length).toBe(
      Object.values(FILE_PATTERNS.extensions).flat().length,
    );
  });

  it("lists the extension-less files worth indexing", () => {
    expect(getSpecialFiles()).toContain("Dockerfile");
    expect(getSpecialFiles()).toContain("Makefile");
  });
});

describe("shouldIndexFile", () => {
  it("indexes source files in supported languages", () => {
    for (const name of ["app.ts", "main.go", "svc.py", "Cargo.toml"]) {
      expect(shouldIndexFile(name), name).toBe(true);
    }
  });

  it("indexes extension-less special files", () => {
    expect(shouldIndexFile("Dockerfile")).toBe(true);
    expect(shouldIndexFile("Makefile")).toBe(true);
  });

  it("skips unsupported extensions and extension-less non-special files", () => {
    expect(shouldIndexFile("photo.png")).toBe(false);
    expect(shouldIndexFile("LICENCE")).toBe(false);
  });

  it("skips lock files and secrets even though the extension is supported", () => {
    expect(shouldIndexFile("package-lock.json")).toBe(false);
    expect(shouldIndexFile("pnpm-lock.yaml")).toBe(false);
    expect(shouldIndexFile("credentials.json")).toBe(false);
  });

  it("skips generated and derived files by pattern", () => {
    expect(shouldIndexFile("vendor.min.js")).toBe(false);
    expect(shouldIndexFile("app.bundle.js")).toBe(false);
    expect(shouldIndexFile("types.d.ts")).toBe(false);
    expect(shouldIndexFile("bundle.js.map")).toBe(false);
  });
});

describe("supportsASTParsing", () => {
  it("is true for the tree-sitter languages and false otherwise", () => {
    expect(supportsASTParsing("a.ts")).toBe(true);
    expect(supportsASTParsing("a.py")).toBe(true);
    expect(supportsASTParsing("a.rs")).toBe(true);
    expect(supportsASTParsing("a.yaml")).toBe(false);
    expect(supportsASTParsing("Dockerfile")).toBe(false);
  });
});

describe("detectLanguage", () => {
  it("maps an extension to its language group", () => {
    expect(detectLanguage("a.ts")).toBe("typescript");
    expect(detectLanguage("a.jsx")).toBe("javascript");
    expect(detectLanguage("a.rb")).toBe("ruby");
    expect(detectLanguage("a.yml")).toBe("config");
  });

  it("special-cases the extension-less build files", () => {
    expect(detectLanguage("Dockerfile")).toBe("docker");
    expect(detectLanguage("Makefile")).toBe("make");
    expect(detectLanguage("Rakefile")).toBe("ruby");
  });

  it("returns unknown for anything it does not recognise", () => {
    expect(detectLanguage("photo.png")).toBe("unknown");
    expect(detectLanguage("LICENCE")).toBe("unknown");
  });
});

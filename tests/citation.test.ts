import { describe, expect, it } from "vitest";
import { ASTParser } from "../src/indexer/ast-parser.js";
import { createSmartChunks } from "../src/indexer/chunking-strategies.js";
import { findEnclosingEntity } from "../src/indexer/index.js";

/**
 * Guards the flagship correctness fix: citations (entityName + startLine/endLine)
 * must be substantiated by the source, and absent when they can't be.
 */
describe("chunker reports real positions", () => {
  it("returns 1-based start/end lines derived from real offsets", () => {
    // 4 short lines, then a long body to force multiple chunks.
    const header = "line1\nline2\nline3\nline4\n";
    const body = "x".repeat(2000);
    const content = header + body;
    const chunks = createSmartChunks(content, "typescript");

    expect(chunks.length).toBeGreaterThan(1);
    // First chunk starts at line 1.
    expect(chunks[0].startLine).toBe(1);
    // Every chunk's lines fall within the file and are ordered.
    const totalLines = content.split("\n").length;
    for (const c of chunks) {
      expect(c.startLine).toBeGreaterThanOrEqual(1);
      expect(c.endLine).toBeGreaterThanOrEqual(c.startLine);
      expect(c.endLine).toBeLessThanOrEqual(totalLines);
    }
  });

  it("treats a small file as one chunk spanning the whole file", () => {
    const content = "const a = 1;\nconst b = 2;\nconst c = 3;";
    const chunks = createSmartChunks(content, "typescript");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(3);
  });
});

describe("AST parser measures real entity spans", () => {
  it("computes the closing-brace end line, not a fixed guess", async () => {
    const src = [
      "function alpha() {", // line 1
      "  const x = 1;", //      line 2
      "  return x;", //         line 3
      "}", //                   line 4
      "", //                    line 5
      "function beta() {", //   line 6
      "  return 2;", //         line 7
      "}", //                   line 8
    ].join("\n");
    const parser = new ASTParser();
    // parseFile reads from disk; exercise the regex extractor via a temp file.
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "rag-ast-"));
    const file = join(dir, "sample.ts");
    writeFileSync(file, src);
    try {
      const entities = await parser.parseFile(file);
      const alpha = entities.find((e) => e.name === "alpha");
      const beta = entities.find((e) => e.name === "beta");
      expect(alpha).toMatchObject({ startLine: 1, endLine: 4 });
      expect(beta).toMatchObject({ startLine: 6, endLine: 8 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("findEnclosingEntity", () => {
  const entities = [
    {
      type: "class" as const,
      name: "Outer",
      startLine: 1,
      endLine: 20,
      content: "class Outer",
    },
    {
      type: "function" as const,
      name: "inner",
      startLine: 5,
      endLine: 10,
      content: "function inner",
    },
  ];

  it("picks the smallest enclosing entity (method over class)", () => {
    expect(findEnclosingEntity(entities, 7)?.name).toBe("inner");
  });

  it("falls back to the only enclosing entity", () => {
    expect(findEnclosingEntity(entities, 2)?.name).toBe("Outer");
  });

  it("returns undefined when nothing encloses the chunk", () => {
    expect(findEnclosingEntity(entities, 50)).toBeUndefined();
  });
});

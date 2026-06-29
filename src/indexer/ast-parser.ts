import * as fs from "node:fs/promises";
import { createLogger } from "../logger.js";

const logger = createLogger("ASTParser");

export interface CodeEntity {
  type: "function" | "class" | "method" | "export" | "import";
  name: string;
  startLine: number;
  endLine: number;
  content: string;
  docstring?: string;
}

/**
 * Lightweight, zero-native-dependency entity extractor for JS/TS-family files.
 * Regex-based on purpose: keeps the tool installable on any machine with no
 * tree-sitter native grammars to compile. Good enough to tag chunks with the
 * nearest function/class/export name for retrieval context.
 */
export class ASTParser {
  async parseFile(filePath: string): Promise<CodeEntity[]> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const entities = this.extractEntitiesRegex(content);
      logger.debug(`Parsed ${filePath}`, { entityCount: entities.length });
      return entities;
    } catch (error) {
      logger.error(`Failed to parse ${filePath}`, error);
      return [];
    }
  }

  /** 1-based line number of the character at `index`. */
  private lineAt(content: string, index: number): number {
    let line = 1;
    for (let i = 0; i < index && i < content.length; i++) {
      if (content[i] === "\n") line++;
    }
    return line;
  }

  /**
   * Find the index of the `}` that closes the first `{` at/after `fromIndex`,
   * balancing nested braces while skipping over strings and comments so braces
   * inside them don't throw off the count. Returns `null` when the entity has no
   * block (a `;` is reached first — e.g. `export const X = 5;`) or the braces
   * never balance. We never guess an end line: callers fall back to a
   * single-line span rather than fabricate a length.
   */
  private findBlockEndIndex(content: string, fromIndex: number): number | null {
    const n = content.length;
    let i = fromIndex;
    let depth = 0;
    let opened = false;
    while (i < n) {
      const ch = content[i];
      // Line comment
      if (ch === "/" && content[i + 1] === "/") {
        const nl = content.indexOf("\n", i + 2);
        if (nl === -1) return null;
        i = nl + 1;
        continue;
      }
      // Block comment
      if (ch === "/" && content[i + 1] === "*") {
        const close = content.indexOf("*/", i + 2);
        if (close === -1) return null;
        i = close + 2;
        continue;
      }
      // String / template literal — skip the whole thing (braces inside don't count)
      if (ch === '"' || ch === "'" || ch === "`") {
        const after = this.skipString(content, i, ch);
        if (after === -1) return null;
        i = after;
        continue;
      }
      if (ch === "{") {
        depth++;
        opened = true;
      } else if (ch === "}") {
        depth--;
        if (opened && depth === 0) return i;
      } else if (ch === ";" && !opened) {
        // Statement ends before any block: no enclosing body to measure.
        return null;
      }
      i++;
    }
    return null;
  }

  /** Index just past the closing quote of the string starting at `i`, or -1. */
  private skipString(content: string, i: number, quote: string): number {
    let j = i + 1;
    while (j < content.length) {
      const c = content[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === quote) return j + 1;
      j++;
    }
    return -1;
  }

  private extractEntitiesRegex(content: string): CodeEntity[] {
    const rules: Array<{
      regex: RegExp;
      type: CodeEntity["type"];
      nameGroup: number;
    }> = [
      {
        // Leading [ \t]* (not \s*) so indentation is allowed without the match
        // swallowing a preceding blank line — which would skew the start line.
        regex: /^[ \t]*(async\s+)?function\s+(\w+)/gm,
        type: "function",
        nameGroup: 2,
      },
      {
        regex: /const\s+(\w+)\s*=\s*(async\s*)?\(/gm,
        type: "function",
        nameGroup: 1,
      },
      { regex: /class\s+(\w+)/gm, type: "class", nameGroup: 1 },
      {
        regex: /export\s+(const|function|class)\s+(\w+)/gm,
        type: "export",
        nameGroup: 2,
      },
    ];

    const entities: CodeEntity[] = [];
    for (const { regex, type, nameGroup } of rules) {
      for (const match of content.matchAll(regex)) {
        const index = match.index ?? 0;
        const startLine = this.lineAt(content, index);
        // Measure the real span by brace-matching; if there's no block we can
        // trust, the entity is just its declaration line (never an invented one).
        const endIndex = this.findBlockEndIndex(content, index);
        const endLine =
          endIndex === null ? startLine : this.lineAt(content, endIndex);
        entities.push({
          type,
          name: match[nameGroup],
          startLine,
          endLine,
          content: match[0],
        });
      }
    }
    return entities;
  }
}

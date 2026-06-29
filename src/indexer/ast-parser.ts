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

  private lineAt(content: string, index: number): number {
    return content.substring(0, index).split("\n").length - 1;
  }

  private extractEntitiesRegex(content: string): CodeEntity[] {
    const rules: Array<{
      regex: RegExp;
      type: CodeEntity["type"];
      nameGroup: number;
      lineSpan: number;
    }> = [
      {
        regex: /^\s*(async\s+)?function\s+(\w+)/gm,
        type: "function",
        nameGroup: 2,
        lineSpan: 10,
      },
      {
        regex: /const\s+(\w+)\s*=\s*(async\s*)?\(/gm,
        type: "function",
        nameGroup: 1,
        lineSpan: 10,
      },
      { regex: /class\s+(\w+)/gm, type: "class", nameGroup: 1, lineSpan: 20 },
      {
        regex: /export\s+(const|function|class)\s+(\w+)/gm,
        type: "export",
        nameGroup: 2,
        lineSpan: 5,
      },
    ];

    const entities: CodeEntity[] = [];
    for (const { regex, type, nameGroup, lineSpan } of rules) {
      for (const match of content.matchAll(regex)) {
        const startLine = this.lineAt(content, match.index ?? 0);
        entities.push({
          type,
          name: match[nameGroup],
          startLine,
          endLine: startLine + lineSpan,
          content: match[0],
        });
      }
    }
    return entities;
  }
}

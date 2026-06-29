/**
 * Language-specific chunking strategies
 * Different languages have different ideal chunk sizes and patterns
 */

export interface ChunkingStrategy {
  maxSize: number;
  overlap: number;
  preferredBreakpoints: string[]; // Characters/patterns to prefer for breaking
}

/**
 * A chunk plus its REAL position in the source file. `startLine`/`endLine` are
 * 1-based and computed directly from the chunk's character offsets, so they are
 * always substantiated by the file (never fabricated). These positions are what
 * lets the indexer attribute a chunk to the entity that actually encloses it.
 */
export interface Chunk {
  content: string;
  startLine: number;
  endLine: number;
}

/** 1-based line number of the character at `offset`. */
function lineAtOffset(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

/**
 * Get chunking strategy for a specific language
 */
export function getChunkingStrategy(language: string): ChunkingStrategy {
  const strategies: Record<string, ChunkingStrategy> = {
    // JavaScript/TypeScript: Medium chunks, break on function boundaries
    javascript: {
      maxSize: 600,
      overlap: 100,
      preferredBreakpoints: ["\n}\n", "\n};\n", "\n\n"],
    },
    typescript: {
      maxSize: 600,
      overlap: 100,
      preferredBreakpoints: ["\n}\n", "\n};\n", "\n\n"],
    },
    tsx: {
      maxSize: 700, // React components can be longer
      overlap: 120,
      preferredBreakpoints: ["\n}\n", "\n};\n", "\n</"],
    },

    // Python: Larger chunks due to less verbose syntax
    python: {
      maxSize: 800,
      overlap: 150,
      preferredBreakpoints: ["\n\ndef ", "\n\nclass ", "\n\n"],
    },

    // Java: Smaller chunks due to verbose syntax
    java: {
      maxSize: 500,
      overlap: 80,
      preferredBreakpoints: ["\n    }\n", "\n}\n", "\n\n"],
    },

    // Go: Medium chunks, break on function boundaries
    go: {
      maxSize: 600,
      overlap: 100,
      preferredBreakpoints: ["\n}\n", "\nfunc ", "\n\n"],
    },

    // Rust: Medium-large chunks, break on impl/function boundaries
    rust: {
      maxSize: 650,
      overlap: 110,
      preferredBreakpoints: ["\n}\n", "\nimpl ", "\nfn ", "\n\n"],
    },

    // Ruby: Medium chunks
    ruby: {
      maxSize: 600,
      overlap: 100,
      preferredBreakpoints: ["\nend\n", "\n\ndef ", "\n\n"],
    },

    // PHP: Medium chunks
    php: {
      maxSize: 550,
      overlap: 90,
      preferredBreakpoints: ["\n}\n", "\nfunction ", "\n\n"],
    },

    // SQL: Larger chunks to keep queries together
    sql: {
      maxSize: 1000,
      overlap: 150,
      preferredBreakpoints: [";", "\n\n"],
    },

    // Shell scripts: Medium chunks
    shell: {
      maxSize: 600,
      overlap: 100,
      preferredBreakpoints: ["\n}\n", "\nfunction ", "\n\n"],
    },

    // Config files: Larger chunks to keep related config together
    config: {
      maxSize: 800,
      overlap: 100,
      preferredBreakpoints: ["\n\n", "\n  - ", "\n---"],
    },

    // C/C++: Medium chunks
    c: {
      maxSize: 600,
      overlap: 100,
      preferredBreakpoints: ["\n}\n", "\n\n"],
    },
    cpp: {
      maxSize: 600,
      overlap: 100,
      preferredBreakpoints: ["\n}\n", "\n\n"],
    },
    csharp: {
      maxSize: 550,
      overlap: 90,
      preferredBreakpoints: ["\n    }\n", "\n}\n", "\n\n"],
    },
  };

  // Default strategy for unknown languages
  const defaultStrategy: ChunkingStrategy = {
    maxSize: 500,
    overlap: 100,
    preferredBreakpoints: ["\n\n", "\n"],
  };

  return strategies[language] || defaultStrategy;
}

/**
 * Create smart chunks using language-specific strategies
 * Attempts to break at natural boundaries (functions, classes) rather than arbitrary character counts
 */
export function createSmartChunks(content: string, language: string): Chunk[] {
  const strategy = getChunkingStrategy(language);
  const chunks: Chunk[] = [];

  // Handle empty content
  if (!content || content.length === 0) {
    return chunks;
  }

  // If content is smaller than maxSize, return it as a single chunk
  if (content.length <= strategy.maxSize) {
    return [
      { content, startLine: 1, endLine: lineAtOffset(content, content.length) },
    ];
  }

  let start = 0;

  while (start < content.length) {
    let end = Math.min(start + strategy.maxSize, content.length);

    // Try to find a good break point within the preferred range
    if (end < content.length) {
      const searchStart = Math.max(start, end - 100); // Look back up to 100 chars
      let bestBreakpoint = end;
      let bestBreakpointScore = -1;

      // Try each preferred breakpoint pattern
      for (const breakpoint of strategy.preferredBreakpoints) {
        const searchRegion = content.substring(searchStart, end + 50);
        const index = searchRegion.lastIndexOf(breakpoint);

        if (index !== -1) {
          const actualIndex = searchStart + index + breakpoint.length;
          // Score this breakpoint (prefer ones closer to the ideal end point)
          const distanceFromIdeal = Math.abs(actualIndex - end);
          const score = 1000 - distanceFromIdeal; // Higher score = better

          if (score > bestBreakpointScore) {
            bestBreakpointScore = score;
            bestBreakpoint = actualIndex;
          }
        }
      }

      // Use the best breakpoint found, or fall back to maxSize
      end = bestBreakpoint;
    }

    // Extract the chunk
    const chunk = content.substring(start, end);
    if (chunk.trim().length > 0) {
      // Only add non-empty chunks. Lines are derived from the real offsets:
      // startLine is the line of the first character; endLine accounts for any
      // newlines inside the chunk body.
      chunks.push({
        content: chunk,
        startLine: lineAtOffset(content, start),
        endLine: lineAtOffset(content, end - 1),
      });
    }

    // Move to next chunk position with overlap
    start = end - strategy.overlap;

    // Ensure we make progress
    if (start >= end) {
      start = end;
    }

    // Break if we've covered the entire content
    if (end >= content.length) {
      break;
    }
  }

  return chunks;
}

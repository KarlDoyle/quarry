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
export function createSmartChunks(content: string, language: string): string[] {
  const strategy = getChunkingStrategy(language);
  const chunks: string[] = [];

  // Handle empty content
  if (!content || content.length === 0) {
    return chunks;
  }

  // If content is smaller than maxSize, return it as a single chunk
  if (content.length <= strategy.maxSize) {
    return [content];
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
      // Only add non-empty chunks
      chunks.push(chunk);
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

/**
 * Calculate optimal chunk size based on content type and language
 */
export function calculateOptimalChunkSize(
  language: string,
  hasEntities: boolean,
  contentLength: number,
): number {
  const strategy = getChunkingStrategy(language);

  // If content has parsed entities, we can use larger chunks since we have structure
  if (hasEntities && contentLength > strategy.maxSize * 2) {
    return Math.floor(strategy.maxSize * 1.3);
  }

  // For short files, use smaller chunks
  if (contentLength < strategy.maxSize) {
    return contentLength;
  }

  return strategy.maxSize;
}

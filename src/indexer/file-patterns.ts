/**
 * File patterns and exclusions for repository indexing
 * Configurable patterns for multi-language support
 */

export const FILE_PATTERNS = {
  /**
   * Supported file extensions organized by language
   */
  extensions: {
    // JavaScript/TypeScript ecosystem
    javascript: [".js", ".jsx", ".mjs", ".cjs"],
    typescript: [".ts", ".tsx"],

    // Java/JVM ecosystem
    java: [".java"],
    kotlin: [".kt", ".kts"],
    scala: [".scala"],
    groovy: [".groovy"],

    // Python ecosystem
    python: [".py", ".pyw"],
    jupyter: [".ipynb"],

    // Database/Query languages
    sql: [".sql", ".psql", ".mysql", ".pgsql"],

    // C/C++/C# family
    c: [".c", ".h"],
    cpp: [".cpp", ".cc", ".cxx", ".hpp", ".hxx"],
    csharp: [".cs"],

    // Go
    go: [".go"],

    // Rust
    rust: [".rs"],

    // Ruby
    ruby: [".rb", ".rake"],

    // PHP
    php: [".php"],

    // Shell scripting
    shell: [".sh", ".bash", ".zsh", ".fish"],

    // Build/Config files (selective)
    config: [
      ".yaml",
      ".yml", // Kubernetes, Docker Compose, GitHub Actions
      ".json", // Package manifests, configs (excluding lock files)
      ".toml", // Rust, Python configs
      ".xml", // Maven, Spring configs
      ".gradle", // Gradle build files
      ".properties", // Java properties
    ],

    // Special files (no extension)
    special: [
      "Dockerfile",
      "Makefile",
      "Rakefile",
      "Vagrantfile",
      "Jenkinsfile",
      "Procfile",
    ],
  },

  /**
   * Directories to skip during indexing
   */
  skipDirs: [
    // Package managers / Dependencies
    "node_modules",
    "vendor",
    ".pnpm-store",
    "bower_components",
    "jspm_packages",

    // Build outputs
    "dist",
    "build",
    "out",
    "target", // Java/Maven
    "bin", // General binaries
    ".next", // Next.js
    ".nuxt", // Nuxt
    ".output", // Nuxt 3
    ".svelte-kit", // SvelteKit

    // Test coverage
    "coverage",
    ".nyc_output",
    "htmlcov", // Python coverage

    // Version control
    ".git",
    ".svn",
    ".hg",
    ".bzr",

    // IDE/Editor directories
    ".vscode",
    ".idea",
    ".vs",
    ".eclipse",
    ".settings",

    // OS files
    ".DS_Store",
    "Thumbs.db",

    // Caches and temporary files
    ".cache",
    ".temp",
    ".tmp",
    "__pycache__", // Python
    ".pytest_cache", // Python pytest
    ".gradle", // Gradle cache
    ".m2", // Maven cache
    ".ivy2", // Ivy cache
    ".sbt", // SBT cache

    // Build tools
    ".turbo", // Turborepo
    ".parcel-cache", // Parcel bundler
    ".webpack", // Webpack cache

    // Documentation builds
    "_site", // Jekyll
    ".docusaurus", // Docusaurus
    "site", // MkDocs

    // Logs
    "logs",
    "log",
  ],

  /**
   * Specific files to skip (by exact name)
   */
  skipFiles: [
    // Environment and secrets
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".env.test",
    "credentials.json",
    "secrets.json",
    "secret.yaml",

    // Lock files (too large, not useful for analysis)
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "poetry.lock",
    "Pipfile.lock",
    "Gemfile.lock",
    "Cargo.lock",
    "composer.lock",
    "go.sum",

    // IDE/Editor config (not source code)
    ".editorconfig",
    ".prettierignore",
    ".eslintignore",
    ".gitignore",
    ".dockerignore",

    // Generated files
    "bundle.js",
    "bundle.min.js",
    "vendors.js",
  ],

  /**
   * File patterns to skip (regex)
   */
  skipPatterns: [
    /\.min\.js$/, // Minified JavaScript
    /\.min\.css$/, // Minified CSS
    /\.bundle\.js$/, // Bundled files
    /\.chunk\.js$/, // Webpack chunks
    /\.map$/, // Source maps
    /\.d\.ts$/, // TypeScript declarations (optional - can include)
    /^\..*\.swp$/, // Vim swap files
    /~$/, // Backup files
    /\.bak$/, // Backup files
    /\.orig$/, // Merge conflict files
    /\.log$/, // Log files
  ],

  /**
   * Languages that support AST parsing (tree-sitter available)
   */
  astSupportedExtensions: [
    ".js",
    ".jsx",
    ".mjs",
    ".cjs", // JavaScript
    ".ts",
    ".tsx", // TypeScript
    ".py",
    ".pyw", // Python
    ".java", // Java
    ".go", // Go
    ".rs", // Rust
  ],
};

/**
 * Get all supported file extensions as a flat array
 */
export function getAllExtensions(): string[] {
  return Object.values(FILE_PATTERNS.extensions).flat();
}

/**
 * Get all special files (without extensions)
 */
export function getSpecialFiles(): string[] {
  return FILE_PATTERNS.extensions.special;
}

/**
 * Check if a file should be indexed based on extension
 */
export function shouldIndexFile(filename: string): boolean {
  const allExtensions = getAllExtensions();
  const specialFiles = getSpecialFiles();
  const ext = filename.substring(filename.lastIndexOf("."));

  // Check if it's a special file (no extension)
  if (specialFiles.includes(filename)) {
    return true;
  }

  // Check extension
  if (allExtensions.includes(ext)) {
    // Check against skip patterns
    const shouldSkip =
      FILE_PATTERNS.skipFiles.includes(filename) ||
      FILE_PATTERNS.skipPatterns.some((pattern) => pattern.test(filename));
    return !shouldSkip;
  }

  return false;
}

/**
 * Check if AST parsing is supported for this file
 */
export function supportsASTParsing(filename: string): boolean {
  const ext = filename.substring(filename.lastIndexOf("."));
  return FILE_PATTERNS.astSupportedExtensions.includes(ext);
}

/**
 * Detect language from file extension
 */
export function detectLanguage(filename: string): string {
  const ext = filename.substring(filename.lastIndexOf("."));
  const specialFiles = getSpecialFiles();

  // Check special files first
  if (specialFiles.includes(filename)) {
    if (filename === "Dockerfile") return "docker";
    if (filename === "Makefile") return "make";
    if (filename.endsWith("file")) return "ruby";
    return "config";
  }

  // Check extensions
  for (const [lang, extensions] of Object.entries(FILE_PATTERNS.extensions)) {
    if (extensions.includes(ext)) {
      return lang;
    }
  }

  return "unknown";
}

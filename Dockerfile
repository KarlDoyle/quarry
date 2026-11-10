# Shared Node 26 (glibc) environment for build, tests, and runtime.
# Git is needed by the CLI when indexing a remote repository.
FROM node:26-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Corepack is no longer bundled with Node 26. Keep this pin aligned with
# package.json's packageManager. Git hooks apply only to a development checkout.
RUN npm install --global pnpm@11.5.2 \
    && npm pkg delete scripts.prepare

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.json biome.json ./
COPY src ./src
RUN pnpm build

# CI exercises the actual container runtime and native dependencies.
FROM build AS test
COPY vitest.config.ts ./
COPY tests ./tests
COPY examples ./examples
RUN pnpm coverage

FROM base AS runtime
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY examples ./examples
# `analyze` reaches a host/sidecar Ollama; index + search need no LLM service.
ENV OLLAMA_HOST=http://host.docker.internal:11434
ENTRYPOINT ["node", "--experimental-sqlite", "dist/cli.js"]
CMD ["--help"]

# Reproducible run environment for reviewers — runs on any OCI runtime
# (OrbStack, Colima, Podman, Docker). node:24-slim (glibc) so transformers.js +
# its native bits work without alpine/musl pain. node:sqlite needs no compile.
FROM node:26-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json biome.json ./
COPY src ./src
RUN pnpm build

FROM node:26-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY examples ./examples
# `analyze` reaches a host/sidecar Ollama; index + search are fully self-contained.
ENV OLLAMA_HOST=http://host.docker.internal:11434
ENTRYPOINT ["node", "--experimental-sqlite", "dist/cli.js"]
CMD ["--help"]

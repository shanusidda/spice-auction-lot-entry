# Spice Config — Railway Dockerfile
# Force linux/amd64 platform for both build AND runtime stages so
# better-sqlite3's compiled .node binary matches the runtime arch.

# syntax=docker/dockerfile:1
FROM --platform=linux/amd64 node:20-bookworm-slim AS builder

# Native build deps for better-sqlite3 + 'file' command for diagnostic ELF inspection
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    file \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Print arch info for diagnostic — visible in Railway build logs
RUN echo "=== BUILD STAGE ===" \
    && echo "uname: $(uname -m)" \
    && echo "node arch: $(node -p 'process.arch')" \
    && echo "node platform: $(node -p 'process.platform')" \
    && echo "node version: $(node -v)"

# Copy ONLY package.json — avoids any cached arch-specific
# entries from a committed package-lock.json
COPY package.json ./

# Force native build, skip prebuild downloads.
ENV npm_config_build_from_source=true
ENV npm_config_loglevel=info
RUN npm install --omit=dev --build-from-source --foreground-scripts

# Print info about the compiled binary so we can verify in build logs
RUN echo "=== COMPILED BINARY INFO ===" \
    && ls -la node_modules/better-sqlite3/build/Release/ \
    && file node_modules/better-sqlite3/build/Release/better_sqlite3.node

# Verify it loads in the build container
RUN node -e "require('better-sqlite3')(':memory:').exec('SELECT 1'); console.log('build stage: better-sqlite3 OK')"

# Copy app source
COPY . .

# Strip stuff that shouldn't be in the runtime image
RUN rm -rf data/ electron/ *.zip BUILD.md RELEASE.md MIGRATION.md \
    && rm -f recover-isp.js

# ────────────────────────────────────────────
# Runtime stage — same platform, fresh slim image
# Note: 'file' command also installed here so the diagnostic RUN below works.
# In a future cleanup pass once we confirm the build works, we can drop it.
# ────────────────────────────────────────────
FROM --platform=linux/amd64 node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends file \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the built app (including compiled node_modules)
COPY --from=builder /app /app

# Diagnostic: confirm runtime is the same arch as build
RUN echo "=== RUNTIME STAGE ===" \
    && echo "uname: $(uname -m)" \
    && echo "node arch: $(node -p 'process.arch')" \
    && file node_modules/better-sqlite3/build/Release/better_sqlite3.node

EXPOSE 3001

# Sanity check at runtime — fails the build if the binary doesn't load
RUN node -e "require('better-sqlite3')(':memory:').exec('SELECT 1'); console.log('runtime check passed')"

CMD ["node", "server.js"]

# Spice Config — Railway Dockerfile
# Force linux/amd64 platform for both build AND runtime stages so
# better-sqlite3's compiled .node binary matches the runtime arch.
# (Without --platform, Railway may build on ARM but run on x64 → ELF mismatch.)

# syntax=docker/dockerfile:1
FROM --platform=linux/amd64 node:20-bookworm-slim AS builder

# Native build deps for better-sqlite3 (and any other gyp-based modules)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Print arch info for diagnostic — visible in Railway build logs
RUN echo "═══ BUILD STAGE ═══" \
    && echo "uname: $(uname -m)" \
    && echo "node arch: $(node -p 'process.arch')" \
    && echo "node platform: $(node -p 'process.platform')" \
    && echo "node version: $(node -v)"

# Copy ONLY package.json — avoids any cached arch-specific
# entries from a committed package-lock.json
COPY package.json ./

# CRITICAL: force native build, skip prebuild downloads.
# Multiple flags layered for safety:
#   - npm_config_build_from_source=true    npm-level
#   - --build-from-source                  CLI override
#   - --foreground-scripts                 don't suppress build output
ENV npm_config_build_from_source=true
ENV npm_config_loglevel=info
RUN npm install --omit=dev --build-from-source --foreground-scripts

# Print info about the compiled binary so we can verify in build logs
RUN echo "═══ COMPILED BINARY INFO ═══" \
    && ls -la node_modules/better-sqlite3/build/Release/ \
    && file node_modules/better-sqlite3/build/Release/better_sqlite3.node

# Verify it loads in the build container
RUN node -e "require('better-sqlite3')(':memory:').exec('SELECT 1'); console.log('✓ build stage: better-sqlite3 OK')"

# Copy app source
COPY . .

# Strip stuff that shouldn't be in the runtime image
RUN rm -rf data/ electron/ *.zip BUILD.md RELEASE.md MIGRATION.md \
    && rm -f recover-isp.js

# ────────────────────────────────────────────
# Runtime stage — same platform, fresh slim image
# ────────────────────────────────────────────
FROM --platform=linux/amd64 node:20-bookworm-slim

WORKDIR /app

# Copy the built app
COPY --from=builder /app /app

# Diagnostic: confirm runtime is the same arch as build
RUN echo "═══ RUNTIME STAGE ═══" \
    && echo "uname: $(uname -m)" \
    && echo "node arch: $(node -p 'process.arch')" \
    && file node_modules/better-sqlite3/build/Release/better_sqlite3.node

EXPOSE 3001

# Sanity check at runtime — fails the build if the binary doesn't load
RUN node -e "require('better-sqlite3')(':memory:').exec('SELECT 1'); console.log('✓ runtime check passed')"

CMD ["node", "server.js"]

# Spice Config — Railway Dockerfile
# Uses node:20-bookworm-slim (Linux x64 / glibc) to match Railway's runtime.
# Forces better-sqlite3 to compile from source so we can't get an
# arch-mismatched prebuilt binary smuggled in.

FROM node:20-bookworm-slim AS builder

# Native build deps for better-sqlite3 (and any other gyp-based modules)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy ONLY package.json so npm install sees a clean dep tree
# (deliberately not copying package-lock.json — avoids any cached
# arch-specific entries that may have been committed accidentally)
COPY package.json ./

# Install with build-from-source so the .node binary targets THIS image's
# arch + libc, not whatever shipped as a prebuild.
ENV npm_config_build_from_source=true
RUN npm install --omit=dev --build-from-source

# Verify the native module loads inside the build container
RUN node -e "require('better-sqlite3')(':memory:').exec('SELECT 1'); console.log('✓ better-sqlite3 loads OK')"

# Copy app source AFTER deps so Docker caches deps separately
COPY . .

# Strip dev/test/build artifacts that might have been included
RUN rm -rf data/ electron/ *.zip BUILD.md RELEASE.md MIGRATION.md \
    && rm -f recover-isp.js

# ────────────────────────────────────────────
# Runtime stage — slim image, no build tools
# ────────────────────────────────────────────
FROM node:20-bookworm-slim

WORKDIR /app

# Copy the built app + node_modules from the builder stage.
# IMPORTANT: this preserves the freshly-compiled .node binary.
COPY --from=builder /app /app

# Railway sets PORT automatically; expose for documentation
EXPOSE 3001

# Final sanity check: native module still loads at runtime
RUN node -e "require('better-sqlite3')(':memory:').exec('SELECT 1'); console.log('✓ runtime check passed')"

CMD ["node", "server.js"]

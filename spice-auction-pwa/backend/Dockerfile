FROM node:18-alpine

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json ./
RUN npm install --production

# Copy app files
COPY server.js db.js export.js ./
COPY import-source.js* ./
COPY public/ ./public/

# Create data directory for SQLite DB and backups
RUN mkdir -p /app/data/backups /app/data/uploads

# Railway sets PORT automatically
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]

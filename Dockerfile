# Multi-stage build with cache-busting
FROM node:20-alpine AS build

# Cache-bust ARG - passed at build time to invalidate layer cache
ARG CACHE_BUST=default

WORKDIR /app

# Copy package files first (cacheable layer)
COPY package*.json ./
RUN npm ci --include=dev --no-fund --no-audit

# Copy source and build (invalidated by CACHE_BUST)
COPY . .
RUN echo "Cache bust: ${CACHE_BUST}" && npm run build

# Runtime stage
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Copy built artifacts from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev --no-fund --no-audit

ENV PORT=8080
EXPOSE 8080
CMD ["node","dist/index.js"]

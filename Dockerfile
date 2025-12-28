# Multi-stage build with cache-busting
FROM node:20-alpine AS build

# Cache-bust ARG - passed at build time to invalidate layer cache
ARG CACHE_BUST=default

WORKDIR /app

# Install build dependencies for native modules (usb package needs python/make/g++)
RUN apk add --no-cache python3 make g++ linux-headers eudev-dev

# Copy package files first (cacheable layer)
COPY package*.json ./
RUN npm install --legacy-peer-deps --no-fund --no-audit

# Copy source and build (invalidated by CACHE_BUST)
COPY . .
RUN echo "Cache bust: ${CACHE_BUST}" && npm run build

# Runtime stage
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Install build dependencies for native modules (usb package needs python/make/g++)
# Also install Chromium and dependencies for Playwright browser automation
RUN apk add --no-cache python3 make g++ linux-headers eudev-dev \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Configure Playwright to use system Chromium instead of downloading its own
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/bin
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy built artifacts from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./

# Install production dependencies only
RUN npm install --legacy-peer-deps --omit=dev --no-fund --no-audit

ENV PORT=8080
EXPOSE 8080
CMD ["node","dist/index.js"]

# Stage 1: Dependencies
# Cache package install separately so source-only changes do not invalidate the layer.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: App Assembly
# This service is runtime-only JavaScript, so no transpilation step is required.
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Stage 3: Production
# Keep the image minimal and run the service as a non-root user.
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node --from=builder /app ./
EXPOSE 3005
USER node
CMD ["node", "server.js"]

# Build stage
FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx tsc

# Production stage
FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
# Keep the service account file if it exists, or it will be provided via ENV
COPY service-account.json* ./

EXPOSE 3000

CMD ["node", "dist/index.js"]

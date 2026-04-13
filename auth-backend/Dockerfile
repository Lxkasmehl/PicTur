# PicTur Auth Backend (Node/Express, JWT, Google OAuth)
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime image
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Data dir for JSON DB (auth.json) - persisted via volume
RUN mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 3001

# When running from dist, __dirname is /app/dist/db so ../../data = /app/data
CMD ["node", "dist/index.js"]

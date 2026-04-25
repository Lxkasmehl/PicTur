# PicTur Frontend (React/Vite) – build and serve with Nginx
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# API URLs the browser will use (host-relative for Docker Compose on one machine)
ARG VITE_AUTH_API_URL=http://localhost:3001/api
ARG VITE_API_URL=http://localhost:5000/api
ENV VITE_AUTH_API_URL=$VITE_AUTH_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# Serve stage
FROM nginx:alpine

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# SPA: serve index.html for all routes
RUN echo 'server { \
  listen 80; \
  root /usr/share/nginx/html; \
  index index.html; \
  location / { try_files $uri $uri/ /index.html; } \
  }' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

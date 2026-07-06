FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY server.js db.js ./
COPY public ./public
COPY utils ./utils
RUN mkdir -p uploads && chown appuser:appgroup uploads
USER appuser
EXPOSE 3000
CMD ["node", "server.js"]

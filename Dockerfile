# fuks Antwortkarte – Deploy auf Coolify
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# Coolify setzt PORT; Standard hier 3000
ENV PORT=3000
ENV UPLOAD_DIR=/data/antwortkarten
RUN mkdir -p /data/antwortkarten
VOLUME ["/data"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1

USER node
CMD ["node", "server.js"]

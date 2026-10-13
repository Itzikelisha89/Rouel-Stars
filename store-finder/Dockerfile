# Production image: Node 22 (built-in SQLite), data on a mounted volume at /data.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "--no-warnings", "server.js"]

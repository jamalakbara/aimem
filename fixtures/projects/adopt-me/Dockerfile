FROM node:22-slim
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --prod
CMD ["node", "src/server.js"]

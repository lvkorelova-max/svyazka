FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace backend --include-workspace-root=false
COPY backend backend
WORKDIR /app/backend
RUN npx prisma generate
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

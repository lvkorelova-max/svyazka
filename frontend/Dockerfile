FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace frontend --include-workspace-root=false
COPY frontend frontend
WORKDIR /app/frontend
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

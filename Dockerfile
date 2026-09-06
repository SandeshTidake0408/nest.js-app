FROM node:24.20.0-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci

FROM dependencies AS build
COPY backend backend
COPY frontend frontend
RUN npm run build --workspace backend && npm run build --workspace frontend

FROM build AS backend
EXPOSE 3000
CMD ["node", "backend/dist/main.js"]

FROM build AS worker
CMD ["node", "backend/dist/worker.js"]

FROM build AS frontend
EXPOSE 3001
CMD ["npm", "run", "start", "--workspace", "frontend"]

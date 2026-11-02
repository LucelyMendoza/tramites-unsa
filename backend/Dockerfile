FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY src/db/migrations ./dist/db/migrations
# Carpeta de archivos para STORAGE_DRIVER=disk (servidor propio); el volumen hereda este dueño.
RUN mkdir -p /data/archivos && chown node:node /data/archivos
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]

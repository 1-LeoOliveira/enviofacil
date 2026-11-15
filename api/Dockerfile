# Contexto de build: raiz do projeto (precisa de ./api e ./db)
FROM node:22-alpine AS build
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY api/tsconfig.json ./
COPY api/src ./src
RUN npm run build

FROM node:22-alpine AS producao
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache tini curl
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# As migrações são aplicadas pela própria API ao subir.
COPY db ./db
RUN mkdir -p /app/storage && chown -R node:node /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=20s --timeout=4s --start-period=25s --retries=5 \
  CMD curl -fsS http://127.0.0.1:4000/health > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/sync-server/package.json apps/sync-server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/sync-server apps/sync-server
RUN npm run build -w @weavepad/shared && npm run build -w @weavepad/sync-server

FROM node:20-alpine AS runtime
ENV NODE_ENV=production PORT=1234 SYNC_HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/sync-server/package.json apps/sync-server/package.json
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev --workspace=@weavepad/sync-server --workspace=@weavepad/shared && npm cache clean --force
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/sync-server/dist apps/sync-server/dist
USER node
EXPOSE 1234
CMD ["node", "apps/sync-server/dist/index.js"]

FROM node:20-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/sync-server/package.json apps/sync-server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM dependencies AS build
COPY . .
ARG NEXT_PUBLIC_SYNC_URL=ws://localhost:1234
ENV NEXT_PUBLIC_SYNC_URL=$NEXT_PUBLIC_SYNC_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @weavepad/shared && npm run build -w @weavepad/web

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

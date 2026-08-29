FROM node:26-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN pnpm build

FROM node:26-alpine AS runtime
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml* ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune
COPY --from=build /app/dist ./dist
RUN addgroup -S app && adduser -S app -G app \
 && mkdir -p /exports && chown -R app:app /app /exports
VOLUME ["/exports"]
ENV OUT_DIR=/exports
USER app
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["export"]

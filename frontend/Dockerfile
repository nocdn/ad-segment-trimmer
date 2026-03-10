FROM oven/bun:1 AS base

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS dev

COPY . .

EXPOSE 6030

CMD ["bun", "run", "dev"]

FROM base AS build

COPY . .
RUN bun run build

FROM oven/bun:1 AS production

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=6030

COPY --from=build /app/.output ./.output

EXPOSE 6030

CMD ["bun", ".output/server/index.mjs"]

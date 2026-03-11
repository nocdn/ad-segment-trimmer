FROM oven/bun:1 AS base

WORKDIR /app

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS dev

COPY . .

EXPOSE 5173

CMD ["bun", "run", "dev"]

FROM base AS build

COPY . .
RUN bun run build

FROM oven/bun:1 AS production

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/.output ./.output

EXPOSE 3000

CMD ["bun", ".output/server/index.mjs"]

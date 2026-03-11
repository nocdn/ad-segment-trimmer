FROM oven/bun:1 AS base

WORKDIR /usr/src/app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

FROM base AS release

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile --production
COPY src ./src
RUN mkdir -p uploads && chown -R bun:bun /usr/src/app

USER bun
EXPOSE 7070/tcp

ENTRYPOINT ["bun", "run", "src/index.ts"]

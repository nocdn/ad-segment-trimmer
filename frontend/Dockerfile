FROM oven/bun:1 AS base

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS dev

COPY . .

EXPOSE 6030

CMD ["bun", "run", "dev", "--host", "0.0.0.0", "--port", "6030"]

FROM base AS build

COPY . .
RUN bun run build

FROM nginx:1.27-alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 6030

CMD ["nginx", "-g", "daemon off;"]

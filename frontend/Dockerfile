# File: frontend/Dockerfile
# Build stage
FROM oven/bun:alpine as build

WORKDIR /app

# Copy and install dependencies
COPY package*.json bun.lock* ./
# Install dependencies first to generate/read lockfile
RUN bun install && bun pm trust --all

# Copy the rest of the project and build
COPY . .
# Ensure esbuild host/binary are in sync before building
RUN bun pm trust --all && bun run build

# Production stage: serve static files with nginx
FROM nginx:alpine

# Copy the build output from the previous stage to nginx’s html folder
COPY --from=build /app/dist /usr/share/nginx/html

# Copy our custom nginx config that also proxies API calls to the backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 6030

CMD ["nginx", "-g", "daemon off;"]
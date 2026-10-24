# syntax=docker/dockerfile:1

# Compile the TypeScript server and Vite client.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src
RUN npm run build

# Keep only production dependencies, build output and original brand assets.
FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY assets ./assets
COPY THIRD-PARTY-NOTICES ./THIRD-PARTY-NOTICES
COPY LICENSE ./LICENSE
USER node
EXPOSE 8080
CMD ["node", "dist/server/index.js"]

FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile || bun install
COPY src ./src
COPY tsconfig.json ./
ENV PORT=3000
ENV DATA_DIR=/app/data
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]

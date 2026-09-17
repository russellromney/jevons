# Deploy

## Fly.io — bot + SSE

App name: `jevons`.

```
cd ~/Documents/Github/sit
# Dockerfile: oven/bun, CMD bun run src/index.ts, PORT from env
# fly.toml: http_service internal_port 3000, min_machines_running 1
# mount volume at /app/data for jsonl

fly launch --no-deploy   # then edit fly.toml
fly volumes create sit_data --size 1
fly secrets set DRY_RUN=true MODEL=mock
# optional:
# soup run -- fly secrets set TYPESAFE_AI_API_KEY=... LUNA_API_KEY=...
fly deploy
```

### Dockerfile sketch

```
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
```

`.dockerignore`: `web/.next`, `data`, `.env`, `node_modules`.

### Fly specifics

- SSE: ping every 10–15 s already in contract. Disable buffering if you see it: `response headers` `X-Accel-Buffering: no` `Cache-Control: no-cache`.
- One machine. This is a single-writer bot. Do not autoscale to 2 (double quotes).
- `min_machines_running = 1` so it does not sleep (sleeping = missed blocks + “fixed” lies).
- Health check: `GET /` 200.
- RPC: start with public `https://rpc.monad.xyz`. If rate-limited, Russell will provide a dedicated URL as a Fly secret `RPC_URL` / `READ_RPC_URL`.
- **No PRIVATE_KEY on Fly** unless Russell explicitly asks after markout gates.

### Schema probe (run after deploy)

```
bun run scripts/check-schema.ts https://jevons.fly.dev
```

Assert latest has `strategy`, `feedHealth`, `decision.action`, `execution`, `position`, and directional P&L totals. Fail CI/deploy if missing.

## Vercel — website

```
cd web
# vercel project, root directory web/
# env:
# NEXT_PUBLIC_API_URL=https://jevons.fly.dev
```

CORS is `*` on the bot so Vercel origin is fine.

Do not put model keys on Vercel. The browser only speaks SSE.

Custom domain optional; `sit-*.vercel.app` is enough for launch.

## Local

```
source ~/.zshrc
cp .env.example .env
bun install
bun run start          # :3000 API
cd web && bun install && bun run dev   # :3001 UI, API URL localhost:3000
```

## Secrets

| Where | Vars |
|---|---|
| Fly | `DRY_RUN`, `MODEL`, `RPC_URL`, `READ_RPC_URL`, `WS_URL`, optional model keys, never commit |
| Vercel | `NEXT_PUBLIC_API_URL` only |
| Laptop `.env` | gitignored |

Use `soup run --` when interpolating keys from Soup. Do not echo them.

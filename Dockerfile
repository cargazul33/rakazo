FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rakazo/db generate
RUN RAKAZO_ALLOW_DEV_SECRETS=1 pnpm --filter @rakazo/web build
RUN chmod +x scripts/back4app-start.sh

ENV NODE_ENV=production
ENV PORT=8080
ENV API_PORT=8080
ENV DATA_DIR=/tmp/rakazo-data
ENV SANDBOX_PROVIDER=desktop
ENV AGENT_RUNTIME=pi
ENV WAKEUP_DRIVER=memory
ENV NODE_OPTIONS=--max-old-space-size=160

EXPOSE 8080

CMD ["bash", "scripts/back4app-start.sh"]

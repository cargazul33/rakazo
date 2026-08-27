FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rakazo/db generate
RUN RAKAZO_ALLOW_DEV_SECRETS=1 pnpm --filter @rakazo/web build
RUN chmod +x scripts/back4app-start.sh

ENV NODE_ENV=production
ENV WEB_PORT=8080
ENV API_PROXY_TARGET=http://127.0.0.1:3100
ENV DATA_DIR=/tmp/rakazo-data
ENV RAKAZO_HOST=.b4a.run

EXPOSE 8080

CMD ["bash", "scripts/back4app-start.sh"]

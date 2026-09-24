# ---------- bagimliliklar ----------
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# ---------- derleme ----------
FROM node:24-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# prisma generate config dosyasini okur; derleme sirasinda gercek adres gerekmez
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npx prisma generate && npx next build

# ---------- calisma ----------
FROM node:24-bookworm-slim AS runner
WORKDIR /app
# postgresql-client-17: otomatik yedegin pg_dump'i sunucu (postgres:17) surumuyle esit olmali.
# Debian bookworm varsayilani eski kaldigi icin PGDG deposu eklenir.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates tini curl fonts-dejavu-core fontconfig \
  && fc-cache -f \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-17 \
  && apt-get purge -y curl && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 STORAGE_DIR=/app/storage

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/worker ./worker
COPY --from=builder /app/public ./public
# Panel kopru eklentisini istek uzerine zip'ledigi icin kaynak imajda bulunmali
COPY --from=builder /app/wp-plugin ./wp-plugin
COPY --from=builder /app/.next ./.next
COPY docker/entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh && mkdir -p /app/storage

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
CMD ["panel"]

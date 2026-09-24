#!/bin/sh
set -e

sync_schema() {
  n=0
  until npx prisma db push; do
    n=$((n + 1))
    [ "$n" -gt 30 ] && echo "[entrypoint] Postgres'e baglanilamadi, cikiliyor." && exit 1
    echo "[entrypoint] Postgres hazir degil, 3 sn sonra tekrar denenecek ($n/30)..."
    sleep 3
  done
}

wait_db() {
  n=0
  until npx tsx -e "import{prisma}from'./src/lib/db';prisma.\$queryRaw\`SELECT 1\`.then(()=>prisma.\$disconnect())" >/dev/null 2>&1; do
    n=$((n + 1))
    [ "$n" -gt 40 ] && echo "[entrypoint] Veritabani zaman asimi." && exit 1
    sleep 3
  done
}

case "$1" in
  panel)
    echo "[entrypoint] Sema senkronize ediliyor..."
    sync_schema
    echo "[entrypoint] Ilk kurulum kontrolu (panel kullanicisi)..."
    npx tsx prisma/seed.ts || echo "[entrypoint] seed atlandi"
    echo "[entrypoint] Panel baslatiliyor -> http://0.0.0.0:3000"
    exec npx next start -p 3000 -H 0.0.0.0
    ;;
  worker)
    echo "[entrypoint] Veritabani bekleniyor..."
    wait_db
    echo "[entrypoint] Worker baslatiliyor..."
    exec npx tsx worker/index.ts
    ;;
  *)
    exec "$@"
    ;;
esac

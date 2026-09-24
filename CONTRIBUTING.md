# Katkı / Contributing

Teşekkürler! · Thanks for contributing!

## Geliştirme ortamı (TR)

```bash
npm install
docker compose up -d postgres redis
cp .env.example .env         # ENCRYPTION_KEY + AUTH_SECRET üretin
npx prisma db push
npm run seed
npm run dev                  # panel
npm run dev:worker           # ayrı terminalde worker
```

Bir PR açmadan önce:

```bash
npm run typecheck   # tip hatası yok
npm test            # birim testler geçiyor
npm run build       # derleniyor
```

- **Sırları asla commit etmeyin.** `.env` gitignore'da; yeni API anahtarını hep `.env`'e koyun.
- Kalite eşikleri tek dosyada: `src/lib/quality/standards.ts`.
- Saf mantık (analiz, benzerlik, başlık, iç link) için `tests/` altına test ekleyin.
- Türkçe kod yorumları ve mesajları projenin dilidir; onu koruyun.

## Development (EN)

```bash
npm install
docker compose up -d postgres redis
cp .env.example .env         # generate ENCRYPTION_KEY + AUTH_SECRET
npx prisma db push
npm run seed
npm run dev                  # panel
npm run dev:worker           # worker in a separate terminal
```

Before opening a PR, run `npm run typecheck`, `npm test` and `npm run build`.
Never commit secrets (`.env` is gitignored). Add tests under `tests/` for pure-logic changes.

## Mimari / Architecture

```
src/app/            panel (Next.js App Router, Türkçe arayüz)
src/lib/pipeline/   üretim hattı: generate, quality, cover, interlink, translate…
src/lib/providers/  sağlayıcı adaptörleri (text/image/vision/publish) + havuz
src/lib/quality/    kalite ölçümü, okunabilirlik, benzerlik, görsel prompt
worker/index.ts     kuyruk işçisi + zamanlayıcı (BullMQ)
wp-plugin/          WordPress köprü eklentisi (dpdai-bridge)
tests/              birim testler (node:test)
```

## Yedek / Backup

```bash
npm run backup                                  # elle yedek al
npm run restore -- storage/backups/<dosya>.dump # geri yükle (üzerine yazar!)
```

`ENCRYPTION_KEY`'i ayrı ve güvenli bir yerde saklayın — kaybolursa yedek geri yüklense bile
kayıtlı şifreler çözülemez. / Keep `ENCRYPTION_KEY` safe separately; without it a restored
backup cannot decrypt stored credentials.

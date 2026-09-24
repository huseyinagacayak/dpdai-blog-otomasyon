import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 ile baglanti adresi sema dosyasindan buraya tasindi.
 * Bu dosya yalnizca CLI (migrate / db push / studio) tarafindan kullanilir;
 * uygulama calisma zamaninda PrismaClient'a adapter uzerinden verilir (src/lib/db.ts).
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});

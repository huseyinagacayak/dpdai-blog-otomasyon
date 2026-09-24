import { execFile } from 'node:child_process';
import { copyFile, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { prisma } from './db';
import { notify } from './notify';

const run = promisify(execFile);

const RESTORE_NOTE = `DPDAI - Veritabani yedegi / geri yukleme

Bu klasordeki .dump dosyalari Postgres "custom format" yedekleridir.

GERI YUKLEME (Docker):
  docker compose cp <dosya>.dump postgres:/tmp/yedek.dump
  docker compose exec postgres pg_restore --clean --if-exists --no-owner \\
    -U dpdai -d dpdai /tmp/yedek.dump

GERI YUKLEME (yerel, DATABASE_URL ile):
  npm run restore -- storage/backups/<dosya>.dump

!!! COK ONEMLI - ENCRYPTION_KEY !!!
Site sifreleri ve API anahtarlari veritabaninda ENCRYPTION_KEY ile sifrelidir.
Bu yedek TEK BASINA yeterli DEGILDIR: .env icindeki ENCRYPTION_KEY'i AYRI ve
guvenli bir yerde (parola yoneticisi) saklayin. Anahtar kaybolursa yedek geri
yuklense bile kayitli sifreler cozulEMEZ ve hepsini yeniden girmeniz gerekir.
`;

/**
 * Otomatik Postgres yedegi (pg_dump).
 *
 * Worker gunde bir kez calisir; dump'i storage volume'una custom (-Fc) formatta
 * yazar, eski yedekleri budar ve basarisiz olursa bildirim gonderir. Custom format
 * sikistirilmis gelir ve `pg_restore` ile secmeli/paralel geri yuklenebilir.
 *
 * pg_dump ikilisinin sunucudan >= surumde olmasi gerekir; Docker imajina
 * postgresql-client-17 kuruludur. Yerel gelistirmede pg_dump PATH'te yoksa
 * PG_DUMP_PATH ile tam yol verin (yoksa is anlasilir bir hatayla biter).
 */

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(process.cwd(), 'storage');
const STATUS_KEY = 'backup:status';
const FILE_PREFIX = 'dpdai-';
const FILE_SUFFIX = '.dump';

export type BackupConfig = {
  enabled: boolean;
  /** Gunluk calisma zamani (cron ifadesi) */
  cron: string;
  /** Saklanacak en yeni yedek sayisi */
  keep: number;
  dir: string;
  pgDump: string;
  pgRestore: string;
  /** Ayarliysa her yedek buraya da kopyalanir (off-site: ag surucusu, mount vb.) */
  copyDir: string | null;
};

export function backupConfig(): BackupConfig {
  return {
    enabled: (process.env.BACKUP_ENABLED ?? 'true').toLowerCase() !== 'false',
    cron: process.env.BACKUP_CRON || '30 3 * * *',
    keep: Math.max(1, Number(process.env.BACKUP_KEEP ?? 14) || 14),
    dir: process.env.BACKUP_DIR || path.join(STORAGE_DIR, 'backups'),
    pgDump: process.env.PG_DUMP_PATH || 'pg_dump',
    pgRestore: process.env.PG_RESTORE_PATH || 'pg_restore',
    copyDir: process.env.BACKUP_COPY_DIR || null,
  };
}

export type BackupStatus = {
  at: string;
  ok: boolean;
  file?: string;
  bytes?: number;
  durationMs?: number;
  pruned?: number;
  error?: string;
  trigger?: 'auto' | 'manual';
};

export async function getBackupStatus(): Promise<BackupStatus | null> {
  const row = await prisma.setting.findUnique({ where: { key: STATUS_KEY } });
  return (row?.value as BackupStatus | undefined) ?? null;
}

async function setBackupStatus(s: BackupStatus): Promise<void> {
  await prisma.setting.upsert({
    where: { key: STATUS_KEY },
    create: { key: STATUS_KEY, value: s as object },
    update: { value: s as object },
  });
}

/** DATABASE_URL'i pg_dump bayraklarina ayirir (libpq schema parametresini tanimaz). */
function pgParams() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL tanımlı değil.');
  const u = new URL(raw);
  return {
    host: u.hostname || '127.0.0.1',
    port: u.port || '5432',
    user: decodeURIComponent(u.username) || 'postgres',
    password: decodeURIComponent(u.password),
    db: u.pathname.replace(/^\//, '') || 'postgres',
    sslmode: u.searchParams.get('sslmode') || undefined,
  };
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

/** En yeni `keep` yedegi tutup gerisini siler. Silinen dosya sayisini dondurur. */
async function prune(dir: string, keep: number): Promise<number> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  const dumps = names
    .filter((n) => n.startsWith(FILE_PREFIX) && n.endsWith(FILE_SUFFIX))
    .sort()
    .reverse(); // isim zaman damgasi tasidigi icin en yeni basta

  const eski = dumps.slice(keep);
  let silinen = 0;
  for (const name of eski) {
    try {
      await unlink(path.join(dir, name));
      silinen++;
    } catch {
      // silinemezse gecici bir sorun; sonraki turda tekrar denenir
    }
  }
  return silinen;
}

/**
 * Bir yedek alir. Basarili/basarisiz her durumda durum kaydini gunceller.
 * Basarisizlikta bildirim gonderir ve hatayi firlatir (worker "failed" olarak isaretlesin).
 */
export async function runBackup(
  opts: { trigger?: 'auto' | 'manual' } = {},
): Promise<BackupStatus> {
  const cfg = backupConfig();
  const trigger = opts.trigger ?? 'auto';
  const started = Date.now();

  if (!cfg.enabled) {
    return { at: new Date().toISOString(), ok: false, error: 'Yedekleme kapalı (BACKUP_ENABLED=false).', trigger };
  }

  try {
    const pg = pgParams();
    await mkdir(cfg.dir, { recursive: true });

    const filename = `${FILE_PREFIX}${stamp()}${FILE_SUFFIX}`;
    const target = path.join(cfg.dir, filename);

    const args = [
      '-h', pg.host,
      '-p', pg.port,
      '-U', pg.user,
      '-d', pg.db,
      '-Fc', // custom format (sikistirilmis, pg_restore uyumlu)
      '--no-owner',
      '--no-privileges',
      '-f', target,
    ];

    try {
      await run(cfg.pgDump, args, {
        timeout: 10 * 60 * 1000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          PGPASSWORD: pg.password,
          ...(pg.sslmode ? { PGSSLMODE: pg.sslmode } : {}),
        },
      });
    } catch (e) {
      const err = e as NodeJS.ErrnoException & { stderr?: string };
      if (err.code === 'ENOENT') {
        throw new Error(
          `pg_dump bulunamadı ("${cfg.pgDump}"). Docker dışında çalıştırıyorsanız ` +
            `postgresql-client kurun ya da PG_DUMP_PATH ile tam yolu verin.`,
        );
      }
      const detay = (err.stderr || err.message || '').toString().trim().slice(0, 400);
      throw new Error(`pg_dump başarısız: ${detay || 'bilinmeyen hata'}`);
    }

    const { size } = await stat(target);
    const pruned = await prune(cfg.dir, cfg.keep);

    // Off-site kopya (ayarliysa): yedek ikinci bir yere de yazilir
    if (cfg.copyDir) {
      try {
        await mkdir(cfg.copyDir, { recursive: true });
        await copyFile(target, path.join(cfg.copyDir, filename));
      } catch (e) {
        // Kopya basarisiz olsa da asil yedek durmasin; sadece uyar
        await notify({
          level: 'warn',
          title: 'Yedek off-site kopyalanamadı',
          message: `${cfg.copyDir}: ${(e as Error).message.slice(0, 200)}`,
          path: '/ayarlar',
          dedupeKey: 'backup-copy-failed',
        }).catch(() => undefined);
      }
    }

    // Geri yukleme + anahtar guvenligi hatirlaticisi (her seferinde tazelenir)
    await writeFile(path.join(cfg.dir, 'OKU-RESTORE.txt'), RESTORE_NOTE, 'utf8').catch(() => undefined);

    const status: BackupStatus = {
      at: new Date().toISOString(),
      ok: true,
      file: filename,
      bytes: size,
      durationMs: Date.now() - started,
      pruned,
      trigger,
    };
    await setBackupStatus(status).catch(() => undefined);
    return status;
  } catch (e) {
    const message = (e as Error).message.slice(0, 500);
    const status: BackupStatus = {
      at: new Date().toISOString(),
      ok: false,
      durationMs: Date.now() - started,
      error: message,
      trigger,
    };
    await setBackupStatus(status).catch(() => undefined);

    await notify({
      level: 'error',
      title: 'Veritabanı yedeği alınamadı',
      message,
      path: '/ayarlar',
      dedupeKey: 'backup-failed',
    });

    throw e;
  }
}

/**
 * Bir yedegi geri yukler (pg_restore). Mevcut veriyi TEMIZLEYIP yeniden kurar
 * (--clean --if-exists). Dikkat: bu islem mevcut veritabaninin uzerine yazar.
 * pg_restore ikilisi sunucudan >= surumde olmali (Docker imajinda kurulu).
 */
export async function restoreBackup(file: string): Promise<void> {
  const cfg = backupConfig();
  const pg = pgParams();
  const abs = path.isAbsolute(file) ? file : path.resolve(file);
  await stat(abs); // dosya var mi

  const args = [
    '-h', pg.host,
    '-p', pg.port,
    '-U', pg.user,
    '-d', pg.db,
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    abs,
  ];

  try {
    await run(cfg.pgRestore, args, {
      timeout: 15 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        PGPASSWORD: pg.password,
        ...(pg.sslmode ? { PGSSLMODE: pg.sslmode } : {}),
      },
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === 'ENOENT') {
      throw new Error(
        `pg_restore bulunamadı ("${cfg.pgRestore}"). postgresql-client kurun ya da ` +
          `PG_RESTORE_PATH ile tam yolu verin.`,
      );
    }
    // pg_restore uyari verse de (ornek: yok olan nesneyi drop) tamamen basarisiz sayma
    const detay = (err.stderr || err.message || '').toString().trim();
    if (/error:/i.test(detay) && !/does not exist/i.test(detay)) {
      throw new Error(`pg_restore başarısız: ${detay.slice(0, 400)}`);
    }
  }
}

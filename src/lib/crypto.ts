import crypto from 'node:crypto';

/**
 * Site sifreleri / API anahtarlari DB'ye duz metin yazilmaz.
 * AES-256-GCM, ENCRYPTION_KEY = 64 hex karakter.
 */
const ALGO = 'aes-256-gcm';

function key(): Buffer {
  const hex = process.env.ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'ENCRYPTION_KEY 64 hex karakter olmali. Uretmek icin: openssl rand -hex 32',
    );
  }
  return Buffer.from(hex, 'hex');
}

export function encrypt(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${enc.toString('base64url')}`;
}

export function decrypt(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const [, ivB, tagB, dataB] = parts;
    const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/** Panelde gosterim icin: sk-abc...xyz */
export function mask(value: string | null | undefined): string {
  if (!value) return '—';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

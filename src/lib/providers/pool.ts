import type { ApiCredential, CredentialKind } from '@prisma/client';
import { decrypt } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { notify } from '@/lib/notify';

/**
 * API havuzu: ayni is icin birden fazla saglayici tanimlanir, oncelik
 * sirasina gore denenir. Biri duserse digerine gecilir; hepsi duserse is
 * durur ve bildirim gider.
 *
 * Saglik takibi kalicidir (veritabaninda), boylece worker yeniden baslasa
 * bile bozuk anahtar tekrar tekrar denenmez.
 */

/* ------------------------------------------------------------------ hata */

export type FailureKind =
  | 'auth' // anahtar gecersiz / yetkisiz
  | 'quota' // kredi veya kota bitti
  | 'rate_limit' // hiz siniri
  | 'server' // 5xx
  | 'network' // baglanti kurulamadi / zaman asimi
  | 'bad_request' // istek gecersiz, baska saglayicida da olabilir
  | 'unknown';

/** Her arizanin ne kadar sure bekletecegi (dakika) */
const COOLDOWN: Record<FailureKind, number> = {
  auth: 720, // 12 saat - kullanici duzeltmeden anlamsiz
  quota: 360, // 6 saat
  rate_limit: 5,
  server: 3,
  network: 2,
  bad_request: 0,
  unknown: 5,
};

/** Kullanici mudahalesi gerektiren arizalar */
const NEEDS_FIX: FailureKind[] = ['auth', 'quota'];

export function classifyError(err: unknown): FailureKind {
  const e = err as {
    status?: number;
    message?: string;
    name?: string;
    code?: string;
    cause?: unknown;
  };
  const msg = String(e?.message ?? err ?? '').toLowerCase();

  const status =
    typeof e?.status === 'number'
      ? e.status
      : Number((msg.match(/\b(4\d{2}|5\d{2})\b/) ?? [])[1] ?? 0);

  if (e?.name === 'AbortError' || msg.includes('timeout') || msg.includes('aborted')) {
    return 'network';
  }
  if (
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('fetch failed') ||
    msg.includes('socket hang up') ||
    // OpenAI / Anthropic SDK'lari baglanti sorununu boyle bildirir
    msg.includes('connection error') ||
    e?.name === 'APIConnectionError' ||
    e?.name === 'APIConnectionTimeoutError'
  ) {
    return 'network';
  }

  if (status === 401 || status === 403) return 'auth';
  if (msg.includes('invalid api key') || msg.includes('incorrect api key')) return 'auth';
  if (msg.includes('unauthorized') || msg.includes('authentication')) return 'auth';

  if (status === 402) return 'quota';
  if (
    msg.includes('insufficient') ||
    msg.includes('quota') ||
    msg.includes('credit') ||
    msg.includes('billing') ||
    msg.includes('exceeded your current')
  ) {
    return 'quota';
  }

  if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'rate_limit';
  }

  if (status >= 500) return 'server';
  if (status === 400 || status === 422) return 'bad_request';

  return 'unknown';
}

/** Hepsi tukendiginde firlatilir. */
export class AllProvidersFailedError extends Error {
  constructor(
    public kind: CredentialKind,
    public attempts: { label: string; failure: FailureKind; message: string }[],
  ) {
    const detay = attempts
      .map((a) => `${a.label} (${TR_FAILURE[a.failure]}): ${a.message.slice(0, 160)}`)
      .join(' | ');
    super(
      `${kind === 'TEXT' ? 'Metin' : 'Görsel'} sağlayıcılarının tamamı başarısız oldu. ${detay}`,
    );
    this.name = 'AllProvidersFailedError';
  }
}

export const TR_FAILURE: Record<FailureKind, string> = {
  auth: 'anahtar geçersiz',
  quota: 'kota/kredi bitti',
  rate_limit: 'hız sınırı',
  server: 'sunucu hatası',
  network: 'bağlantı hatası',
  bad_request: 'geçersiz istek',
  unknown: 'bilinmeyen hata',
};

/* ------------------------------------------------------------------ zincir */

export type ResolvedCredential = ApiCredential & { apiKeyPlain: string | null };

/**
 * Denenecek saglayici zincirini kurar.
 * Sirasi: tercih edilen giris -> oncelik -> ayni oncelikte az hata alan.
 * Bekleme suresi dolmamis ve devre disi olanlar atlanir.
 */
export async function resolveChain(opts: {
  kind: CredentialKind;
  preferredId?: string | null;
  /** Yalnizca gorsel destekleyen metin girisleri (gorsel denetimi icin) */
  visionOnly?: boolean;
}): Promise<ResolvedCredential[]> {
  const now = new Date();

  const rows = await prisma.apiCredential.findMany({
    where: {
      kind: opts.kind,
      enabled: true,
      ...(opts.visionOnly ? { vision: true } : {}),
    },
    orderBy: [{ priority: 'asc' }, { fails: 'asc' }, { createdAt: 'asc' }],
  });

  const usable = rows.filter((r) => !r.cooldownUntil || r.cooldownUntil <= now);

  // Hepsi bekleme suresindeyse, en erken serbest kalacak olani yine de dene:
  // is tamamen durmaktansa bir sans daha vermek daha iyi.
  const chain = usable.length
    ? usable
    : rows
        .slice()
        .sort(
          (a, b) =>
            (a.cooldownUntil?.getTime() ?? 0) - (b.cooldownUntil?.getTime() ?? 0),
        )
        .slice(0, 1);

  const ordered = opts.preferredId
    ? [
        ...chain.filter((c) => c.id === opts.preferredId),
        ...chain.filter((c) => c.id !== opts.preferredId),
      ]
    : chain;

  return ordered.map((c) => ({ ...c, apiKeyPlain: decrypt(c.apiKey) }));
}

/* ------------------------------------------------------------------ saglik */

export async function markSuccess(id: string, costUsd = 0): Promise<void> {
  await prisma.apiCredential
    .update({
      where: { id },
      data: {
        health: 'OK',
        lastOkAt: new Date(),
        failCount: 0,
        cooldownUntil: null,
        lastError: null,
        calls: { increment: 1 },
        costUsd: { increment: costUsd },
      },
    })
    .catch(() => undefined);
}

export async function markFailure(
  id: string,
  failure: FailureKind,
  message: string,
): Promise<void> {
  const minutes = COOLDOWN[failure];
  const current = await prisma.apiCredential.findUnique({
    where: { id },
    select: { failCount: true },
  });

  // Ust uste hata alan giris giderek daha uzun bekletilir (en fazla 1 saat katsayi)
  const streak = (current?.failCount ?? 0) + 1;
  const backoff = Math.min(minutes * Math.min(streak, 6), 720);

  await prisma.apiCredential
    .update({
      where: { id },
      data: {
        health: NEEDS_FIX.includes(failure) ? 'BROKEN' : backoff > 0 ? 'COOLDOWN' : 'OK',
        lastErrorAt: new Date(),
        lastError: `${TR_FAILURE[failure]}: ${message.slice(0, 400)}`,
        failCount: { increment: 1 },
        fails: { increment: 1 },
        calls: { increment: 1 },
        cooldownUntil: backoff > 0 ? new Date(Date.now() + backoff * 60_000) : null,
      },
    })
    .catch(() => undefined);
}

/* ------------------------------------------------------------------ calisma */

export type Attempt = { label: string; failure: FailureKind; message: string };

/**
 * Zinciri sirayla dener. Ilk basarili sonucu dondurur.
 *
 * @param run  Bir giris icin isi calistiran fonksiyon. Maliyeti donerse
 *             giris uzerine islenir.
 */
export async function runWithFallback<T>(
  kind: CredentialKind,
  chain: ResolvedCredential[],
  run: (cred: ResolvedCredential) => Promise<{ result: T; costUsd?: number }>,
  opts: { onFallback?: (from: string, to: string, failure: FailureKind) => void } = {},
): Promise<{ result: T; credential: ResolvedCredential; attempts: Attempt[] }> {
  if (chain.length === 0) {
    await notifyExhausted(kind, []);
    throw new AllProvidersFailedError(kind, []);
  }

  const attempts: Attempt[] = [];

  for (let i = 0; i < chain.length; i++) {
    const cred = chain[i];
    try {
      const out = await run(cred);
      await markSuccess(cred.id, cred.free ? 0 : (out.costUsd ?? 0));
      return { result: out.result, credential: cred, attempts };
    } catch (e) {
      const failure = classifyError(e);
      const message = e instanceof Error ? e.message : String(e);

      attempts.push({ label: cred.label, failure, message });
      await markFailure(cred.id, failure, message);

      const next = chain[i + 1];
      if (next) {
        console.warn(
          `[pool] ${cred.label} başarısız (${TR_FAILURE[failure]}), ${next.label} deneniyor`,
        );
        opts.onFallback?.(cred.label, next.label, failure);
      }
    }
  }

  await notifyExhausted(kind, attempts);
  throw new AllProvidersFailedError(kind, attempts);
}

async function notifyExhausted(kind: CredentialKind, attempts: Attempt[]) {
  const tur = kind === 'TEXT' ? 'Metin' : 'Görsel';

  await notify({
    level: 'error',
    title: `${tur} sağlayıcılarının tamamı devre dışı`,
    message: attempts.length
      ? `Denenen ${attempts.length} sağlayıcının hepsi başarısız oldu:\n` +
        attempts
          .map((a) => `• ${a.label} — ${TR_FAILURE[a.failure]}`)
          .join('\n') +
        '\n\nÜretim durdu. Ayarlar > API havuzu ekranından anahtarları kontrol edin.'
      : `Tanımlı ve kullanılabilir ${tur.toLowerCase()} sağlayıcısı yok. ` +
        'Ayarlar > API havuzu ekranından en az bir tane ekleyin.',
    path: '/ayarlar',
    dedupeKey: `pool-exhausted-${kind}`,
  });
}

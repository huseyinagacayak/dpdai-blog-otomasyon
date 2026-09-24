'use server';

import { revalidatePath } from 'next/cache';
import type { CredentialKind } from '@prisma/client';
import { requireSession } from '@/lib/auth';
import { encrypt } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { buildImageProvider } from '@/lib/providers/image';
import { classifyError, TR_FAILURE, type ResolvedCredential } from '@/lib/providers/pool';
import { findPreset } from '@/lib/providers/presets';
import { buildTextProvider } from '@/lib/providers/text';
import { decrypt } from '@/lib/crypto';

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? '').trim();
}

/** Havuza yeni giris ekler. Ön ayar seçildiyse alanlar ondan doldurulur. */
export async function addCredential(fd: FormData) {
  await requireSession();

  const presetId = str(fd, 'preset');
  const preset = presetId ? findPreset(presetId) : undefined;

  const kind = (str(fd, 'kind') || preset?.kind || 'TEXT') as CredentialKind;
  const provider = str(fd, 'provider') || preset?.provider || '';
  if (!provider) throw new Error('Sağlayıcı seçilmedi.');

  const extra: Record<string, string> = {};
  for (const f of preset?.extraFields ?? []) {
    const v = str(fd, `extra_${f.key}`);
    if (v) extra[f.key] = v;
  }

  // Yeni giris listenin sonuna eklenir
  const last = await prisma.apiCredential.findFirst({
    where: { kind },
    orderBy: { priority: 'desc' },
    select: { priority: true },
  });

  await prisma.apiCredential.create({
    data: {
      kind,
      label: str(fd, 'label') || preset?.label || provider,
      provider,
      apiKey: encrypt(str(fd, 'apiKey')),
      baseUrl: str(fd, 'baseUrl') || preset?.baseUrl || null,
      model: str(fd, 'model') || preset?.model || null,
      extra: Object.keys(extra).length ? (extra as unknown as object) : undefined,
      free: fd.get('free') === 'on' || (preset?.free ?? false),
      vision: fd.get('vision') === 'on' || (kind === 'TEXT' && (preset?.vision ?? false)),
      priority: (last?.priority ?? 0) + 10,
    },
  });

  revalidatePath('/ayarlar');
}

export async function updateCredential(id: string, fd: FormData) {
  await requireSession();

  const apiKey = str(fd, 'apiKey');
  const extraRaw = str(fd, 'extraJson');

  const data: Record<string, unknown> = {
    label: str(fd, 'label'),
    model: str(fd, 'model') || null,
    baseUrl: str(fd, 'baseUrl') || null,
    free: fd.get('free') === 'on',
    vision: fd.get('vision') === 'on',
    enabled: fd.get('enabled') === 'on',
  };

  // Boş bırakılırsa mevcut anahtar korunur, tek tire silme anlamına gelir
  if (apiKey === '-') data.apiKey = null;
  else if (apiKey) data.apiKey = encrypt(apiKey);

  if (extraRaw) {
    try {
      data.extra = JSON.parse(extraRaw) as object;
    } catch {
      /* gecersiz JSON: dokunma */
    }
  }

  await prisma.apiCredential.update({ where: { id }, data });
  revalidatePath('/ayarlar');
}

export async function deleteCredential(id: string) {
  await requireSession();
  await prisma.apiCredential.delete({ where: { id } });
  revalidatePath('/ayarlar');
}

/** Listede bir sıra yukarı/aşağı taşır. */
export async function moveCredential(id: string, direction: 'up' | 'down') {
  await requireSession();

  const item = await prisma.apiCredential.findUniqueOrThrow({ where: { id } });
  const neighbour = await prisma.apiCredential.findFirst({
    where: {
      kind: item.kind,
      priority: direction === 'up' ? { lt: item.priority } : { gt: item.priority },
    },
    orderBy: { priority: direction === 'up' ? 'desc' : 'asc' },
  });

  if (!neighbour) return;

  await prisma.$transaction([
    prisma.apiCredential.update({ where: { id: item.id }, data: { priority: neighbour.priority } }),
    prisma.apiCredential.update({ where: { id: neighbour.id }, data: { priority: item.priority } }),
  ]);

  revalidatePath('/ayarlar');
}

/** Bekleme süresini sıfırlar; kullanıcı anahtarı düzelttiğinde kullanılır. */
export async function resetCredentialHealth(id: string) {
  await requireSession();
  await prisma.apiCredential.update({
    where: { id },
    data: { health: 'OK', cooldownUntil: null, failCount: 0, lastError: null },
  });
  revalidatePath('/ayarlar');
}

/**
 * Girişi gerçekten çalıştırıp dener.
 * Metin için kısa bir istek, görsel için küçük bir üretim yapar.
 */
export async function testCredential(id: string) {
  await requireSession();

  const row = await prisma.apiCredential.findUniqueOrThrow({ where: { id } });
  const cred: ResolvedCredential = { ...row, apiKeyPlain: decrypt(row.apiKey) };

  try {
    if (cred.kind === 'TEXT') {
      const provider = buildTextProvider(cred);
      const res = await provider.complete({
        system: 'Kısa ve net cevap ver.',
        prompt: 'Yalnızca "hazır" kelimesini yaz.',
        model: cred.model ?? undefined,
        maxTokens: 20,
        temperature: 0,
      });
      await prisma.apiCredential.update({
        where: { id },
        data: {
          health: 'OK',
          lastOkAt: new Date(),
          lastError: null,
          failCount: 0,
          cooldownUntil: null,
        },
      });
      void res;
    } else {
      const provider = buildImageProvider(cred);
      await provider.generate({
        prompt: 'a single ripe red apple on a plain wooden table, soft daylight',
        aspect: '1:1',
        model: cred.model ?? undefined,
      });
      await prisma.apiCredential.update({
        where: { id },
        data: {
          health: 'OK',
          lastOkAt: new Date(),
          lastError: null,
          failCount: 0,
          cooldownUntil: null,
        },
      });
    }
  } catch (e) {
    const failure = classifyError(e);
    const message = e instanceof Error ? e.message : String(e);
    await prisma.apiCredential.update({
      where: { id },
      data: {
        health: failure === 'auth' || failure === 'quota' ? 'BROKEN' : 'COOLDOWN',
        lastErrorAt: new Date(),
        lastError: `${TR_FAILURE[failure]}: ${message.slice(0, 400)}`,
      },
    });
  }

  revalidatePath('/ayarlar');
}

/** Tüm girişleri sırayla dener. */
export async function testAllCredentials(kind?: CredentialKind) {
  await requireSession();
  const rows = await prisma.apiCredential.findMany({
    where: kind ? { kind } : {},
    select: { id: true },
  });
  for (const r of rows) await testCredential(r.id);
  revalidatePath('/ayarlar');
}

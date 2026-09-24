'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getPublishAdapter } from '@/lib/providers/publish';
import { getTextProvider, parseJson } from '@/lib/providers/text';
import { enqueue } from '@/lib/queue';
import { localeName } from '@/lib/pipeline/prompts';

/**
 * Sitedeki eksik cevirileri denetler ve her biri icin ceviri isi kuyruga atar.
 * Isler worker'da 'xlate' olarak calisir (kaynak cek -> cevir -> bagli yayin).
 */
export async function completeMissingTranslations(siteId: string): Promise<void> {
  await requireSession();

  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const adapter = getPublishAdapter(site);
  if (!adapter.translationAudit) throw new Error('Bu site çeviri denetimini desteklemiyor.');

  const audit = (await adapter.translationAudit()) as {
    supported?: boolean;
    items?: { source_id: number; missing: string[] }[];
  };
  if (!audit.supported) throw new Error('Polylang bulunamadı; çeviri yapılamaz.');

  let total = 0;
  for (const it of audit.items ?? []) {
    for (const lang of it.missing) {
      await enqueue(
        { type: 'xlate', siteId, sourcePostId: it.source_id, targetLang: lang },
        { jobId: `xlate-${siteId}-${it.source_id}-${lang}` },
      );
      total++;
    }
  }

  // Ilerleme takibi icin toplam ve baslangic zamanini sakla (panelde gosterilir)
  await prisma.setting.upsert({
    where: { key: `xlate-progress:${siteId}` },
    create: { key: `xlate-progress:${siteId}`, value: { total, queuedAt: new Date().toISOString() } },
    update: { value: { total, queuedAt: new Date().toISOString() } },
  });

  revalidatePath(`/siteler/${siteId}/ceviri`);
}

type MenuItem = { id: number; title: string; type: string };
type MenuData = { supported?: boolean; menus?: { name: string; items: MenuItem[] }[] };

/**
 * Sitenin navigasyon menulerini hedef dillere cevirir ve her dile atar.
 * Sayfa/kategori ogeleri cevrilmis karsiligina baglanir (bridge yapar);
 * oge ETIKETLERI burada LLM ile cevrilip bridge'e gonderilir.
 */
export async function translateMenus(siteId: string): Promise<void> {
  await requireSession();

  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const adapter = getPublishAdapter(site);
  if (!adapter.getMenus || !adapter.syncMenus) {
    throw new Error('Menü çevirisi için dpdai-bridge 1.5.0+ gerekli.');
  }

  const data = (await adapter.getMenus()) as MenuData;
  if (!data.supported) throw new Error('Polylang bulunamadı.');

  // Tum menu ogelerini topla (id -> baslik)
  const items: Record<string, string> = {};
  for (const m of data.menus ?? []) {
    for (const it of m.items ?? []) {
      if (it.title?.trim()) items[String(it.id)] = it.title;
    }
  }
  if (Object.keys(items).length === 0) {
    revalidatePath(`/siteler/${siteId}/ceviri`);
    return;
  }

  const targets = site.locales.filter((l) => l && l !== site.defaultLocale);
  const { provider, model } = await getTextProvider({
    credentialId: site.preferredTextCredentialId,
    model: site.textModel,
  });

  const labels: Record<string, Record<string, string>> = {};
  for (const lang of targets) {
    const res = await provider.complete({
      system: 'Sen bir yerelleştirme uzmanısın. Web sitesi menü etiketlerini çevirirsin.',
      prompt:
        `Aşağıdaki menü etiketlerini ${localeName(lang)} diline çevir. Kısa ve doğal ol; ` +
        `marka/özel adları çevirme. SADECE aynı anahtarlara sahip bir JSON nesnesi döndür.\n\n` +
        JSON.stringify(items),
      model,
      json: true,
      maxTokens: 1500,
      temperature: 0.3,
    });
    try {
      const parsed = parseJson<Record<string, string>>(res.text);
      labels[lang] = parsed;
    } catch {
      labels[lang] = {}; // cevrilemezse bridge kaynak etiketi kullanir
    }
  }

  await adapter.syncMenus({ langs: targets, labels });
  revalidatePath(`/siteler/${siteId}/ceviri`);
}

/** Ceviri ilerlemesi: toplam kuyruga atilan, tamamlanan, kalan. */
export async function getTranslationProgress(
  siteId: string,
): Promise<{ total: number; done: number; queuedAt: string | null }> {
  const row = await prisma.setting.findUnique({ where: { key: `xlate-progress:${siteId}` } });
  const v = (row?.value ?? null) as { total?: number; queuedAt?: string } | null;
  if (!v?.total || !v.queuedAt) return { total: 0, done: 0, queuedAt: null };

  const done = await prisma.jobRun.count({
    where: {
      siteId,
      kind: 'publish',
      step: { startsWith: 'xlate-' },
      status: 'SUCCESS',
      startedAt: { gte: new Date(v.queuedAt) },
    },
  });

  return { total: v.total, done, queuedAt: v.queuedAt };
}

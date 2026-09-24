'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { scanPool, scanTopic } from '@/lib/pipeline/conflicts';
import { planSchedule } from '@/lib/pipeline/schedule';

/**
 * Toplu konu girisi.
 * Her satir bir konu. Bicim:
 *   Başlık | odak kelime | brief
 * Bos alanlar atlanabilir:  "Başlık | | brief"  veya sadece  "Başlık"
 */
export async function addTopics(fd: FormData) {
  await requireSession();

  const siteId = String(fd.get('siteId') ?? '');
  const raw = String(fd.get('bulk') ?? '');
  const locale = String(fd.get('locale') ?? '').trim() || null;
  const targetLocales = String(fd.get('targetLocales') ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const priority = Number(fd.get('priority') ?? 0) || 0;

  if (!siteId) throw new Error('Site seçilmedi.');

  const rows = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const data = rows.map((line) => {
    const [title, keyword, notes] = line.split('|').map((p) => p.trim());
    return {
      siteId,
      title: title.slice(0, 300),
      keyword: keyword || null,
      notes: notes || null,
      locale,
      targetLocales,
      priority,
    };
  });

  if (data.length) {
    await prisma.topic.createMany({ data });

    // Yeni eklenen konulari mevcut icerikle karsilastir (yamyamlasma kontrolu)
    const eklenen = await prisma.topic.findMany({
      where: { siteId, status: 'QUEUED' },
      orderBy: { createdAt: 'desc' },
      take: data.length,
      select: { id: true },
    });
    for (const t of eklenen) await scanTopic(t.id).catch(() => undefined);

    await planSchedule(siteId).catch(() => undefined);
  }

  revalidatePath('/konular');
}

/** Havuzun tamamini yeniden tarar. */
export async function rescanConflicts(siteId?: string) {
  await requireSession();
  const res = await scanPool(siteId);
  revalidatePath('/konular');
  return res;
}

/** Bir konudaki cakisma uyarisini yok sayar. */
export async function dismissConflict(id: string) {
  await requireSession();
  await prisma.topic.update({ where: { id }, data: { conflicts: undefined } });
  revalidatePath('/konular');
}

export async function deleteTopic(id: string) {
  await requireSession();
  await prisma.topic.delete({ where: { id } });
  revalidatePath('/konular');
}

export async function setTopicPriority(id: string, priority: number) {
  await requireSession();
  await prisma.topic.update({ where: { id }, data: { priority } });
  revalidatePath('/konular');
}

export async function requeueTopic(id: string) {
  await requireSession();
  await prisma.topic.update({
    where: { id },
    data: { status: 'QUEUED', scheduledFor: null, lastError: null },
  });
  revalidatePath('/konular');
}

/** Takvimi elle yeniden hesapla. */
export async function replan(siteId?: string) {
  await requireSession();
  const res = await planSchedule(siteId);
  revalidatePath('/konular');
  revalidatePath('/yazilar');
  revalidatePath('/');
  return res;
}

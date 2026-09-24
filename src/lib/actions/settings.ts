'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { runBackup } from '@/lib/backup';
import { saveBudgetSettings } from '@/lib/budget';
import { saveNotifySettings, sendTestNotification } from '@/lib/notify';
import { saveProviderSettings } from '@/lib/settings';

/**
 * Anahtar alanlari bos birakilirsa mevcut deger korunur.
 * "-" yazilirsa anahtar silinir.
 */
export async function saveSettings(fd: FormData) {
  await requireSession();

  const pick = (k: string): string | undefined => {
    const v = String(fd.get(k) ?? '').trim();
    if (!v) return undefined; // dokunma
    if (v === '-') return ''; // sil
    return v;
  };

  const keys: Record<string, string> = {};
  for (const k of [
    'anthropic',
    'openai',
    'gemini',
    'ideogram',
    'stability',
    'localBaseUrl',
    'localApiKey',
    'localModel',
  ]) {
    const v = pick(k);
    if (v !== undefined) keys[k] = v;
  }

  await saveProviderSettings({
    textProvider: String(fd.get('textProvider') ?? '') || undefined,
    textModel: String(fd.get('textModel') ?? '') || undefined,
    imageProvider: String(fd.get('imageProvider') ?? '') || undefined,
    imageModel: String(fd.get('imageModel') ?? '') || undefined,
    keys,
  });

  revalidatePath('/ayarlar');
}


/** Aylik butce tavani */
export async function saveBudget(fd: FormData) {
  await requireSession();
  await saveBudgetSettings({
    monthlyUsd: Math.max(0, Number(fd.get('monthlyUsd') ?? 0) || 0),
    action: (String(fd.get('action') ?? 'pause') as 'warn' | 'pause') || 'pause',
    warnAt: Math.min(1, Math.max(0.1, Number(fd.get('warnAt') ?? 80) / 100)),
  });
  revalidatePath('/ayarlar');
  revalidatePath('/');
}

/** Bildirim kanallari */
export async function saveNotifications(fd: FormData) {
  await requireSession();

  const token = String(fd.get('telegramToken') ?? '').trim();
  await saveNotifySettings({
    // Bos birakilirsa dokunma, tek tire yazilirsa sil
    telegramToken: token === '' ? undefined : token === '-' ? '' : token,
    telegramChatId: String(fd.get('telegramChatId') ?? '').trim(),
    webhookUrl: String(fd.get('webhookUrl') ?? '').trim(),
    onFailure: fd.get('onFailure') === 'on',
    onBudget: fd.get('onBudget') === 'on',
    onSiteDown: fd.get('onSiteDown') === 'on',
    throttleMinutes: Math.max(1, Number(fd.get('throttleMinutes') ?? 30) || 30),
  });

  revalidatePath('/ayarlar');
}

export async function testNotification() {
  await requireSession();
  await sendTestNotification();
  revalidatePath('/ayarlar');
}

/** Panelden elle veritabani yedegi al. Durum kaydi guncellenir; hata yutulur. */
export async function runBackupNow() {
  await requireSession();
  // runBackup basarisizlikta firlatir ama durumu da kaydeder; panel durumdan okur.
  await runBackup({ trigger: 'manual' }).catch(() => undefined);
  revalidatePath('/ayarlar');
}

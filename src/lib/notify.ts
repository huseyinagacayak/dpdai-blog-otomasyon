import { decrypt, encrypt } from './crypto';
import { prisma } from './db';

const KEY = 'notifications';

export type NotifySettings = {
  /** Telegram bot token (sifreli saklanir) */
  telegramToken?: string;
  telegramChatId?: string;
  /** Slack / Discord / kendi ucunuz - JSON POST edilir */
  webhookUrl?: string;
  /** Bir is son denemesinde de basarisiz olursa bildir */
  onFailure: boolean;
  /** Butce esigi asilinca bildir */
  onBudget: boolean;
  /** Baglanti testi basarisiz olunca bildir */
  onSiteDown: boolean;
  /** Ayni konuda tekrar bildirim gondermeden once beklenecek dakika */
  throttleMinutes: number;
};

const DEFAULTS: NotifySettings = {
  onFailure: true,
  onBudget: true,
  onSiteDown: true,
  throttleMinutes: 30,
};

export async function getNotifySettings(): Promise<NotifySettings> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const v = (row?.value as Record<string, unknown> | undefined) ?? {};
  return {
    telegramToken: decrypt(v.telegramToken as string) ?? process.env.TELEGRAM_BOT_TOKEN ?? undefined,
    telegramChatId: (v.telegramChatId as string) || process.env.TELEGRAM_CHAT_ID || undefined,
    webhookUrl: (v.webhookUrl as string) || process.env.NOTIFY_WEBHOOK_URL || undefined,
    onFailure: v.onFailure !== undefined ? Boolean(v.onFailure) : DEFAULTS.onFailure,
    onBudget: v.onBudget !== undefined ? Boolean(v.onBudget) : DEFAULTS.onBudget,
    onSiteDown: v.onSiteDown !== undefined ? Boolean(v.onSiteDown) : DEFAULTS.onSiteDown,
    throttleMinutes: Number(v.throttleMinutes ?? DEFAULTS.throttleMinutes),
  };
}

export async function saveNotifySettings(input: Partial<NotifySettings>): Promise<void> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const current = (row?.value as Record<string, unknown> | undefined) ?? {};
  const next: Record<string, unknown> = { ...current };

  if (input.telegramToken !== undefined) {
    next.telegramToken = input.telegramToken === '' ? undefined : encrypt(input.telegramToken);
  }
  for (const k of ['telegramChatId', 'webhookUrl'] as const) {
    if (input[k] !== undefined) next[k] = input[k] || undefined;
  }
  for (const k of ['onFailure', 'onBudget', 'onSiteDown'] as const) {
    if (input[k] !== undefined) next[k] = input[k];
  }
  if (input.throttleMinutes !== undefined) next.throttleMinutes = input.throttleMinutes;

  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: next as unknown as object },
    update: { value: next as unknown as object },
  });
}

/* ------------------------------------------------------------------ gonderim */

export type NotifyLevel = 'info' | 'warn' | 'error';

const ICON: Record<NotifyLevel, string> = { info: 'ℹ️', warn: '⚠️', error: '🔴' };

/** Ayni konuda tekrar tekrar bildirim gonderilmesini engeller. */
const THROTTLE_PREFIX = 'notify:last:';

async function throttled(key: string, minutes: number): Promise<boolean> {
  const id = THROTTLE_PREFIX + key;
  const row = await prisma.setting.findUnique({ where: { key: id } });
  const last = row ? Number((row.value as { at?: number }).at ?? 0) : 0;

  if (Date.now() - last < minutes * 60_000) return true;

  await prisma.setting.upsert({
    where: { key: id },
    create: { key: id, value: { at: Date.now() } },
    update: { value: { at: Date.now() } },
  });
  return false;
}

export type NotifyInput = {
  level: NotifyLevel;
  title: string;
  message: string;
  /** Panelde ilgili sayfaya giden yol, ornek: /yazilar/abc */
  path?: string;
  /** Ayni olay icin sabit anahtar - kisitlama bunun uzerinden calisir */
  dedupeKey?: string;
};

/**
 * Yapilandirilmis kanallara bildirim gonderir.
 * Hicbir kanal tanimli degilse sessizce gecer; bildirim hatasi ana isi bozmaz.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const s = await getNotifySettings();

    if (input.dedupeKey && (await throttled(input.dedupeKey, s.throttleMinutes))) return;

    const base = process.env.PANEL_URL?.replace(/\/+$/, '') ?? '';
    const link = input.path ? `${base}${input.path}` : '';
    const text =
      `${ICON[input.level]} *${input.title}*\n${input.message}` + (link ? `\n${link}` : '');

    const jobs: Promise<unknown>[] = [];

    if (s.telegramToken && s.telegramChatId) {
      jobs.push(
        fetch(`https://api.telegram.org/bot${s.telegramToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: s.telegramChatId,
            text,
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
          }),
        }),
      );
    }

    if (s.webhookUrl) {
      jobs.push(
        fetch(s.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Slack ve Discord ikisi de "content"/"text" alanini okur
          body: JSON.stringify({
            text,
            content: text,
            level: input.level,
            title: input.title,
            message: input.message,
            url: link || undefined,
          }),
        }),
      );
    }

    await Promise.allSettled(jobs);
  } catch (e) {
    console.error('[notify] gönderilemedi:', (e as Error).message);
  }
}

/** Ayarlar ekranindaki "test bildirimi gönder" düğmesi için. */
export async function sendTestNotification(): Promise<{ ok: boolean; message: string }> {
  const s = await getNotifySettings();
  const hasChannel = Boolean((s.telegramToken && s.telegramChatId) || s.webhookUrl);
  if (!hasChannel) {
    return { ok: false, message: 'Hiçbir bildirim kanalı tanımlı değil.' };
  }
  await notify({
    level: 'info',
    title: 'Test bildirimi',
    message: 'DPDAI Blog Otomasyon bildirim kanalı çalışıyor.',
    path: '/',
  });
  return { ok: true, message: 'Test bildirimi gönderildi.' };
}

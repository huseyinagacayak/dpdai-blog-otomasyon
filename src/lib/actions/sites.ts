'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { I18nMode, Platform, QualityMode, SiteStatus } from '@prisma/client';
import { requireSession } from '@/lib/auth';
import { encrypt } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { getPublishAdapter } from '@/lib/providers/publish';
import { notify } from '@/lib/notify';
import { refreshSiteIndex } from '@/lib/pipeline/siteIndex';
import { requeue } from '@/lib/queue';

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? '').trim();
}
function num(fd: FormData, key: string, fallback: number): number {
  const v = Number(fd.get(key));
  return Number.isFinite(v) ? v : fallback;
}
function optNum(fd: FormData, key: string): number | null {
  const raw = str(fd, key);
  if (!raw) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}
function bool(fd: FormData, key: string): boolean {
  return fd.get(key) === 'on' || fd.get(key) === 'true';
}
function list(fd: FormData, key: string): string[] {
  return str(fd, key)
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function days(fd: FormData): number[] {
  return fd
    .getAll('publishDays')
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}

/** Form -> Prisma alanlari. Sifre alanlari bos birakilirsa mevcut deger korunur. */
function commonFields(fd: FormData) {
  return {
    name: str(fd, 'name'),
    url: str(fd, 'url').replace(/\/+$/, ''),
    platform: (str(fd, 'platform') || 'WORDPRESS') as Platform,
    status: (str(fd, 'status') || 'ACTIVE') as SiteStatus,
    notes: str(fd, 'notes') || null,

    wpUsername: str(fd, 'wpUsername') || null,
    bridgeUrl: str(fd, 'bridgeUrl') || null,

    defaultLocale: str(fd, 'defaultLocale') || 'tr',
    locales: list(fd, 'locales').length ? list(fd, 'locales') : [str(fd, 'defaultLocale') || 'tr'],
    i18nMode: (str(fd, 'i18nMode') || 'NONE') as I18nMode,
    siblingGroup: str(fd, 'siblingGroup') || null,

    publishDays: days(fd).length ? days(fd) : [1],
    weeklyQuota: Math.max(1, num(fd, 'weeklyQuota', 1)),
    publishHour: Math.min(23, Math.max(0, num(fd, 'publishHour', 9))),
    timezone: str(fd, 'timezone') || 'Europe/Istanbul',

    autoPublish: bool(fd, 'autoPublish'),
    wpPostStatus: str(fd, 'wpPostStatus') || 'draft',
    defaultCategoryId: optNum(fd, 'defaultCategoryId'),
    defaultAuthorId: optNum(fd, 'defaultAuthorId'),
    defaultTags: list(fd, 'defaultTags'),

    brandVoice: str(fd, 'brandVoice') || null,
    audience: str(fd, 'audience') || null,
    extraInstructions: str(fd, 'extraInstructions') || null,
    bannedWords: list(fd, 'bannedWords'),
    internalLinkPolicy: str(fd, 'internalLinkPolicy') || null,
    wordCountMin: Math.max(200, num(fd, 'wordCountMin', 900)),
    wordCountMax: Math.max(300, num(fd, 'wordCountMax', 1600)),

    interlink: bool(fd, 'interlink'),
    qualityMode: (str(fd, 'qualityMode') || 'AUTONOMOUS') as QualityMode,
    minSeoScore: Math.min(100, Math.max(0, num(fd, 'minSeoScore', 82))),
    maxRevisions: Math.min(5, Math.max(0, num(fd, 'maxRevisions', 2))),
    imageQualityCheck: bool(fd, 'imageQualityCheck'),
    maxImageAttempts: Math.min(4, Math.max(1, num(fd, 'maxImageAttempts', 2))),
    imageNegative: str(fd, 'imageNegative') || null,

    preferredTextCredentialId: str(fd, 'preferredTextCredentialId') || null,
    preferredImageCredentialId: str(fd, 'preferredImageCredentialId') || null,
    textModel: str(fd, 'textModel') || null,
    imageModel: str(fd, 'imageModel') || null,
    imageStyle: str(fd, 'imageStyle') || null,
    imageAspect: str(fd, 'imageAspect') || '16:9',
  };
}

export async function createSite(fd: FormData) {
  await requireSession();
  const site = await prisma.site.create({
    data: {
      ...commonFields(fd),
      wpAppPassword: encrypt(str(fd, 'wpAppPassword')),
      bridgeToken: encrypt(str(fd, 'bridgeToken')),
    },
  });
  revalidatePath('/siteler');
  redirect(`/siteler/${site.id}`);
}

export async function updateSite(id: string, fd: FormData) {
  await requireSession();

  const data: Record<string, unknown> = commonFields(fd);
  const pass = str(fd, 'wpAppPassword');
  const token = str(fd, 'bridgeToken');
  if (pass) data.wpAppPassword = encrypt(pass);
  if (token) data.bridgeToken = encrypt(token);

  await prisma.site.update({ where: { id }, data });
  revalidatePath('/siteler');
  revalidatePath(`/siteler/${id}`);
}

/** Baglantiyi test eder ve site yeteneklerini (SEO/dil eklentisi) gunceller. */
export async function testSiteConnection(id: string) {
  await requireSession();
  const site = await prisma.site.findUniqueOrThrow({ where: { id } });

  try {
    const adapter = getPublishAdapter(site);
    const caps = await adapter.discover();

    await prisma.site.update({
      where: { id },
      data: {
        capabilities: caps as unknown as object,
        hasBridge: caps.bridge?.installed ?? false,
        seoPlugin: caps.seoPlugin,
        i18nMode:
          site.i18nMode === 'SIBLING'
            ? 'SIBLING'
            : caps.i18n.mode === 'polylang'
              ? 'POLYLANG'
              : caps.i18n.mode === 'wpml'
                ? 'WPML'
                : site.i18nMode,
        lastCheckAt: new Date(),
        lastCheckOk: caps.reachable,
        lastCheckMsg: caps.message.slice(0, 500),
      },
    });

    // Site sayfa dizinini tazele: WordPress REST + sitemap.xml.
    // Ic linklemenin ilk yazidan itibaren calismasi ve cakisma kontrolunun
    // mevcut icerigi gormesi buna bagli.
    if (caps.reachable) {
      await refreshSiteIndex(id).catch((e) => {
        console.error('[siteIndex]', (e as Error).message);
      });
    }

    if (!caps.reachable) {
      await notify({
        level: 'error',
        title: `Site bağlantısı başarısız: ${site.name}`,
        message: caps.message,
        path: `/siteler/${site.id}`,
        dedupeKey: `site-down-${site.id}`,
      });
    }
  } catch (e) {
    await prisma.site.update({
      where: { id },
      data: {
        lastCheckAt: new Date(),
        lastCheckOk: false,
        lastCheckMsg: (e as Error).message.slice(0, 500),
      },
    });
  }

  revalidatePath(`/siteler/${id}`);
}

/** Site geneli SEO denetimini calistirir (arka planda). */
export async function runAudit(id: string) {
  await requireSession();
  await requeue({ type: 'audit', siteId: id });
  revalidatePath(`/siteler/${id}/seo`);
}

/** Site sayfa dizinini (REST + sitemap) elle tazeler. */
export async function refreshIndex(id: string) {
  await requireSession();
  await refreshSiteIndex(id).catch((e) => {
    console.error('[siteIndex]', (e as Error).message);
  });
  revalidatePath(`/siteler/${id}`);
}

export async function deleteSite(id: string) {
  await requireSession();
  await prisma.site.delete({ where: { id } });
  revalidatePath('/siteler');
  redirect('/siteler');
}

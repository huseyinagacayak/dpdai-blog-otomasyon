import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { prisma } from '@/lib/db';
import { getImageProvider } from '@/lib/providers/image';
import { getVisionProvider, type ImageCheck } from '@/lib/providers/vision';
import { avoidancesFrom, buildImagePrompt, type ImageBrief } from '@/lib/quality/imagePrompt';
import { CONTENT, IMAGE } from '@/lib/quality/standards';
import { composeCover } from './cover';
import { runStep } from './log';

export const STORAGE_DIR = process.env.STORAGE_DIR || path.join(process.cwd(), 'storage');

type TechCheck = {
  ok: boolean;
  width: number;
  height: number;
  bytes: number;
  aspectOk: boolean;
  problems: string[];
};

function expectedRatio(aspect: string): number {
  const [w, h] = aspect.split(':').map(Number);
  return w && h ? w / h : 16 / 9;
}

/** Uretim sonrasi olculebilir kontroller (model cagrisi yok). */
function technicalCheck(
  meta: { width?: number; height?: number },
  bytes: number,
  aspect: string,
): TechCheck {
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const problems: string[] = [];

  if (width < IMAGE.minWidth) {
    problems.push(`Genişlik ${width}px, en az ${IMAGE.minWidth}px olmalı.`);
  }
  const ratio = height ? width / height : 0;
  const want = expectedRatio(aspect);
  const aspectOk = ratio > 0 && Math.abs(ratio - want) / want <= IMAGE.aspectTolerance;
  if (!aspectOk) {
    problems.push(`En-boy oranı ${ratio.toFixed(2)}, hedef ${want.toFixed(2)}.`);
  }
  if (bytes > IMAGE.maxBytes) {
    problems.push(`Dosya ${Math.round(bytes / 1024)} KB, üst sınır ${IMAGE.maxBytes / 1024} KB.`);
  }

  return { ok: problems.length === 0, width, height, bytes, aspectOk, problems };
}

/**
 * One cikan gorseli uretir.
 *
 *   prompt kur -> uret -> WebP'e cevir/kucult -> teknik kontrol
 *   -> (acikse) gorsel denetimi -> gerekirse yeniden dene
 *
 * Siteye yukleme yayin adiminda yapilir; burada yalnizca diske yazilir.
 */
export async function generateFeaturedImage(articleId: string): Promise<void> {
  const article = await prisma.article.findUniqueOrThrow({
    where: { id: articleId },
    include: { site: true },
  });
  const site = article.site;
  const seo = (article.seo ?? {}) as Record<string, unknown>;

  const brief = (seo.imageBrief ?? null) as ImageBrief | null;
  const subject = brief?.subject || article.title;
  let alt = (seo.imageAlt as string) || article.title;
  const caption = (seo.imageCaption as string) || '';

  await prisma.article.update({ where: { id: articleId }, data: { status: 'IMAGING' } });

  await runStep(
    { articleId, siteId: site.id, kind: 'image', step: 'öne-çıkan-görsel' },
    async () => {
      const { provider, model } = await getImageProvider({
        credentialId: site.preferredImageCredentialId,
        model: site.imageModel,
      });
      const vision = site.imageQualityCheck ? await getVisionProvider() : null;
      const aspect = site.imageAspect || '16:9';

      let avoid: string[] = [];
      let best: {
        buffer: Buffer;
        meta: { width?: number; height?: number };
        tech: TechCheck;
        vision: ImageCheck | null;
        prompt: string;
        cost: number;
        attempt: number;
      } | null = null;

      let totalCost = 0;
      const attempts = Math.max(1, site.maxImageAttempts);
      const log: string[] = [];

      for (let attempt = 1; attempt <= attempts; attempt++) {
        const prompt = buildImagePrompt({
          brief,
          fallback: subject,
          styleHint: site.imageStyle,
          negativeHint: site.imageNegative,
          avoid,
        });

        const generated = await provider.generate({ prompt, aspect, model });
        totalCost += generated.costUsd;

        // WebP + hedef genislik: WordPress medya kutuphanesi icin ideal
        const optimized = await sharp(generated.buffer)
          .resize({ width: IMAGE.targetWidth, withoutEnlargement: true })
          .webp({ quality: IMAGE.webpQuality })
          .toBuffer();
        const meta = await sharp(optimized).metadata();

        const tech = technicalCheck(meta, optimized.byteLength, aspect);

        let visionResult: ImageCheck | null = null;
        if (vision) {
          visionResult = await vision
            .check(optimized, 'image/webp', subject, article.locale)
            .catch(() => null);
        }

        const candidate = {
          buffer: optimized,
          meta,
          tech,
          vision: visionResult,
          prompt,
          cost: generated.costUsd,
          attempt,
        };

        const score = candidateScore(candidate);
        log.push(
          `deneme ${attempt}: ${tech.ok ? 'teknik ok' : tech.problems.join(' ')}` +
            (visionResult
              ? ` · görsel denetim ${visionResult.score}${visionResult.pass ? '' : ' (red)'}`
              : ''),
        );

        if (!best || score > candidateScore(best)) best = candidate;

        const acceptable = tech.ok && (!visionResult || visionResult.pass);
        if (acceptable) break;

        // Sonraki denemede ayni hatayi yapmasin
        if (visionResult) avoid = avoidancesFrom(visionResult);
      }

      if (!best) throw new Error('Görsel üretilemedi.');

      // Denetim daha iyi bir alt metin onerdiyse onu kullan
      if (best.vision?.altSuggestion && best.vision.altSuggestion.length <= CONTENT.imageAltMax) {
        alt = best.vision.altSuggestion;
        await prisma.article.update({
          where: { id: articleId },
          data: { seo: { ...seo, imageAlt: alt } as unknown as object },
        });
      }

      // Uretilen/gelen fotoyu markali bir KAPAK gorseline donustur: marka
      // renkli zemin + yan panelde foto + uzerinde BLOG BASLIGI. Boylece gorsel
      // her zaman konuyla alakalidir ve tum yazilarda tutarli durur.
      // FEATURED_COMPOSE=0 ile kapatilip ham foto kullanilabilir.
      let finalBuffer = best.buffer;
      let finalMeta = best.meta;
      if ((process.env.FEATURED_COMPOSE ?? '1') !== '0') {
        try {
          finalBuffer = await composeCover({
            photo: best.buffer,
            title: article.title,
            siteName: site.name,
          });
          finalMeta = await sharp(finalBuffer).metadata();
        } catch (e) {
          // Kapak olusturulamazsa ham foto ile devam et
          log.push(`kapak olusturulamadi: ${(e as Error).message}`);
        }
      }

      const dir = path.join(STORAGE_DIR, 'images', article.siteId);
      await mkdir(dir, { recursive: true });
      const filename = `${article.slug || article.id}-${article.locale}.webp`;
      const filePath = path.join(dir, filename);
      await writeFile(filePath, finalBuffer);

      await prisma.mediaAsset.deleteMany({ where: { articleId, role: 'FEATURED' } });
      await prisma.mediaAsset.create({
        data: {
          articleId,
          role: 'FEATURED',
          prompt: best.prompt,
          provider: provider.name,
          model,
          localPath: path.relative(STORAGE_DIR, filePath).split(path.sep).join('/'),
          mimeType: 'image/webp',
          width: finalMeta.width ?? null,
          height: finalMeta.height ?? null,
          bytes: finalBuffer.byteLength,
          alt,
          caption,
          title: article.title,
          attempts: best.attempt,
          checks: {
            technical: best.tech,
            vision: best.vision,
            log,
          } as unknown as object,
          costUsd: totalCost,
        },
      });

      await prisma.article.update({
        where: { id: articleId },
        data: { costUsd: { increment: totalCost } },
      });

      const verdict =
        best.tech.ok && (!best.vision || best.vision.pass)
          ? 'kabul'
          : 'en iyi deneme kullanıldı';

      return {
        result: null,
        costUsd: totalCost,
        message:
          `${provider.name}/${model} · ${best.meta.width}×${best.meta.height} · ` +
          `${Math.round(best.buffer.byteLength / 1024)} KB · ${best.attempt} deneme · ${verdict}`,
      };
    },
  );
}

/** Teknik + gorsel denetimi tek sayiya indirger; en iyi denemeyi secmek icin. */
function candidateScore(c: {
  tech: TechCheck;
  vision: ImageCheck | null;
}): number {
  let s = c.vision?.score ?? 70;
  if (!c.tech.ok) s -= 15;
  if (c.vision?.hasText) s -= 40;
  if (c.vision?.hasWatermark) s -= 30;
  if (c.vision && !c.vision.relevant) s -= 35;
  s -= (c.vision?.artifacts.length ?? 0) * 5;
  return s;
}

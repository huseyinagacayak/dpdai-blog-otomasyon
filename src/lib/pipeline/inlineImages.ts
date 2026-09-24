import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import sharp from 'sharp';
import { prisma } from '@/lib/db';
import { getImageProvider } from '@/lib/providers/image';
import { buildImagePrompt } from '@/lib/quality/imagePrompt';
import { CONTENT, IMAGE } from '@/lib/quality/standards';
import { STORAGE_DIR } from './image';
import { runStep } from './log';

/**
 * Govde ici (INLINE) gorseller.
 *
 * One cikan gorselden AYRI olarak, yazinin govdesine 1-2 gorsel uretip
 * bolum basliklarinin altina yerlestirir. Kalite dongusu ve iç linkleme
 * bittikten SONRA, gorsel isinde calisir; boylece metin yeniden yazilsa
 * bile bu gorseller son govdeye eklenir.
 *
 * Gorsel yerelde /api/media/<yol> ile onizlenir; yayin adiminda WordPress'e
 * yuklenip govdedeki adres gercek medya adresiyle degistirilir (publish.ts).
 */

/** Kac inline gorsel uretilecek: bolum sayisina gore 0-2, env ile override. */
function desiredCount(sectionCount: number): number {
  const env = process.env.INLINE_IMAGE_COUNT;
  if (env !== undefined) return Math.max(0, Math.min(3, parseInt(env, 10) || 0));
  if (sectionCount >= 5) return 2;
  if (sectionCount >= 3) return 1;
  return 0;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function insertInlineImages(articleId: string): Promise<void> {
  const article = await prisma.article.findUniqueOrThrow({
    where: { id: articleId },
    include: { site: true },
  });
  const site = article.site;
  if (!article.contentHtml) return;

  const $ = cheerio.load(article.contentHtml, null, false);

  // ONCEKI inline figurleri temizle: gorsel isi tekrar calisirsa (yeniden uret,
  // yeniden gorsel) yenileri eskilerin ustune eklenip govde ikiye/uce katlanmasin.
  $('figure').each((_, el) => {
    const $f = $(el);
    if ($f.hasClass('dpdai-inline') || $f.find('img[src*="-inline-"]').length > 0) {
      $f.remove();
    }
  });

  // SSS / Sonuç / Kaynak gibi bolumlere gorsel koyma; asil icerik bolumlerini sec
  const targets = $('h2')
    .toArray()
    .filter((el) => {
      const t = $(el).text().toLocaleLowerCase('tr-TR');
      return !/(sık sorulan|sss|sonuç|kaynak|referans|örnek vaka)/.test(t);
    });

  const count = desiredCount(targets.length);
  if (count === 0 || targets.length < 2) return;

  // Ekleme noktalarini govdeye yay (ilk bolumu atla, ortalara koy)
  const picks: number[] = [];
  const step = Math.max(1, Math.floor(targets.length / (count + 1)));
  for (let i = 1; i <= count; i++) {
    const idx = Math.min(targets.length - 1, i * step);
    if (idx >= 1 && !picks.includes(idx)) picks.push(idx);
  }
  if (picks.length === 0) return;

  await runStep(
    { articleId, siteId: site.id, kind: 'image', step: 'gövde-görseli' },
    async () => {
      const { provider, model } = await getImageProvider({
        credentialId: site.preferredImageCredentialId,
        model: site.imageModel,
      });
      const aspect = site.imageAspect || '16:9';

      // Yeniden uretimde birikmesin: onceki inline gorselleri sil
      await prisma.mediaAsset.deleteMany({ where: { articleId, role: 'INLINE' } });

      const dir = path.join(STORAGE_DIR, 'images', article.siteId);
      await mkdir(dir, { recursive: true });

      let totalCost = 0;
      const created: { el: (typeof targets)[number]; localPath: string; alt: string; w: number | null }[] =
        [];

      for (const idx of picks) {
        const el = targets[idx];
        const heading = $(el).text().trim();
        try {
          const prompt = buildImagePrompt({
            brief: { subject: heading, setting: '', mood: '', composition: '' },
            fallback: heading,
            styleHint: site.imageStyle,
            negativeHint: site.imageNegative,
            avoid: [],
          });

          const gen = await provider.generate({ prompt, aspect, model });
          totalCost += gen.costUsd;

          const optimized = await sharp(gen.buffer)
            .resize({ width: IMAGE.targetWidth, withoutEnlargement: true })
            .webp({ quality: IMAGE.webpQuality })
            .toBuffer();
          const meta = await sharp(optimized).metadata();

          const filename = `${article.slug || article.id}-inline-${idx}-${article.locale}.webp`;
          const filePath = path.join(dir, filename);
          await writeFile(filePath, optimized);
          const localPath = path.relative(STORAGE_DIR, filePath).split(path.sep).join('/');
          const alt = heading.slice(0, CONTENT.imageAltMax);

          await prisma.mediaAsset.create({
            data: {
              articleId,
              role: 'INLINE',
              prompt,
              provider: provider.name,
              model,
              localPath,
              mimeType: 'image/webp',
              width: meta.width ?? null,
              height: meta.height ?? null,
              bytes: optimized.byteLength,
              alt,
              caption: '',
              title: heading,
              attempts: 1,
              costUsd: gen.costUsd,
            },
          });

          created.push({ el, localPath, alt, w: meta.width ?? null });
        } catch (e) {
          console.error('[inlineImages] üretilemedi:', heading, (e as Error).message);
        }
      }

      if (created.length === 0) throw new Error('Gövde görseli üretilemedi.');

      // Gorselleri DOM'a yerlestir: basligi izleyen ilk paragraftan sonra
      for (const c of created) {
        const fig =
          `<figure class="dpdai-inline"><img src="/api/media/${c.localPath}" alt="${escapeAttr(c.alt)}"` +
          `${c.w ? ` width="${c.w}"` : ''} loading="lazy" /></figure>`;
        const $h2 = $(c.el);
        const $firstP = $h2.nextUntil('h2, h3').filter('p').first();
        if ($firstP.length) $firstP.after(fig);
        else $h2.after(fig);
      }

      await prisma.article.update({
        where: { id: articleId },
        data: { contentHtml: $.html(), costUsd: { increment: totalCost } },
      });

      return {
        result: null,
        costUsd: totalCost,
        message: `${created.length} görsel · ${provider.name}/${model}`,
      };
    },
  );
}

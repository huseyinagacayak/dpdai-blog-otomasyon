import { IMAGE_NEGATIVE, IMAGE_QUALITY } from './standards';

export type ImageBrief = {
  subject?: string;
  setting?: string;
  mood?: string;
  composition?: string;
};

/** Marka gorunumu icin hazir stil onayarlari */
export const IMAGE_STYLE_PRESETS: { id: string; label: string; prompt: string }[] = [
  {
    id: 'editorial',
    label: 'Editoryal fotoğraf',
    prompt:
      'documentary editorial photograph, 35mm lens, soft natural window light, ' +
      'true-to-life colors, candid unposed moment',
  },
  {
    id: 'clean-studio',
    label: 'Temiz stüdyo',
    prompt:
      'clean studio photograph, seamless neutral background, soft diffused key light, ' +
      'subtle shadow, product-photography precision',
  },
  {
    id: 'warm-lifestyle',
    label: 'Sıcak yaşam tarzı',
    prompt:
      'warm lifestyle photograph, golden hour light, cozy inviting atmosphere, ' +
      'shallow depth of field, gentle film grain',
  },
  {
    id: 'modern-tech',
    label: 'Modern teknoloji',
    prompt:
      'modern technology photograph, cool neutral palette with a single accent color, ' +
      'clean geometry, controlled reflections, minimal set design',
  },
  {
    id: 'flat-illustration',
    label: 'Düz illüstrasyon',
    prompt:
      'flat vector illustration, limited harmonious palette, simple geometric shapes, ' +
      'generous negative space, no gradients, no text',
  },
  {
    id: 'isometric',
    label: 'İzometrik',
    prompt:
      'isometric 3d illustration, soft clay-like materials, pastel palette, ' +
      'soft ambient occlusion, clean composition',
  },
];

/**
 * Gorsel prompt'unu tek yerden kurar.
 *
 * Sira onemlidir: once konu, sonra ortam/ruh hali, sonra kadraj,
 * sonra marka stili, en sonda teknik kalite ve olumsuzlar.
 * Cogu gorsel modeli prompt'un basindaki ifadelere daha cok agirlik verir.
 */
export function buildImagePrompt(opts: {
  brief?: ImageBrief | null;
  /** brief yoksa kullanilacak yedek metin (yazi basligi) */
  fallback: string;
  /** site.imageStyle - hazir onayar id'si veya serbest metin olabilir */
  styleHint?: string | null;
  /** siteye ozel ek olumsuz prompt */
  negativeHint?: string | null;
  /** onceki denemede tespit edilen sorunlar - tekrar etmemesi icin */
  avoid?: string[];
}): string {
  const b = opts.brief ?? {};

  const preset = IMAGE_STYLE_PRESETS.find((p) => p.id === opts.styleHint);
  const style = preset ? preset.prompt : opts.styleHint?.trim();

  const parts = [
    b.subject?.trim() || opts.fallback.trim(),
    b.setting?.trim(),
    b.mood?.trim(),
    b.composition?.trim(),
    style,
    IMAGE_QUALITY,
  ].filter(Boolean);

  const negatives = [IMAGE_NEGATIVE, opts.negativeHint?.trim(), ...(opts.avoid ?? [])]
    .filter(Boolean)
    .join(', ');

  return `${parts.join('. ')}. Avoid: ${negatives}.`;
}

/** Gorsel denetimi basarisiz olunca bir sonraki denemeye eklenecek uyarilar */
export function avoidancesFrom(check: {
  hasText?: boolean;
  hasWatermark?: boolean;
  artifacts?: string[];
  relevant?: boolean;
}): string[] {
  const out: string[] = [];
  if (check.hasText) out.push('absolutely no text, letters, numbers or signage anywhere');
  if (check.hasWatermark) out.push('absolutely no watermark, stamp or signature');
  if (check.relevant === false) out.push('the image must literally depict the stated subject');
  for (const a of check.artifacts ?? []) out.push(`avoid ${a}`);
  return out;
}

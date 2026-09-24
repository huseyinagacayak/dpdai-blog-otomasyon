import {
  resolveChain,
  runWithFallback,
  type ResolvedCredential,
} from '@/lib/providers/pool';
import {
  CloudflareImageProvider,
  HuggingFaceImageProvider,
  PollinationsProvider,
} from './free';
import { GeminiImageProvider } from './gemini';
import { IdeogramImageProvider } from './ideogram';
import { OpenAIImageProvider } from './openai';
import { OpenRouterImageProvider } from './openrouter';
import { StabilityImageProvider } from './stability';
import type { ImageProvider, ImageRequest, ImageResult } from './types';

export * from './types';

/** Tek bir havuz girisinden calisir bir gorsel saglayicisi kurar. */
export function buildImageProvider(c: ResolvedCredential): ImageProvider {
  const model = c.model || '';
  const extra = (c.extra ?? {}) as Record<string, string>;

  switch (c.provider) {
    case 'openai':
      return new OpenAIImageProvider(c.apiKeyPlain ?? '', model || 'gpt-image-1');
    case 'openrouter':
      return new OpenRouterImageProvider(
        c.apiKeyPlain ?? '',
        model || 'google/gemini-2.5-flash-image-preview',
      );
    case 'gemini':
      return new GeminiImageProvider(c.apiKeyPlain ?? '', model || 'gemini-2.5-flash-image');
    case 'ideogram':
      return new IdeogramImageProvider(c.apiKeyPlain ?? '', model || 'V_3');
    case 'stability':
      return new StabilityImageProvider(c.apiKeyPlain ?? '', model || 'core');
    case 'pollinations':
      return new PollinationsProvider(model || 'flux');
    case 'cloudflare':
      return new CloudflareImageProvider(
        c.apiKeyPlain ?? '',
        extra.accountId ?? '',
        model || '@cf/black-forest-labs/flux-1-schnell',
      );
    case 'huggingface':
      return new HuggingFaceImageProvider(
        c.apiKeyPlain ?? '',
        model || 'black-forest-labs/FLUX.1-schnell',
      );
    default:
      throw new Error(`Bilinmeyen görsel sağlayıcısı: ${c.provider}`);
  }
}

/**
 * Havuzdaki gorsel saglayicilarini sirayla deneyen saglayici.
 * Cagiran kod tek bir ImageProvider gormeye devam eder.
 */
class PooledImageProvider implements ImageProvider {
  readonly name = 'havuz';

  constructor(
    private chain: ResolvedCredential[],
    private overrideModel?: string | null,
  ) {}

  async generate(req: ImageRequest): Promise<ImageResult> {
    const { result, credential } = await runWithFallback('IMAGE', this.chain, async (cred) => {
      const provider = buildImageProvider(cred);
      const res = await provider.generate({
        ...req,
        model: this.overrideModel || cred.model || req.model,
      });
      return { result: res, costUsd: cred.free ? 0 : res.costUsd };
    });

    return {
      ...result,
      provider: credential.label,
      costUsd: credential.free ? 0 : result.costUsd,
    };
  }
}

export async function getImageProvider(override?: {
  credentialId?: string | null;
  model?: string | null;
}): Promise<{ provider: ImageProvider; model: string }> {
  const chain = await resolveChain({
    kind: 'IMAGE',
    preferredId: override?.credentialId,
  });

  const model = override?.model || chain[0]?.model || '';
  return { provider: new PooledImageProvider(chain, override?.model), model };
}

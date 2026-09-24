import {
  resolveChain,
  runWithFallback,
  type ResolvedCredential,
} from '@/lib/providers/pool';
import { AnthropicProvider } from './anthropic';
import { OpenAICompatibleProvider } from './openai';
import type { TextProvider, TextRequest, TextResult } from './types';

export * from './types';

/** Tek bir havuz girisinden calisir bir saglayici kurar. */
export function buildTextProvider(c: ResolvedCredential): TextProvider {
  const model = c.model || '';

  switch (c.provider) {
    case 'anthropic':
      return new AnthropicProvider(c.apiKeyPlain ?? '', model || 'claude-sonnet-5');

    case 'openai':
      return new OpenAICompatibleProvider({
        apiKey: c.apiKeyPlain ?? '',
        defaultModel: model || 'gpt-5-mini',
      });

    case 'openai-compatible':
      return new OpenAICompatibleProvider({
        // Yerel sunucular anahtar istemeyebilir
        apiKey: c.apiKeyPlain ?? 'yerel',
        baseURL: c.baseUrl ?? undefined,
        defaultModel: model,
        name: c.label,
      });

    default:
      throw new Error(`Bilinmeyen metin sağlayıcısı: ${c.provider}`);
  }
}

/**
 * Havuzdaki tum metin saglayicilarini sirayla deneyen saglayici.
 *
 * Cagiran kod acisindan tek bir TextProvider gibi davranir; yedege gecis
 * iceride olur. Boylece generate/quality/translate/interlink dosyalari
 * degismeden calisir.
 */
class PooledTextProvider implements TextProvider {
  readonly name = 'havuz';

  constructor(
    private chain: ResolvedCredential[],
    private overrideModel?: string | null,
  ) {}

  async complete(req: TextRequest): Promise<TextResult> {
    const { result, credential, attempts } = await runWithFallback(
      'TEXT',
      this.chain,
      async (cred) => {
        const provider = buildTextProvider(cred);
        const res = await provider.complete({
          ...req,
          // Her girisin kendi modeli var; site override'i yalnizca ilk girise uygulanir
          model: this.overrideModel || cred.model || req.model,
        });
        return { result: res, costUsd: cred.free ? 0 : res.costUsd };
      },
    );

    return {
      ...result,
      provider: credential.label,
      costUsd: credential.free ? 0 : result.costUsd,
      // Yedege gecildiyse cagiran taraf bilsin
      fallbackFrom: attempts.length ? attempts.map((a) => a.label) : undefined,
    };
  }
}

/**
 * Metin saglayicisini dondurur.
 *
 * @param override Site kartindaki tercih (havuzdaki bir girisi one alir;
 *                 zincir yine yedek olarak calisir).
 */
export async function getTextProvider(override?: {
  credentialId?: string | null;
  model?: string | null;
  /** Yalnizca gorsel destekleyen girisler */
  visionOnly?: boolean;
}): Promise<{ provider: TextProvider; model: string }> {
  const chain = await resolveChain({
    kind: 'TEXT',
    preferredId: override?.credentialId,
    visionOnly: override?.visionOnly,
  });

  const model = override?.model || chain[0]?.model || '';
  return { provider: new PooledTextProvider(chain, override?.model), model };
}

/** Modelden JSON cikti alir, kod bloğu sarmalayicilarini temizler. */
export function parseJson<T>(raw: string): T {
  let t = raw.trim();
  if (t.startsWith('```')) {
    t = t
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();
  }
  const first = t.indexOf('{');
  const firstArr = t.indexOf('[');
  const start = firstArr !== -1 && (first === -1 || firstArr < first) ? firstArr : first;
  const last = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (start !== -1 && last !== -1) t = t.slice(start, last + 1);
  return JSON.parse(t) as T;
}

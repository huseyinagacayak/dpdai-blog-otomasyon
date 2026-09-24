import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { parseJson } from '@/lib/providers/text';
import {
  resolveChain,
  runWithFallback,
  type ResolvedCredential,
} from '@/lib/providers/pool';

export type ImageCheck = {
  /** Genel gecer/kal karari */
  pass: boolean;
  /** 0-100 gorsel kalite puani */
  score: number;
  hasText: boolean;
  hasWatermark: boolean;
  /** Gorsel konuyla ilgili mi */
  relevant: boolean;
  /** Bozuk el, fazla parmak, garip yuz gibi kusurlar */
  artifacts: string[];
  /** Modelin onerdigi alt metin (daha iyi ise kullanilir) */
  altSuggestion?: string;
  notes: string;
};

export interface VisionProvider {
  readonly name: string;
  check(buffer: Buffer, mimeType: string, subject: string, locale: string): Promise<ImageCheck>;
}

const CRITERIA = `Bu görsel bir blog yazısının öne çıkan görseli olarak kullanılacak.
Şunları kontrol et:
1. Görselde herhangi bir yazı, harf, rakam, tabela veya altyazı var mı? (olmamalı)
2. Filigran, imza, damga veya stok fotoğraf logosu var mı? (olmamalı)
3. Görsel belirtilen konuyu gerçekten gösteriyor mu?
4. Anatomik bozukluk var mı (bozuk el, fazla parmak, garip yüz, eğri nesne)?
5. Genel görsel kalite: kompozisyon, ışık, netlik, doğallık.

Katı ol ama adil ol. Küçük bir kusur için reddetme; okuyucunun fark edeceği
bir sorun varsa reddet.`;

function schemaBlock(locale: string): string {
  return `Şu JSON şemasında yanıt ver:
{
  "pass": true/false,
  "score": 0-100 arası tam sayı,
  "hasText": true/false,
  "hasWatermark": true/false,
  "relevant": true/false,
  "artifacts": ["tespit edilen kusurlar, yoksa boş dizi"],
  "altSuggestion": "görseli betimleyen alt metin (${locale} dilinde, en fazla 125 karakter)",
  "notes": "tek cümlelik değerlendirme"
}`;
}

/* --------------------------------------------------------------- anthropic */

class AnthropicVision implements VisionProvider {
  readonly name = 'anthropic';
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    if (!apiKey) throw new Error('Anthropic API anahtarı tanımlı değil.');
    this.client = new Anthropic({ apiKey });
  }

  async check(buffer: Buffer, mimeType: string, subject: string, locale: string) {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 1200,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
                data: buffer.toString('base64'),
              },
            },
            { type: 'text', text: `${CRITERIA}\n\nKONU: ${subject}\n\n${schemaBlock(locale)}` },
          ],
        },
      ],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return normalize(parseJson<Partial<ImageCheck>>(text));
  }
}

/* ------------------------------------------------------------------ openai */

class OpenAIVision implements VisionProvider {
  readonly name = 'openai';
  private client: OpenAI;

  constructor(
    apiKey: string,
    private model: string,
    baseURL?: string,
  ) {
    if (!apiKey && !baseURL) throw new Error('OpenAI API anahtarı tanımlı değil.');
    this.client = new OpenAI({ apiKey: apiKey || 'yerel', baseURL });
  }

  async check(buffer: Buffer, mimeType: string, subject: string, locale: string) {
    const res = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      max_completion_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${buffer.toString('base64')}` },
            },
            { type: 'text', text: `${CRITERIA}\n\nKONU: ${subject}\n\n${schemaBlock(locale)}` },
          ],
        },
      ],
    });

    return normalize(parseJson<Partial<ImageCheck>>(res.choices[0]?.message?.content ?? '{}'));
  }
}

/* ----------------------------------------------------------------- fabrika */

function normalize(raw: Partial<ImageCheck>): ImageCheck {
  const score = typeof raw.score === 'number' ? Math.max(0, Math.min(100, raw.score)) : 70;
  const hasText = raw.hasText === true;
  const hasWatermark = raw.hasWatermark === true;
  const relevant = raw.relevant !== false;
  const artifacts = Array.isArray(raw.artifacts) ? raw.artifacts.filter(Boolean) : [];

  // Model "pass" dese bile metin/filigran varsa gecirmeyiz
  const pass = raw.pass !== false && !hasText && !hasWatermark && relevant && score >= 60;

  return {
    pass,
    score,
    hasText,
    hasWatermark,
    relevant,
    artifacts,
    altSuggestion: typeof raw.altSuggestion === 'string' ? raw.altSuggestion : undefined,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
  };
}

function build(c: ResolvedCredential): VisionProvider {
  switch (c.provider) {
    case 'anthropic':
      return new AnthropicVision(c.apiKeyPlain ?? '', c.model || 'claude-sonnet-5');
    case 'openai':
      return new OpenAIVision(c.apiKeyPlain ?? '', c.model || 'gpt-5-mini');
    case 'openai-compatible':
      return new OpenAIVision(
        c.apiKeyPlain ?? 'yerel',
        c.model || '',
        c.baseUrl ?? undefined,
      );
    default:
      throw new Error(`${c.provider} görsel denetimini desteklemiyor.`);
  }
}

/** Havuzdaki gorme yetenekli metin girislerini sirayla deneyen denetci. */
class PooledVision implements VisionProvider {
  readonly name = 'havuz';
  constructor(private chain: ResolvedCredential[]) {}

  async check(buffer: Buffer, mimeType: string, subject: string, locale: string) {
    const { result } = await runWithFallback('TEXT', this.chain, async (cred) => {
      const provider = build(cred);
      return { result: await provider.check(buffer, mimeType, subject, locale) };
    });
    return result;
  }
}

/**
 * Gorsel denetimi icin saglayici dondurur.
 * Havuzda "görsel denetimi yapabilir" isaretli metin girisi yoksa null doner;
 * bu durumda denetim atlanir ve yalnizca teknik kontroller calisir.
 */
export async function getVisionProvider(): Promise<VisionProvider | null> {
  const chain = (await resolveChain({ kind: 'TEXT', visionOnly: true })).filter((c) =>
    ['anthropic', 'openai', 'openai-compatible'].includes(c.provider),
  );

  if (chain.length === 0) return null;
  return new PooledVision(chain);
}

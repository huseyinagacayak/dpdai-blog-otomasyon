import { aspectToSize, type ImageProvider, type ImageRequest, type ImageResult } from './types';

/** gpt-image-1 kalite -> yaklasik maliyet (USD) */
const COST: Record<string, number> = { low: 0.02, medium: 0.07, high: 0.19 };

/** OpenAI Images API (gpt-image-1) */
export class OpenAIImageProvider implements ImageProvider {
  readonly name = 'openai';

  constructor(
    private apiKey: string,
    private defaultModel = 'gpt-image-1',
  ) {
    if (!apiKey) throw new Error('OpenAI API anahtari tanimli degil (Ayarlar > Saglayicilar).');
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const model = req.model || this.defaultModel;
    const { w, h } = aspectToSize(req.aspect);
    // gpt-image-1 yalnizca sabit boyutlar kabul eder
    const size = w === h ? '1024x1024' : w > h ? '1536x1024' : '1024x1536';

    // Kalite hiz/maliyet dengesi: "high" en yavas ve en pahali; "medium" varsayilan.
    // OPENAI_IMAGE_QUALITY ile degistirilebilir (low | medium | high).
    const q = (process.env.OPENAI_IMAGE_QUALITY || 'medium').toLowerCase();
    const quality = q === 'low' || q === 'high' ? q : 'medium';

    // Zaman asimi: aski kalirsa is 10 dk slot kilitlemesin, hata verip yedege gecsin.
    const timeoutMs = Number(process.env.IMAGE_TIMEOUT_MS || 150_000);

    const res = await fetchWithTimeout(
      'https://api.openai.com/v1/images/generations',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, prompt: req.prompt, size, n: 1, quality }),
      },
      timeoutMs,
      'OpenAI görsel',
    );

    if (!res.ok) throw new Error(`OpenAI gorsel hatasi ${res.status}: ${await res.text()}`);

    const json = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
    const item = json.data?.[0];
    if (!item) throw new Error('OpenAI gorsel dondurmedi.');

    let buffer: Buffer;
    if (item.b64_json) {
      buffer = Buffer.from(item.b64_json, 'base64');
    } else if (item.url) {
      const dl = await fetchWithTimeout(item.url, {}, timeoutMs, 'OpenAI görsel indirme');
      buffer = Buffer.from(await dl.arrayBuffer());
    } else {
      throw new Error('OpenAI gorsel verisi bos.');
    }

    return { buffer, mimeType: 'image/png', provider: this.name, model, costUsd: COST[quality] };
  }
}

/** Zaman asimli fetch: sure asilirsa acik bir hata firlatir (aski kalmaz). */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new Error(`${label} zaman aşımı (${Math.round(timeoutMs / 1000)}s)`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

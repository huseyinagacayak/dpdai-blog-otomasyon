import type { ImageProvider, ImageRequest, ImageResult } from './types';

/**
 * OpenRouter uzerinden gorsel uretimi.
 *
 * OpenRouter, gorsel ureten cok-kipli modelleri (ornek: Google Gemini
 * "nano banana" - google/gemini-2.5-flash-image-preview) STANDART gorsel
 * ucundan degil, SOHBET ucundan sunar: istekte modalities:["image","text"]
 * gonderilir, gorsel yanit mesajinin "images" alaninda base64 data URL olarak
 * doner. Bu adaptor o sekli cozer.
 */
export class OpenRouterImageProvider implements ImageProvider {
  readonly name = 'openrouter';

  constructor(
    private apiKey: string,
    private defaultModel = 'google/gemini-2.5-flash-image-preview',
  ) {
    if (!apiKey) throw new Error('OpenRouter API anahtari tanimli degil (Ayarlar > Saglayicilar).');
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const model = req.model || this.defaultModel;
    const aspect = req.aspect || '16:9';
    const timeoutMs = Number(process.env.IMAGE_TIMEOUT_MS || 150_000);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          // OpenRouter'in istege bagli tanimlama basliklari
          'HTTP-Referer': process.env.PANEL_URL || 'https://dpdai.local',
          'X-Title': 'DPDAI Blog Otomasyon',
        },
        body: JSON.stringify({
          model,
          modalities: ['image', 'text'],
          messages: [
            {
              role: 'user',
              content: `${req.prompt}\n\n(Yatay ${aspect} en-boy oranında tek bir görsel üret.)`,
            },
          ],
        }),
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        throw new Error(`OpenRouter görsel zaman aşımı (${Math.round(timeoutMs / 1000)}s)`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw new Error(`OpenRouter gorsel hatasi ${res.status}: ${await res.text()}`);

    type ImgPart = { image_url?: { url?: string }; type?: string };
    type Msg = {
      images?: ImgPart[];
      content?: string | ImgPart[];
    };
    const json = (await res.json()) as { choices?: { message?: Msg }[] };
    const msg = json.choices?.[0]?.message;

    // Once mesajin "images" alani, yoksa content icindeki gorsel parcalari
    const dataUrl =
      msg?.images?.find((i) => i.image_url?.url)?.image_url?.url ??
      (Array.isArray(msg?.content)
        ? msg?.content.find((c) => c.image_url?.url)?.image_url?.url
        : undefined);

    if (!dataUrl) throw new Error('OpenRouter gorsel dondurmedi.');

    // data:image/png;base64,XXXX  ->  buffer
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl.trim());
    if (!m) throw new Error('OpenRouter görsel verisi beklenen biçimde değil.');

    return {
      buffer: Buffer.from(m[2], 'base64'),
      mimeType: m[1] || 'image/png',
      provider: this.name,
      model,
      costUsd: 0.03,
    };
  }
}

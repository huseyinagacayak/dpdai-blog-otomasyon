import { aspectToSize, type ImageProvider, type ImageRequest, type ImageResult } from './types';

async function withTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------- pollinations */

/**
 * Pollinations - anahtar istemeyen ucretsiz gorsel servisi.
 * Zincirin sonunda "hicbir sey calismazsa bari bu" yedegi olarak iyidir.
 */
export class PollinationsProvider implements ImageProvider {
  readonly name = 'pollinations';

  constructor(private defaultModel = 'flux') {}

  async generate(req: ImageRequest): Promise<ImageResult> {
    const model = req.model || this.defaultModel;
    const { w, h } = aspectToSize(req.aspect);

    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(req.prompt.slice(0, 1500))}` +
      `?width=${w}&height=${h}&model=${encodeURIComponent(model)}&nologo=true&enhance=false`;

    // Kuyrukta bekleyebiliyor, cömert zaman asimi veriyoruz
    const res = await withTimeout(url, { headers: { Accept: 'image/*' } }, 120_000);
    if (!res.ok) {
      throw Object.assign(new Error(`Pollinations ${res.status}: ${await res.text()}`), {
        status: res.status,
      });
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength < 1024) throw new Error('Pollinations boş görsel döndürdü.');

    return {
      buffer,
      mimeType: res.headers.get('content-type') || 'image/jpeg',
      provider: this.name,
      model,
      costUsd: 0,
    };
  }
}

/* -------------------------------------------------------------- cloudflare */

/** Cloudflare Workers AI - gunluk ucretsiz kota ile FLUX schnell */
export class CloudflareImageProvider implements ImageProvider {
  readonly name = 'cloudflare';

  constructor(
    private apiToken: string,
    private accountId: string,
    private defaultModel = '@cf/black-forest-labs/flux-1-schnell',
  ) {
    if (!apiToken) throw new Error('Cloudflare API token tanımlı değil.');
    if (!accountId) throw new Error('Cloudflare hesap kimliği (Account ID) tanımlı değil.');
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const model = req.model || this.defaultModel;
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${model}`;

    const res = await withTimeout(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: req.prompt.slice(0, 2000), steps: 6 }),
      },
      90_000,
    );

    const text = await res.text();
    if (!res.ok) {
      throw Object.assign(new Error(`Cloudflare ${res.status}: ${text.slice(0, 300)}`), {
        status: res.status,
      });
    }

    // Yanit ya JSON (base64) ya da dogrudan ikili veri olabilir
    let b64: string | undefined;
    try {
      const json = JSON.parse(text) as {
        success?: boolean;
        result?: { image?: string };
        errors?: { message: string }[];
      };
      if (json.success === false) {
        throw new Error(json.errors?.map((e) => e.message).join(', ') || 'bilinmeyen hata');
      }
      b64 = json.result?.image;
    } catch (e) {
      if (e instanceof Error && e.message !== 'Unexpected token') {
        // JSON degilse ham veri olabilir; asagida ele alinir
      }
    }

    const buffer = b64 ? Buffer.from(b64, 'base64') : Buffer.from(text, 'binary');
    if (buffer.byteLength < 1024) throw new Error('Cloudflare boş görsel döndürdü.');

    return { buffer, mimeType: 'image/png', provider: this.name, model, costUsd: 0 };
  }
}

/* ------------------------------------------------------------ huggingface */

/** Hugging Face Inference API - ucretsiz kota */
export class HuggingFaceImageProvider implements ImageProvider {
  readonly name = 'huggingface';

  constructor(
    private apiKey: string,
    private defaultModel = 'black-forest-labs/FLUX.1-schnell',
  ) {
    if (!apiKey) throw new Error('Hugging Face token tanımlı değil.');
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const model = req.model || this.defaultModel;
    const { w, h } = aspectToSize(req.aspect);

    const res = await withTimeout(
      `https://api-inference.huggingface.co/models/${model}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'image/png',
          // Model soguksa yuklenmesini bekle
          'x-wait-for-model': 'true',
        },
        body: JSON.stringify({
          inputs: req.prompt.slice(0, 2000),
          parameters: { width: w, height: h },
        }),
      },
      180_000,
    );

    if (!res.ok) {
      throw Object.assign(
        new Error(`Hugging Face ${res.status}: ${(await res.text()).slice(0, 300)}`),
        { status: res.status },
      );
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength < 1024) throw new Error('Hugging Face boş görsel döndürdü.');

    return {
      buffer,
      mimeType: res.headers.get('content-type') || 'image/png',
      provider: this.name,
      model,
      costUsd: 0,
    };
  }
}

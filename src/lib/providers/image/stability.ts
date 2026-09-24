import type { ImageProvider, ImageRequest, ImageResult } from './types';

/** Stability AI - Stable Image (core / ultra / sd3) */
export class StabilityImageProvider implements ImageProvider {
  readonly name = 'stability';

  constructor(
    private apiKey: string,
    private defaultModel = 'core',
  ) {
    if (!apiKey) throw new Error('Stability API anahtari tanimli degil (Ayarlar > Saglayicilar).');
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const model = req.model || this.defaultModel;
    const form = new FormData();
    form.append('prompt', req.prompt);
    form.append('aspect_ratio', req.aspect || '16:9');
    form.append('output_format', 'png');

    const res = await fetch(`https://api.stability.ai/v2beta/stable-image/generate/${model}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'image/*' },
      body: form,
    });

    if (!res.ok) throw new Error(`Stability gorsel hatasi ${res.status}: ${await res.text()}`);

    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      mimeType: 'image/png',
      provider: this.name,
      model,
      costUsd: 0.03,
    };
  }
}

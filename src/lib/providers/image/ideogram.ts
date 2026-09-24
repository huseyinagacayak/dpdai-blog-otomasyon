import type { ImageProvider, ImageRequest, ImageResult } from './types';

/** Ideogram v3 - kapak yazisi / metin iceren gorsellerde iyi sonuc verir */
export class IdeogramImageProvider implements ImageProvider {
  readonly name = 'ideogram';

  constructor(
    private apiKey: string,
    private defaultModel = 'V_3',
  ) {
    if (!apiKey) throw new Error('Ideogram API anahtari tanimli degil (Ayarlar > Saglayicilar).');
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const form = new FormData();
    form.append('prompt', req.prompt);
    form.append('aspect_ratio', (req.aspect || '16:9').replace(':', 'x'));
    form.append('rendering_speed', 'DEFAULT');

    const res = await fetch('https://api.ideogram.ai/v1/ideogram-v3/generate', {
      method: 'POST',
      headers: { 'Api-Key': this.apiKey },
      body: form,
    });

    if (!res.ok) throw new Error(`Ideogram gorsel hatasi ${res.status}: ${await res.text()}`);

    const json = (await res.json()) as { data?: { url?: string }[] };
    const url = json.data?.[0]?.url;
    if (!url) throw new Error('Ideogram gorsel dondurmedi.');

    const img = await fetch(url);
    return {
      buffer: Buffer.from(await img.arrayBuffer()),
      mimeType: img.headers.get('content-type') || 'image/png',
      provider: this.name,
      model: req.model || this.defaultModel,
      costUsd: 0.06,
    };
  }
}

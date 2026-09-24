import type { ImageProvider, ImageRequest, ImageResult } from './types';

/** Google Gemini gorsel uretimi (generateContent + inlineData) */
export class GeminiImageProvider implements ImageProvider {
  readonly name = 'gemini';

  constructor(
    private apiKey: string,
    private defaultModel = 'gemini-2.5-flash-image',
  ) {
    if (!apiKey) throw new Error('Gemini API anahtari tanimli degil (Ayarlar > Saglayicilar).');
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const model = req.model || this.defaultModel;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: req.prompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: req.aspect || '16:9' },
        },
      }),
    });

    if (!res.ok) throw new Error(`Gemini gorsel hatasi ${res.status}: ${await res.text()}`);

    type Part = { inlineData?: { data: string; mimeType: string } };
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: Part[] } }[];
    };

    const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part?.inlineData) throw new Error('Gemini gorsel dondurmedi.');

    return {
      buffer: Buffer.from(part.inlineData.data, 'base64'),
      mimeType: part.inlineData.mimeType || 'image/png',
      provider: this.name,
      model,
      costUsd: 0.04,
    };
  }
}

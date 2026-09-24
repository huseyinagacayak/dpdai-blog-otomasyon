import Anthropic from '@anthropic-ai/sdk';
import { priceOf, type TextProvider, type TextRequest, type TextResult } from './types';

export class AnthropicProvider implements TextProvider {
  readonly name = 'anthropic';
  private client: Anthropic;
  private defaultModel: string;

  constructor(apiKey: string, defaultModel = 'claude-sonnet-5') {
    if (!apiKey) throw new Error('Anthropic API anahtari tanimli degil (Ayarlar > Saglayicilar).');
    this.client = new Anthropic({ apiKey });
    this.defaultModel = defaultModel;
  }

  async complete(req: TextRequest): Promise<TextResult> {
    const model = req.model || this.defaultModel;
    const system = req.json
      ? `${req.system}\n\nCIKTI KURALI: Sadece gecerli JSON dondur. Aciklama, markdown kod bloğu veya baska metin ekleme.`
      : req.system;

    const res = await this.client.messages.create({
      model,
      max_tokens: req.maxTokens ?? 8000,
      temperature: req.temperature ?? 0.7,
      system,
      messages: [{ role: 'user', content: req.prompt }],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const tokensIn = res.usage.input_tokens ?? 0;
    const tokensOut = res.usage.output_tokens ?? 0;

    return {
      text,
      model,
      provider: this.name,
      tokensIn,
      tokensOut,
      costUsd: priceOf(model, tokensIn, tokensOut),
    };
  }
}

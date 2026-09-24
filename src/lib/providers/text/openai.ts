import OpenAI from 'openai';
import { priceOf, type TextProvider, type TextRequest, type TextResult } from './types';

/**
 * Hem resmi OpenAI hem de OpenAI-uyumlu yerel/uzak sunucular (vLLM, Ollama,
 * LM Studio, RunPod endpoint) icin kullanilir. baseURL verilirse "local" olur.
 */
export class OpenAICompatibleProvider implements TextProvider {
  readonly name: string;
  private client: OpenAI;
  private defaultModel: string;

  constructor(opts: {
    apiKey: string;
    baseURL?: string;
    defaultModel: string;
    name?: string;
  }) {
    if (!opts.apiKey && !opts.baseURL) {
      throw new Error('OpenAI API anahtari tanimli degil (Ayarlar > Saglayicilar).');
    }
    this.name = opts.name ?? (opts.baseURL ? 'local' : 'openai');
    this.client = new OpenAI({
      apiKey: opts.apiKey || 'yerel',
      baseURL: opts.baseURL || undefined,
      // Aski kalan cagri isi 10 dk slot kilitlemesin; sure asilirsa hata verir.
      timeout: Number(process.env.TEXT_TIMEOUT_MS || 180_000),
      maxRetries: 2,
    });
    this.defaultModel = opts.defaultModel;
  }

  async complete(req: TextRequest): Promise<TextResult> {
    const model = req.model || this.defaultModel;

    // GPT-5 ailesi ve o-serisi "reasoning" modelleri iki noktada farkli davranir:
    //  1) Ozel temperature kabul etmez (yalnizca varsayilan 1); ozel deger 400 dondurur.
    //  2) max_completion_tokens butcesini dusunme (reasoning) tokenlari icin de
    //     harcar. Butce dusukse cikti bos/yarim kalir ve JSON.parse patlar
    //     ("Unexpected end of JSON input"). Bu yuzden reasoning cabasini dusuk
    //     tutar ve butceye dusunmeye pay birakacak sekilde ek alan ekleriz.
    const reasoning = /^(gpt-5|o1|o3|o4)/i.test(model);
    const maxOut = req.maxTokens ?? 8000;

    const res = await this.client.chat.completions.create({
      model,
      ...(reasoning
        ? { reasoning_effort: 'low', max_completion_tokens: maxOut + 4000 }
        : { temperature: req.temperature ?? 0.7, max_completion_tokens: maxOut }),
      response_format: req.json ? { type: 'json_object' } : undefined,
      messages: [
        {
          role: 'system',
          content: req.json
            ? `${req.system}\n\nCIKTI KURALI: Sadece gecerli JSON dondur.`
            : req.system,
        },
        { role: 'user', content: req.prompt },
      ],
    });

    const text = res.choices[0]?.message?.content ?? '';
    const tokensIn = res.usage?.prompt_tokens ?? 0;
    const tokensOut = res.usage?.completion_tokens ?? 0;

    return {
      text,
      model,
      provider: this.name,
      tokensIn,
      tokensOut,
      costUsd: this.name === 'local' ? 0 : priceOf(model, tokensIn, tokensOut),
    };
  }
}

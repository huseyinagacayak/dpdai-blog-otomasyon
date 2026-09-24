export type TextRequest = {
  system: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** true ise model sadece gecerli JSON dondurmeye zorlanir */
  json?: boolean;
};

export type TextResult = {
  text: string;
  model: string;
  provider: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** Havuzda yedege gecildiyse denenip basarisiz olan saglayicilar */
  fallbackFrom?: string[];
};

export interface TextProvider {
  readonly name: string;
  complete(req: TextRequest): Promise<TextResult>;
}

/**
 * 1M token basina USD.
 * Listede olmayan model icin 0 yazilir; ucretsiz saglayicilar zaten havuzda
 * "free" isaretlenip maliyet olarak sayilmaz.
 */
export const PRICING: Record<string, { in: number; out: number }> = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-fable-5': { in: 1, out: 5 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'gpt-5': { in: 1.25, out: 10 },
  'gpt-5-mini': { in: 0.25, out: 2 },
  'gpt-4.1': { in: 2, out: 8 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
};

export function priceOf(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (tokensIn / 1_000_000) * p.in + (tokensOut / 1_000_000) * p.out;
}

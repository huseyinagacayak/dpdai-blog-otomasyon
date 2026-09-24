/**
 * Hazir saglayici on ayarlari.
 *
 * Cogu servis OpenAI uyumlu bir uc sunuyor; bu yuzden "openai-compatible"
 * tek bir adaptorle hepsini karsiliyoruz. Buradaki kayitlar yalnizca
 * panelde kurulumu kolaylastirmak icin: label, adres ve onerilen model.
 */

export type Preset = {
  id: string;
  label: string;
  /** Kullanilacak adaptor */
  provider: string;
  kind: 'TEXT' | 'IMAGE';
  baseUrl?: string;
  model?: string;
  /** Ucretsiz katmani var mi */
  free: boolean;
  /** Gorsel denetimi (vision) destegi */
  vision?: boolean;
  /** Anahtar gerekmiyor mu */
  keyless?: boolean;
  /** apiKey disinda gereken alanlar */
  extraFields?: { key: string; label: string; placeholder?: string }[];
  hint?: string;
};

export const TEXT_PRESETS: Preset[] = [
  {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    provider: 'anthropic',
    kind: 'TEXT',
    model: 'claude-sonnet-5',
    free: false,
    vision: true,
    hint: 'Metin ve çeviri kalitesinde en güvenli seçenek.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    provider: 'openai',
    kind: 'TEXT',
    model: 'gpt-5-mini',
    free: false,
    vision: true,
  },
  {
    id: 'gemini-text',
    label: 'Google Gemini',
    provider: 'openai-compatible',
    kind: 'TEXT',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    free: true,
    vision: true,
    hint: 'Cömert ücretsiz katman. aistudio.google.com adresinden anahtar alın.',
  },
  {
    id: 'groq',
    label: 'Groq',
    provider: 'openai-compatible',
    kind: 'TEXT',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    free: true,
    hint: 'Ücretsiz ve çok hızlı. console.groq.com adresinden anahtar alın.',
  },
  {
    id: 'openrouter-free',
    label: 'OpenRouter (ücretsiz modeller)',
    provider: 'openai-compatible',
    kind: 'TEXT',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-chat-v3.1:free',
    free: true,
    hint: 'Model adı ":free" ile bitenler ücretsizdir. Tek anahtarla onlarca model.',
  },
  {
    id: 'openrouter-gemini',
    label: 'OpenRouter — Gemini',
    provider: 'openai-compatible',
    kind: 'TEXT',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.5-flash',
    free: false,
    vision: true,
    hint:
      'OpenRouter üzerinden Google Gemini. Anahtarı openrouter.ai/keys adresinden alın. ' +
      'Model: google/gemini-2.5-flash (hızlı/ucuz) veya google/gemini-2.5-pro (daha kaliteli); ' +
      'ücretsiz denemek için google/gemini-2.0-flash-exp:free yazabilirsiniz.',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    provider: 'openai-compatible',
    kind: 'TEXT',
    baseUrl: 'https://api.cerebras.ai/v1',
    model: 'llama-3.3-70b',
    free: true,
    hint: 'Ücretsiz katman, yüksek hız.',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    provider: 'openai-compatible',
    kind: 'TEXT',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    free: true,
    hint: 'Ücretsiz deneme katmanı mevcut.',
  },
  {
    id: 'github-models',
    label: 'GitHub Models',
    provider: 'openai-compatible',
    kind: 'TEXT',
    baseUrl: 'https://models.github.ai/inference',
    model: 'openai/gpt-4.1-mini',
    free: true,
    vision: true,
    hint: 'GitHub personal access token ile ücretsiz kullanım.',
  },
  {
    id: 'pollinations-text',
    label: 'Pollinations metin (anahtarsız)',
    provider: 'openai-compatible',
    kind: 'TEXT',
    baseUrl: 'https://text.pollinations.ai/openai',
    model: 'openai-fast',
    free: true,
    keyless: true,
    hint:
      'Anahtar istemez ama topluluk servisi: kesintiye uğrayabilir ve kalitesi ' +
      'diğerlerinin altındadır. Yalnızca listenin en altına, son çare yedeği olarak koyun.',
  },
  {
    id: 'local',
    label: 'Yerel / kendi sunucunuz',
    provider: 'openai-compatible',
    kind: 'TEXT',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3:32b',
    free: true,
    hint: 'Ollama, vLLM, LM Studio veya RunPod ucu. Anahtar gerekmeyebilir.',
  },
];

export const IMAGE_PRESETS: Preset[] = [
  {
    id: 'pollinations',
    label: 'Pollinations (anahtarsız)',
    provider: 'pollinations',
    kind: 'IMAGE',
    model: 'flux',
    free: true,
    keyless: true,
    hint: 'Tamamen ücretsiz, anahtar istemez. Yedek olarak listenin sonuna koyun.',
  },
  {
    id: 'gemini-image',
    label: 'Google Gemini görsel',
    provider: 'gemini',
    kind: 'IMAGE',
    model: 'gemini-2.5-flash-image',
    free: true,
    hint: 'Ücretsiz katman mevcut. aistudio.google.com adresinden anahtar alın.',
  },
  {
    id: 'openrouter-image',
    label: 'OpenRouter — Gemini görsel',
    provider: 'openrouter',
    kind: 'IMAGE',
    model: 'google/gemini-2.5-flash-image-preview',
    free: false,
    hint:
      'OpenRouter üzerinden Gemini görsel ("nano banana"). Anahtar openrouter.ai/keys. ' +
      'Ücretsiz denemek için model adına ":free" ekleyin. Metin anahtarınızla aynıdır.',
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    provider: 'cloudflare',
    kind: 'IMAGE',
    model: '@cf/black-forest-labs/flux-1-schnell',
    free: true,
    extraFields: [
      { key: 'accountId', label: 'Hesap kimliği (Account ID)', placeholder: '32 haneli kimlik' },
    ],
    hint: 'Günlük ücretsiz kota var. Panel > Workers AI bölümünden token alın.',
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    provider: 'huggingface',
    kind: 'IMAGE',
    model: 'black-forest-labs/FLUX.1-schnell',
    free: true,
    hint: 'Ücretsiz çıkarım kotası. İlk istekte model ısınırken gecikebilir.',
  },
  {
    id: 'openai-image',
    label: 'OpenAI (gpt-image-1)',
    provider: 'openai',
    kind: 'IMAGE',
    model: 'gpt-image-1',
    free: false,
  },
  {
    id: 'ideogram',
    label: 'Ideogram',
    provider: 'ideogram',
    kind: 'IMAGE',
    model: 'V_3',
    free: false,
  },
  {
    id: 'stability',
    label: 'Stability AI',
    provider: 'stability',
    kind: 'IMAGE',
    model: 'core',
    free: false,
  },
];

export function findPreset(id: string): Preset | undefined {
  return [...TEXT_PRESETS, ...IMAGE_PRESETS].find((p) => p.id === id);
}

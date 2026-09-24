import { prisma } from './db';
import { decrypt, encrypt } from './crypto';

export type ProviderSettings = {
  /** Varsayilan metin saglayicisi: anthropic | openai | local */
  textProvider: string;
  textModel: string;
  /** Varsayilan gorsel saglayicisi: openai | gemini | ideogram | stability */
  imageProvider: string;
  imageModel: string;
  keys: {
    anthropic?: string;
    openai?: string;
    gemini?: string;
    ideogram?: string;
    stability?: string;
    localBaseUrl?: string;
    localApiKey?: string;
    localModel?: string;
  };
};

const DEFAULTS: ProviderSettings = {
  textProvider: 'anthropic',
  textModel: 'claude-sonnet-5',
  imageProvider: 'openai',
  imageModel: 'gpt-image-1',
  keys: {},
};

const SECRET_KEYS = new Set([
  'anthropic',
  'openai',
  'gemini',
  'ideogram',
  'stability',
  'localApiKey',
]);

const SETTING_KEY = 'providers';

/** Ortam degiskenlerinden gelen varsayilanlar (DB bos ise kullanilir) */
function fromEnv(): Partial<ProviderSettings['keys']> {
  return {
    anthropic: process.env.ANTHROPIC_API_KEY || undefined,
    openai: process.env.OPENAI_API_KEY || undefined,
    gemini: process.env.GEMINI_API_KEY || undefined,
    ideogram: process.env.IDEOGRAM_API_KEY || undefined,
    stability: process.env.STABILITY_API_KEY || undefined,
    localBaseUrl: process.env.LOCAL_LLM_BASE_URL || undefined,
    localApiKey: process.env.LOCAL_LLM_API_KEY || undefined,
    localModel: process.env.LOCAL_LLM_MODEL || undefined,
  };
}

export async function getProviderSettings(): Promise<ProviderSettings> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
  const stored = (row?.value as Record<string, unknown> | undefined) ?? {};
  const storedKeys = (stored.keys as Record<string, string> | undefined) ?? {};

  const keys: ProviderSettings['keys'] = { ...fromEnv() };
  for (const [k, v] of Object.entries(storedKeys)) {
    const val = SECRET_KEYS.has(k) ? decrypt(v) : v;
    if (val) (keys as Record<string, string>)[k] = val;
  }

  return {
    textProvider: (stored.textProvider as string) || DEFAULTS.textProvider,
    textModel: (stored.textModel as string) || DEFAULTS.textModel,
    imageProvider: (stored.imageProvider as string) || DEFAULTS.imageProvider,
    imageModel: (stored.imageModel as string) || DEFAULTS.imageModel,
    keys,
  };
}

export async function saveProviderSettings(
  input: Partial<Omit<ProviderSettings, 'keys'>> & { keys?: Record<string, string> },
): Promise<void> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
  const current = (row?.value as Record<string, unknown> | undefined) ?? {};
  const currentKeys = (current.keys as Record<string, string> | undefined) ?? {};

  const nextKeys = { ...currentKeys };
  for (const [k, v] of Object.entries(input.keys ?? {})) {
    if (v === '') {
      delete nextKeys[k]; // bosaltma
      continue;
    }
    if (v === undefined || v === null) continue; // dokunma
    nextKeys[k] = SECRET_KEYS.has(k) ? (encrypt(v) as string) : v;
  }

  const value = {
    textProvider: input.textProvider ?? current.textProvider ?? DEFAULTS.textProvider,
    textModel: input.textModel ?? current.textModel ?? DEFAULTS.textModel,
    imageProvider: input.imageProvider ?? current.imageProvider ?? DEFAULTS.imageProvider,
    imageModel: input.imageModel ?? current.imageModel ?? DEFAULTS.imageModel,
    keys: nextKeys,
  };

  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value },
    update: { value },
  });
}

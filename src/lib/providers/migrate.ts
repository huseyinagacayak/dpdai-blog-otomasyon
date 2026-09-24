import { encrypt } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { getProviderSettings } from '@/lib/settings';

/**
 * Tek anahtarli eski ayarlardan API havuzuna gecis.
 *
 * Havuz bosken bir kez calisir; Ayarlar sayfasindaki eski anahtarlari ve
 * ortam degiskenlerini havuz girisine cevirir. Boylece guncelleme sonrasi
 * kullanici hicbir sey yapmadan sistem calismaya devam eder.
 */
export async function seedCredentialsFromLegacy(): Promise<number> {
  const count = await prisma.apiCredential.count();
  if (count > 0) return 0;

  const s = await getProviderSettings();
  let priority = 10;
  let created = 0;

  const add = async (data: {
    kind: 'TEXT' | 'IMAGE';
    label: string;
    provider: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    free?: boolean;
    vision?: boolean;
    extra?: Record<string, string>;
  }) => {
    await prisma.apiCredential.create({
      data: {
        kind: data.kind,
        label: data.label,
        provider: data.provider,
        apiKey: data.apiKey ? encrypt(data.apiKey) : null,
        baseUrl: data.baseUrl ?? null,
        model: data.model ?? null,
        free: data.free ?? false,
        vision: data.vision ?? false,
        extra: (data.extra ?? undefined) as unknown as object | undefined,
        priority: (priority += 10),
      },
    });
    created++;
  };

  /* ---------------------------------------------------------------- metin */

  // Once varsayilan olarak secili olan saglayici gelsin
  const textOrder = [s.textProvider, 'anthropic', 'openai', 'local'].filter(
    (v, i, a) => v && a.indexOf(v) === i,
  );

  for (const name of textOrder) {
    if (name === 'anthropic' && s.keys.anthropic) {
      await add({
        kind: 'TEXT',
        label: 'Claude (Anthropic)',
        provider: 'anthropic',
        apiKey: s.keys.anthropic,
        model: s.textModel || 'claude-sonnet-5',
        vision: true,
      });
    }
    if (name === 'openai' && s.keys.openai) {
      await add({
        kind: 'TEXT',
        label: 'OpenAI',
        provider: 'openai',
        apiKey: s.keys.openai,
        model: s.textProvider === 'openai' ? s.textModel : 'gpt-5-mini',
        vision: true,
      });
    }
    if (name === 'local' && s.keys.localBaseUrl) {
      await add({
        kind: 'TEXT',
        label: 'Yerel / OpenAI uyumlu',
        provider: 'openai-compatible',
        apiKey: s.keys.localApiKey,
        baseUrl: s.keys.localBaseUrl,
        model: s.keys.localModel || s.textModel,
        free: true,
      });
    }
  }

  /* --------------------------------------------------------------- gorsel */

  const imageOrder = [s.imageProvider, 'openai', 'gemini', 'ideogram', 'stability'].filter(
    (v, i, a) => v && a.indexOf(v) === i,
  );

  for (const name of imageOrder) {
    const key = s.keys[name as keyof typeof s.keys];
    if (!key) continue;

    const labels: Record<string, string> = {
      openai: 'OpenAI görsel',
      gemini: 'Google Gemini görsel',
      ideogram: 'Ideogram',
      stability: 'Stability AI',
    };
    if (!labels[name as string]) continue;

    await add({
      kind: 'IMAGE',
      label: labels[name as string],
      provider: name as string,
      apiKey: key,
      model: s.imageProvider === name ? s.imageModel : undefined,
      free: name === 'gemini',
    });
  }

  /* ------------------------------------------------------- ucretsiz yedek */

  // Hic gorsel saglayicisi yoksa, anahtarsiz calisan yedegi ekle:
  // sistem en azindan gorselsiz kalmaz.
  const imageCount = await prisma.apiCredential.count({ where: { kind: 'IMAGE' } });
  if (imageCount === 0) {
    await prisma.apiCredential.create({
      data: {
        kind: 'IMAGE',
        label: 'Pollinations (ücretsiz yedek)',
        provider: 'pollinations',
        model: 'flux',
        free: true,
        priority: 900,
      },
    });
    created++;
  }

  return created;
}

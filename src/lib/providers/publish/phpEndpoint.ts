import type {
  MediaResult,
  MediaUpload,
  PublishAdapter,
  PublishPayload,
  PublishResult,
  SiteCapabilities,
} from './types';

/**
 * WordPress olmayan ozel PHP siteler icin.
 * Siteye wp-plugin/php-endpoint/dpdai-receive.php dosyasini koyup token verirsin;
 * bu adaptor ayni JSON sozlesmesini o dosyaya POST eder.
 */
export class PhpEndpointAdapter implements PublishAdapter {
  /** Yuklenen gorsellerin id -> URL eslemesi (PHP tarafi URL bekler). */
  private mediaUrls = new Map<number, string>();

  constructor(
    private endpoint: string,
    private token: string,
  ) {
    if (!endpoint) throw new Error('PHP site icin endpoint adresi tanimli degil.');
    if (!token) throw new Error('PHP site icin gizli token tanimli degil.');
  }

  private async req<T>(action: string, payload: unknown, timeoutMs = 60_000): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-DPDAI-Token': this.token,
          'User-Agent': 'DPDAI-Blog-Otomasyon/1.0',
        },
        body: JSON.stringify({ action, payload }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`PHP endpoint ${res.status}: ${text.slice(0, 400)}`);
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async discover(): Promise<SiteCapabilities> {
    try {
      const info = await this.req<{
        ok: boolean;
        version: string;
        languages?: string[];
        categories?: { id: number; name: string; slug: string }[];
      }>('info', {}, 20_000);

      return {
        reachable: !!info.ok,
        message: info.ok ? 'PHP endpoint yanit verdi.' : 'PHP endpoint hata dondurdu.',
        bridge: { installed: true, version: info.version },
        seoPlugin: 'BRIDGE',
        i18n: { mode: 'none', languages: info.languages ?? [] },
        categories: info.categories ?? [],
        authors: [],
        raw: info,
      };
    } catch (e) {
      return {
        reachable: false,
        message: `Baglanti kurulamadi: ${(e as Error).message}`,
        seoPlugin: 'NONE',
        i18n: { mode: 'none', languages: [] },
        categories: [],
        authors: [],
      };
    }
  }

  async uploadMedia(m: MediaUpload): Promise<MediaResult> {
    const res = await this.req<{ id: number; url: string }>('upload_media', {
      filename: m.filename,
      mime_type: m.mimeType,
      alt: m.alt ?? '',
      caption: m.caption ?? '',
      data_base64: m.buffer.toString('base64'),
    });
    this.mediaUrls.set(res.id, res.url);
    return { mediaId: res.id, url: res.url };
  }

  async publish(p: PublishPayload): Promise<PublishResult> {
    const res = await this.req<{ id: number; url: string; status: string; warnings?: string[] }>(
      'publish',
      {
        external_id: p.externalId,
        title: p.title,
        content: p.contentHtml,
        excerpt: p.excerpt ?? '',
        slug: p.slug ?? '',
        status: p.status,
        date: p.date ?? null,
        categories: p.categories ?? [],
        tags: p.tags ?? [],
        featured_media_id: p.featuredMediaId ?? null,
        featured_image_url: p.featuredMediaId
          ? (this.mediaUrls.get(p.featuredMediaId) ?? null)
          : null,
        locale: p.i18n?.lang ?? null,
        seo: p.seo ?? {},
      },
    );
    return {
      postId: res.id,
      url: res.url,
      status: res.status,
      warnings: res.warnings ?? [],
    };
  }
}

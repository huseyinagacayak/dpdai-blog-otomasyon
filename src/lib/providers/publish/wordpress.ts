import type {
  MediaResult,
  MediaUpload,
  PublishAdapter,
  PublishPayload,
  PublishResult,
  SiteCapabilities,
} from './types';

type Opts = {
  baseUrl: string;
  username: string;
  appPassword: string;
  /** dpdai-bridge eklentisi kuruluysa true - discover() bunu kendi tespit eder */
  preferBridge?: boolean;
  /**
   * dpdai-bridge yonetim ekranindaki token. Bazi hostlar Authorization basligini
   * siler; token ikinci bir kimlik yolu olarak gonderilir.
   */
  bridgeToken?: string | null;
};

/**
 * WordPress REST istemcisi.
 *
 * Iki kanal kullanir:
 *  1) Cekirdek REST (/wp/v2/*) - yazi ve medya olusturma icin her sitede calisir.
 *  2) dpdai-bridge (/dpdai/v1/*) - SEO metalari, Polylang/WPML dil baglantisi ve
 *     idempotent yayin icin. Kurulu degilse SEO metalari yazilamaz; bu durum
 *     PublishResult.warnings icinde bildirilir.
 */
export class WordPressAdapter implements PublishAdapter {
  private base: string;
  private auth: string;
  private preferBridge: boolean;
  private bridgeToken: string | null;

  constructor(opts: Opts) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.auth =
      'Basic ' + Buffer.from(`${opts.username}:${opts.appPassword}`).toString('base64');
    this.preferBridge = opts.preferBridge ?? false;
    this.bridgeToken = opts.bridgeToken ?? null;
  }

  private url(path: string): string {
    return `${this.base}/wp-json${path}`;
  }

  private async req<T>(path: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(this.url(path), {
        ...init,
        signal: ctrl.signal,
        headers: {
          Authorization: this.auth,
          Accept: 'application/json',
          'User-Agent': 'DPDAI-Blog-Otomasyon/1.0',
          ...(this.bridgeToken ? { 'X-DPDAI-Token': this.bridgeToken } : {}),
          // Eklenti bu adresi kaydedip guncellemeleri buradan kontrol eder
          ...(process.env.PANEL_URL ? { 'X-DPDAI-Panel': process.env.PANEL_URL } : {}),
          ...(init.headers ?? {}),
        },
      });
      const text = await res.text();
      if (!res.ok) {
        let detail = text.slice(0, 500);
        try {
          const j = JSON.parse(text) as { message?: string; code?: string };
          if (j.message) detail = `${j.code ?? ''} ${j.message}`.trim();
        } catch {
          /* ham metin kalsin */
        }
        throw new Error(`WordPress ${res.status} ${path}: ${detail}`);
      }
      return (text ? JSON.parse(text) : {}) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------------ kesif

  async discover(): Promise<SiteCapabilities> {
    const empty: SiteCapabilities = {
      reachable: false,
      message: '',
      seoPlugin: 'NONE',
      i18n: { mode: 'none', languages: [] },
      categories: [],
      authors: [],
    };

    let root: { name?: string; namespaces?: string[]; description?: string };
    try {
      root = await this.req('/', { method: 'GET' }, 20_000);
    } catch (e) {
      return { ...empty, message: `Baglanti kurulamadi: ${(e as Error).message}` };
    }

    const ns = root.namespaces ?? [];
    const has = (prefix: string) => ns.some((n) => n.startsWith(prefix));

    // 1) Kendi kopru eklentimiz varsa en zengin bilgiyi oradan al
    if (has('dpdai/')) {
      try {
        const info = await this.req<{
          version: string;
          wp_version: string;
          seo_plugin: 'NONE' | 'YOAST' | 'RANKMATH';
          i18n: { mode: 'none' | 'polylang' | 'wpml'; languages: string[] };
          categories: { id: number; name: string; slug: string }[];
          authors: { id: number; name: string }[];
        }>('/dpdai/v1/info', { method: 'GET' }, 20_000);

        return {
          reachable: true,
          message: 'Baglanti basarili. dpdai-bridge kurulu.',
          wpVersion: info.wp_version,
          bridge: { installed: true, version: info.version },
          // Kopru kuruluysa SEO metalarini her halukarda o yazar
          seoPlugin: info.seo_plugin === 'NONE' ? 'BRIDGE' : info.seo_plugin,
          i18n: info.i18n,
          categories: info.categories ?? [],
          authors: info.authors ?? [],
          raw: info,
        };
      } catch {
        /* kopru cevap vermezse cekirdek kesfe dus */
      }
    }

    // 2) Kopru yok: cekirdek REST ile tahmin et
    const [cats, users] = await Promise.all([
      this.req<{ id: number; name: string; slug: string }[]>(
        '/wp/v2/categories?per_page=100&_fields=id,name,slug',
        { method: 'GET' },
      ).catch(() => []),
      this.req<{ id: number; name: string }[]>('/wp/v2/users?per_page=100&_fields=id,name', {
        method: 'GET',
      }).catch(() => []),
    ]);

    const seoPlugin = has('yoast/') ? 'YOAST' : has('rankmath/') ? 'RANKMATH' : 'NONE';
    const i18nMode = has('pll/') ? 'polylang' : has('wpml/') ? 'wpml' : 'none';

    return {
      reachable: true,
      message:
        'Baglanti basarili, ancak dpdai-bridge kurulu degil. ' +
        'SEO metalari ve dil baglantilari icin eklentiyi kurmanizi oneririm.',
      bridge: { installed: false },
      seoPlugin,
      i18n: { mode: i18nMode, languages: [] },
      categories: cats,
      authors: users,
      raw: { namespaces: ns, site: root.name },
    };
  }

  /**
   * Site geneli SEO taramasi. Yalnizca dpdai-bridge kuruluysa calisir;
   * kurulu degilse hata firlatir, cagiran taraf yuzeysel denetime duser.
   */
  async seoAudit(): Promise<Record<string, unknown>> {
    return this.req<Record<string, unknown>>('/dpdai/v1/seo-audit', { method: 'GET' }, 120_000);
  }

  /**
   * Site geneli ceviri denetimi (Polylang). Eksik ve bozuk cevirileri dondurur.
   * Bridge 1.4.0+ ve Polylang gerektirir.
   */
  async translationAudit(): Promise<Record<string, unknown>> {
    return this.req<Record<string, unknown>>('/dpdai/v1/translation-audit', { method: 'GET' }, 120_000);
  }

  /** Sitenin tema konumlarina atali menulerini ve ogelerini dondurur. */
  async getMenus(): Promise<Record<string, unknown>> {
    return this.req<Record<string, unknown>>('/dpdai/v1/menus', { method: 'GET' }, 30_000);
  }

  /** Cevrilmis menuleri olusturur ve dile atar. */
  async syncMenus(body: {
    langs: string[];
    labels: Record<string, Record<string, string>>;
  }): Promise<Record<string, unknown>> {
    return this.req<Record<string, unknown>>(
      '/dpdai/v1/sync-menus',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      60_000,
    );
  }

  /** Tek bir yazinin cevrilecek kaynak icerigini ceker. */
  async postSource(postId: number): Promise<{
    id: number;
    lang: string;
    title: string;
    slug: string;
    contentHtml: string;
    excerpt: string;
    type: string;
    categories: string[];
  }> {
    return this.req(`/dpdai/v1/post-source/${postId}`, { method: 'GET' }, 30_000);
  }

  /**
   * Sitede yayinda olan yazi ve sayfa basliklari.
   * Ic linkleme aday havuzu ve yamyamlasma kontrolu icin kullanilir.
   */
  async fetchPublishedTitles(): Promise<{ title: string; url: string; source: 'post' | 'page' }[]> {
    const out: { title: string; url: string; source: 'post' | 'page' }[] = [];

    const clean = (raw: string) =>
      raw
        .replace(/<[^>]+>/g, '')
        .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
        .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;|&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .trim();

    for (const type of ['posts', 'pages'] as const) {
      const source = type === 'posts' ? 'post' : 'page';
      const maxPages = type === 'posts' ? 3 : 1;

      for (let page = 1; page <= maxPages; page++) {
        const rows = await this.req<{ title: { rendered: string }; link: string }[]>(
          `/wp/v2/${type}?status=publish&per_page=100&page=${page}&_fields=title,link`,
          { method: 'GET' },
          30_000,
        ).catch(() => []);

        if (!rows.length) break;

        for (const r of rows) {
          const title = clean(r.title?.rendered ?? '');
          if (title) out.push({ title, url: r.link, source });
        }

        if (rows.length < 100) break;
      }
    }

    return out;
  }

  // ------------------------------------------------------------------ medya

  async uploadMedia(m: MediaUpload): Promise<MediaResult> {
    const created = await this.req<{ id: number; source_url: string }>('/wp/v2/media', {
      method: 'POST',
      headers: {
        'Content-Type': m.mimeType,
        'Content-Disposition': `attachment; filename="${m.filename}"`,
      },
      body: new Uint8Array(m.buffer),
    });

    // alt/title/caption ayri PATCH ile yazilir (yukleme istegi govdesi ikili veri)
    if (m.alt || m.title || m.caption) {
      await this.req(`/wp/v2/media/${created.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alt_text: m.alt ?? '',
          title: m.title ?? '',
          caption: m.caption ?? '',
        }),
      }).catch(() => undefined);
    }

    return { mediaId: created.id, url: created.source_url };
  }

  // ------------------------------------------------------------------ yayin

  async publish(p: PublishPayload): Promise<PublishResult> {
    if (this.preferBridge) {
      try {
        return await this.publishViaBridge(p);
      } catch (e) {
        // Kopru hata verirse cekirdege dus, ama sessiz kalma
        const res = await this.publishViaCore(p);
        res.warnings.push(`dpdai-bridge kullanilamadi: ${(e as Error).message}`);
        return res;
      }
    }
    return this.publishViaCore(p);
  }

  private async publishViaBridge(p: PublishPayload): Promise<PublishResult> {
    const res = await this.req<{
      id: number;
      link: string;
      status: string;
      warnings?: string[];
    }>('/dpdai/v1/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        external_id: p.externalId,
        post: {
          title: p.title,
          content: p.contentHtml,
          excerpt: p.excerpt ?? '',
          slug: p.slug ?? '',
          status: p.status,
          date: p.date ?? null,
          categories: p.categories ?? [],
          tags: p.tags ?? [],
          author: p.authorId ?? null,
          featured_media: p.featuredMediaId ?? null,
        },
        seo: p.seo ?? {},
        i18n: p.i18n ?? { mode: 'none' },
      }),
    });

    return {
      postId: res.id,
      url: res.link,
      status: res.status,
      warnings: res.warnings ?? [],
    };
  }

  private async publishViaCore(p: PublishPayload): Promise<PublishResult> {
    const warnings: string[] = [];

    // Idempotency: ayni externalId ile daha once yazi acildiysa onu guncelle
    const existing = await this.findByExternalId(p.externalId);

    const categoryIds = await this.resolveCategories(p.categories ?? []);
    const tagIds = await this.resolveTags(p.tags ?? []);

    const body: Record<string, unknown> = {
      title: p.title,
      content: p.contentHtml,
      excerpt: p.excerpt ?? '',
      status: p.status,
      meta: { dpdai_external_id: p.externalId },
    };
    if (p.slug) body.slug = p.slug;
    if (p.date) body.date = p.date;
    if (categoryIds.length) body.categories = categoryIds;
    if (tagIds.length) body.tags = tagIds;
    if (p.authorId) body.author = p.authorId;
    if (p.featuredMediaId) body.featured_media = p.featuredMediaId;

    if (p.seo) {
      warnings.push(
        'SEO metalari yazilamadi: dpdai-bridge eklentisi kurulu degil. ' +
          'Baslik/aciklama WordPress tarafinda elle girilmeli.',
      );
    }
    if (p.i18n && p.i18n.mode !== 'none') {
      warnings.push(
        `Dil baglantisi (${p.i18n.mode}) kurulamadi: dpdai-bridge eklentisi gerekli.`,
      );
    }

    const path = existing ? `/wp/v2/posts/${existing}` : '/wp/v2/posts';
    const res = await this.req<{ id: number; link: string; status: string }>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    return { postId: res.id, url: res.link, status: res.status, warnings };
  }

  private async findByExternalId(externalId: string): Promise<number | null> {
    try {
      const rows = await this.req<{ id: number }[]>(
        `/wp/v2/posts?status=any&per_page=1&_fields=id&meta_key=dpdai_external_id&meta_value=${encodeURIComponent(externalId)}`,
        { method: 'GET' },
      );
      return rows[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  private async resolveCategories(names: string[]): Promise<number[]> {
    return this.resolveTerms(names, 'categories');
  }

  private async resolveTags(names: string[]): Promise<number[]> {
    return this.resolveTerms(names, 'tags');
  }

  /** Ada gore terim bulur, yoksa olusturur. */
  private async resolveTerms(names: string[], taxonomy: 'categories' | 'tags'): Promise<number[]> {
    const ids: number[] = [];
    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      try {
        const found = await this.req<{ id: number; name: string }[]>(
          `/wp/v2/${taxonomy}?per_page=100&search=${encodeURIComponent(trimmed)}&_fields=id,name`,
          { method: 'GET' },
        );
        const exact = found.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
        if (exact) {
          ids.push(exact.id);
          continue;
        }
        const created = await this.req<{ id: number }>(`/wp/v2/${taxonomy}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed }),
        });
        ids.push(created.id);
      } catch {
        /* terim olusturulamadiysa atla - yazi yine de yayinlansin */
      }
    }
    return ids;
  }
}

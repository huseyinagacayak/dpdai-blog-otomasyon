export type SeoPayload = {
  metaTitle?: string;
  metaDescription?: string;
  focusKeyword?: string;
  secondaryKeywords?: string[];
  canonical?: string;
  ogTitle?: string;
  ogDescription?: string;
  /** JSON-LD schema nesnesi */
  schema?: Record<string, unknown>;
};

export type PublishPayload = {
  /** Idempotency anahtari - ayni id ile ikinci istek yeni yazi acmaz, gunceller */
  externalId: string;
  title: string;
  contentHtml: string;
  excerpt?: string;
  slug?: string;
  /** draft | publish | future | pending */
  status: string;
  /** ISO tarih - status=future icin */
  date?: string;
  categories?: string[];
  tags?: string[];
  authorId?: number;
  featuredMediaId?: number;
  seo?: SeoPayload;
  i18n?: {
    mode: 'none' | 'polylang' | 'wpml';
    /** hedef dil kodu, ornek: en */
    lang?: string;
    /** kaynak (orijinal) yazinin uzak id'si */
    translationOfPostId?: number;
  };
};

export type PublishResult = {
  postId: number;
  url: string;
  status: string;
  warnings: string[];
};

export type MediaUpload = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  alt?: string;
  title?: string;
  caption?: string;
};

export type MediaResult = { mediaId: number; url: string };

export type SiteCapabilities = {
  reachable: boolean;
  message: string;
  wpVersion?: string;
  bridge?: { installed: boolean; version?: string };
  seoPlugin: 'NONE' | 'YOAST' | 'RANKMATH' | 'BRIDGE';
  i18n: { mode: 'none' | 'polylang' | 'wpml'; languages: string[] };
  categories: { id: number; name: string; slug: string }[];
  authors: { id: number; name: string }[];
  raw?: unknown;
};

export interface PublishAdapter {
  discover(): Promise<SiteCapabilities>;
  uploadMedia(m: MediaUpload): Promise<MediaResult>;
  publish(p: PublishPayload): Promise<PublishResult>;
  /** dpdai-bridge kuruluysa site geneli SEO taramasi dondurur. */
  seoAudit?(): Promise<Record<string, unknown>>;
  /** dpdai-bridge 1.4.0+ ve Polylang varsa site geneli ceviri denetimi. */
  translationAudit?(): Promise<Record<string, unknown>>;
  /** dpdai-bridge 1.5.0+ : menuleri okur. */
  getMenus?(): Promise<Record<string, unknown>>;
  /** dpdai-bridge 1.5.0+ : cevrilmis menuleri olusturur ve dile atar. */
  syncMenus?(body: {
    langs: string[];
    labels: Record<string, Record<string, string>>;
  }): Promise<Record<string, unknown>>;
  /** Tek bir yazinin cevrilecek kaynak icerigini ceker. */
  postSource?(postId: number): Promise<{
    id: number;
    lang: string;
    title: string;
    slug: string;
    contentHtml: string;
    excerpt: string;
    type: string;
    categories: string[];
  }>;
  /** Sitede yayinda olan yazi ve sayfa basliklari - ic link ve cakisma kontrolu icin. */
  fetchPublishedTitles?(): Promise<{ title: string; url: string; source: 'post' | 'page' }[]>;
}

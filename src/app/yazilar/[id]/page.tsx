import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PipelineProgress } from '@/components/PipelineProgress';
import {
  IconAlert,
  IconCheck,
  IconExternal,
  IconImage,
  IconLink,
  IconRefresh,
  IconSparkle,
  IconTrash,
} from '@/components/icons';
import {
  Alert,
  ArticleBadge,
  PageHeader,
  Panel,
  ScorePill,
  ScoreRing,
  fmtDate,
  fmtMoney,
  scoreTone,
} from '@/components/ui';
import {
  approveArticle,
  deleteArticle,
  forcePublish,
  regenerateArticle,
  regenerateImage,
  recomposeCover,
  rerunInterlink,
  rerunQuality,
  retryArticle,
  saveArticle,
} from '@/lib/actions/articles';
import { prisma } from '@/lib/db';
import type { Critique } from '@/lib/pipeline/quality';
import type { ImageCheck } from '@/lib/providers/vision';
import type { SeoReport } from '@/lib/quality/analyze';
import { CONTENT } from '@/lib/quality/standards';

export const dynamic = 'force-dynamic';

type Seo = {
  metaTitle?: string;
  metaDescription?: string;
  focusKeyword?: string;
  secondaryKeywords?: string[];
  category?: string;
  tags?: string[];
  imageAlt?: string;
  imageBrief?: { subject?: string; setting?: string; mood?: string; composition?: string };
  internalLinkSuggestions?: { anchor: string; targetTopic: string; reason: string }[];
};

type MediaChecks = {
  technical?: { ok: boolean; width: number; height: number; bytes: number; problems: string[] };
  vision?: ImageCheck | null;
  log?: string[];
};

export default async function YaziDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const article = await prisma.article.findUnique({
    where: { id },
    include: {
      site: true,
      topic: true,
      media: true,
      parent: { select: { id: true, title: true, locale: true } },
      children: { select: { id: true, locale: true, status: true, seoScore: true } },
      outboundLinks: {
        include: { to: { select: { id: true, title: true } } },
        orderBy: { createdAt: 'asc' },
      },
      inboundLinks: {
        include: { from: { select: { id: true, title: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      jobs: { orderBy: { startedAt: 'desc' }, take: 14 },
    },
  });
  if (!article) notFound();

  const seo = (article.seo ?? {}) as Seo;
  const report = (article.seoIssues ?? null) as SeoReport | null;
  const critique = (article.critique ?? null) as Critique | null;
  const history = (article.scoreHistory ?? []) as {
    round: number;
    score: number;
    wordCount: number;
    note: string;
  }[];
  const featured = article.media.find((m) => m.role === 'FEATURED');
  const checks = (featured?.checks ?? null) as MediaChecks | null;

  const kaydet = saveArticle.bind(null, article.id);
  const onayla = approveArticle.bind(null, article.id);
  const zorla = forcePublish.bind(null, article.id);
  const yenidenUret = regenerateArticle.bind(null, article.id);
  const kaliteTekrar = rerunQuality.bind(null, article.id);
  const gorselYenile = regenerateImage.bind(null, article.id);
  const kapakYenile = recomposeCover.bind(null, article.id);
  const linkYenile = rerunInterlink.bind(null, article.id);
  const tekrarDene = retryArticle.bind(null, article.id);
  const sil = deleteArticle.bind(null, article.id);

  const hazir = ['NEEDS_REVIEW', 'APPROVED', 'PUBLISHED', 'FAILED'].includes(article.status);
  const engelli = report?.issues.some((i) => i.level === 'error') ?? false;
  const dusukPuan = (article.seoScore ?? 0) < article.site.minSeoScore;

  return (
    <>
      <PageHeader
        back={{ href: '/yazilar', label: 'Yazılar' }}
        title={article.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/siteler/${article.site.id}`} className="hover:underline">
              {article.site.name}
            </Link>
            <span>·</span>
            <span>{article.locale.toUpperCase()}</span>
            {article.parent && (
              <>
                <span>·</span>
                <Link href={`/yazilar/${article.parent.id}`} className="hover:underline">
                  çeviri ← {article.parent.locale.toUpperCase()}
                </Link>
              </>
            )}
            <span>·</span>
            <span>{fmtDate(article.scheduledFor, article.site.timezone)}</span>
            {article.revisionCount > 0 && (
              <>
                <span>·</span>
                <span>{article.revisionCount} otomatik düzeltme</span>
              </>
            )}
          </span>
        }
        actions={
          <>
            <ArticleBadge status={article.status} />
            {article.remoteUrl && (
              <a href={article.remoteUrl} target="_blank" rel="noreferrer noopener" className="btn">
                <IconExternal />
                Sitede aç
              </a>
            )}
          </>
        }
      />

      {/* ------------------------------------------------------- ilerleme */}
      <div className="mb-6 rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        <PipelineProgress status={article.status} />
      </div>

      {article.lastError && (
        <div className="mb-5">
          <Alert tone="err">{article.lastError}</Alert>
        </div>
      )}

      {/* ---------------------------------------------------------- eylemler */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {hazir && article.status !== 'PUBLISHED' && (
          <form action={onayla}>
            <button className="btn-primary">
              <IconCheck />
              Onayla ve yayınla
            </button>
          </form>
        )}
        {(engelli || dusukPuan) && article.status !== 'PUBLISHED' && (
          <form action={zorla}>
            <button className="btn">Uyarılara rağmen yayınla</button>
          </form>
        )}
        <form action={kaliteTekrar}>
          <button className="btn">
            <IconSparkle />
            Kaliteyi yeniden işle
          </button>
        </form>
        <form action={yenidenUret}>
          <button className="btn">
            <IconRefresh />
            Metni yeniden üret
          </button>
        </form>
        <form action={gorselYenile}>
          <button className="btn">
            <IconImage />
            Görseli yenile
          </button>
        </form>
        <form action={kapakYenile}>
          <button className="btn" title="Yeni görsel üretmeden, saklanan fotodan kapağı yeniden oluşturur">
            <IconImage />
            Kapağı yenile (ücretsiz)
          </button>
        </form>
        <form action={linkYenile}>
          <button className="btn">
            <IconLink />
            İç linkleri yenile
          </button>
        </form>
        {article.status === 'FAILED' && (
          <form action={tekrarDene}>
            <button className="btn">Tekrar dene</button>
          </form>
        )}
        <form action={sil} className="ml-auto">
          <button className="btn-ghost" style={{ color: 'var(--err)' }}>
            <IconTrash />
            Sil
          </button>
        </form>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
        {/* -------------------------------------------------------- editör */}
        <form action={kaydet} className="space-y-5">
          <Panel title="İçerik">
            <div className="space-y-4">
              <div>
                <label className="label">Başlık (H1)</label>
                <input name="title" defaultValue={article.title} className="input" />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label">Slug</label>
                  <input
                    name="slug"
                    defaultValue={article.slug ?? ''}
                    className="input font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="label">Odak anahtar kelime</label>
                  <input
                    name="focusKeyword"
                    defaultValue={seo.focusKeyword ?? ''}
                    className="input"
                  />
                </div>
              </div>

              <div>
                <label className="label">
                  SEO başlığı
                  <CharCount
                    len={(seo.metaTitle ?? '').length}
                    min={CONTENT.metaTitle.min}
                    max={CONTENT.metaTitle.max}
                  />
                </label>
                <input name="metaTitle" defaultValue={seo.metaTitle ?? ''} className="input" />
              </div>

              <div>
                <label className="label">
                  Meta açıklama
                  <CharCount
                    len={(seo.metaDescription ?? '').length}
                    min={CONTENT.metaDescription.min}
                    max={CONTENT.metaDescription.max}
                  />
                </label>
                <textarea
                  name="metaDescription"
                  rows={2}
                  defaultValue={seo.metaDescription ?? ''}
                  className="input"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label">Kategori</label>
                  <input name="category" defaultValue={seo.category ?? ''} className="input" />
                </div>
                <div>
                  <label className="label">Etiketler (virgülle)</label>
                  <input name="tags" defaultValue={(seo.tags ?? []).join(', ')} className="input" />
                </div>
              </div>

              <div>
                <label className="label">Özet</label>
                <textarea
                  name="excerpt"
                  rows={2}
                  defaultValue={article.excerpt ?? ''}
                  className="input"
                />
              </div>

              <div>
                <label className="label">Görsel alt metni</label>
                <input
                  name="imageAlt"
                  defaultValue={seo.imageAlt ?? featured?.alt ?? ''}
                  className="input"
                />
              </div>

              <div>
                <label className="label">Gövde (HTML)</label>
                <textarea
                  name="contentHtml"
                  rows={28}
                  defaultValue={article.contentHtml ?? ''}
                  className="input font-mono text-xs leading-5"
                />
                <p className="hint">
                  Kaydettiğinizde kalite denetimi yeniden çalışır. Yalnızca izinli HTML etiketleri
                  korunur.
                </p>
              </div>

              <button type="submit" className="btn-primary">
                Değişiklikleri kaydet
              </button>
            </div>
          </Panel>
        </form>

        {/* ------------------------------------------------------ yan panel */}
        <div className="space-y-5">
          {/* --- kalite --- */}
          <div className="card-pad">
            <div className="flex items-center gap-4">
              <ScoreRing score={article.seoScore} size={72} />
              <div className="min-w-0">
                <div className="text-sm font-semibold">
                  {article.seoScore !== null ? scoreTone(article.seoScore).label : 'Ölçülmedi'}
                </div>
                <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                  Yayın eşiği {article.site.minSeoScore}
                </p>
                {report && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>
                    {report.wordCount} kelime · {report.readingMinutes} dk ·
                    okunabilirlik {report.readability.score}
                  </p>
                )}
              </div>
            </div>

            {report?.areas && (
              <div className="mt-4 space-y-2">
                {report.areas.map((a) => {
                  const pct = Math.round((a.score / a.max) * 100);
                  return (
                    <div key={a.area}>
                      <div className="mb-1 flex justify-between text-xs">
                        <span style={{ color: 'var(--ink-2)' }}>{a.area}</span>
                        <span className="tabular-nums" style={{ color: 'var(--ink-3)' }}>
                          {a.score}/{a.max}
                        </span>
                      </div>
                      <div
                        className="h-1.5 overflow-hidden rounded-full"
                        style={{ background: 'var(--surface-3)' }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            background:
                              pct >= 80 ? 'var(--ok)' : pct >= 55 ? 'var(--warn)' : 'var(--err)',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* --- denetim bulguları --- */}
          {report && (
            <Panel title="Denetim bulguları" icon={<IconAlert />}>
              <ul className="space-y-2">
                {[...report.issues]
                  .sort(
                    (a, b) =>
                      (a.level === 'error' ? 0 : a.level === 'warn' ? 1 : 2) -
                      (b.level === 'error' ? 0 : b.level === 'warn' ? 1 : 2),
                  )
                  .map((i, n) => (
                    <li key={n} className="flex gap-2 text-xs">
                      <span
                        className="mt-1 size-1.5 shrink-0 rounded-full"
                        style={{
                          background:
                            i.level === 'error'
                              ? 'var(--err)'
                              : i.level === 'warn'
                                ? 'var(--warn)'
                                : 'var(--ok)',
                        }}
                      />
                      <span>
                        <span className="font-medium">{i.label}</span>
                        <span style={{ color: 'var(--ink-3)' }}> — {i.detail}</span>
                      </span>
                    </li>
                  ))}
              </ul>
            </Panel>
          )}

          {/* --- AI editör --- */}
          {critique && (
            <Panel title="AI editör değerlendirmesi" icon={<IconSparkle />}>
              <div className="mb-3 flex items-center gap-2">
                <span
                  className={
                    critique.verdict === 'publish'
                      ? 'pill-ok'
                      : critique.verdict === 'revise'
                        ? 'pill-warn'
                        : 'pill-err'
                  }
                >
                  {critique.verdict === 'publish'
                    ? 'Yayına hazır'
                    : critique.verdict === 'revise'
                      ? 'Düzeltme gerekli'
                      : 'Yeniden yazılmalı'}
                </span>
                <span className="text-xs tabular-nums" style={{ color: 'var(--ink-3)' }}>
                  editör puanı {critique.editorScore}
                </span>
              </div>

              {critique.strengths?.length > 0 && (
                <ul className="mb-3 space-y-1">
                  {critique.strengths.map((s, n) => (
                    <li key={n} className="flex gap-2 text-xs">
                      <IconCheck className="mt-0.5 size-3 shrink-0" style={{ color: 'var(--ok)' }} />
                      <span style={{ color: 'var(--ink-2)' }}>{s}</span>
                    </li>
                  ))}
                </ul>
              )}

              {critique.issues?.length > 0 && (
                <ul className="space-y-2">
                  {critique.issues.map((i, n) => (
                    <li key={n} className="text-xs">
                      <span
                        className={
                          i.severity === 'high'
                            ? 'pill-err'
                            : i.severity === 'medium'
                              ? 'pill-warn'
                              : 'pill-neutral'
                        }
                      >
                        {i.area}
                      </span>
                      <p className="mt-1">{i.problem}</p>
                      <p style={{ color: 'var(--ink-3)' }}>→ {i.fix}</p>
                    </li>
                  ))}
                </ul>
              )}

              {critique.factRisks?.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 text-xs font-medium" style={{ color: 'var(--warn)' }}>
                    Doğrulanmalı
                  </div>
                  <ul className="space-y-1">
                    {critique.factRisks.map((f, n) => (
                      <li key={n} className="text-xs" style={{ color: 'var(--ink-2)' }}>
                        • {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Panel>
          )}

          {/* --- düzeltme geçmişi --- */}
          {history.length > 1 && (
            <Panel title="Kalite geçmişi">
              <ul className="space-y-2">
                {history.map((h, n) => (
                  <li key={n} className="flex items-center gap-2 text-xs">
                    <ScorePill score={h.score} />
                    <span style={{ color: 'var(--ink-3)' }}>
                      {h.wordCount} kelime · {h.note}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {/* --- görsel --- */}
          <Panel title="Öne çıkan görsel" icon={<IconImage />}>
            {featured?.localPath ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/media/${featured.localPath}`}
                  alt={featured.alt ?? ''}
                  className="w-full rounded-lg"
                  style={{ border: '1px solid var(--line)' }}
                />
                <p className="mt-2 text-xs" style={{ color: 'var(--ink-3)' }}>
                  {featured.provider} · {featured.width}×{featured.height} ·{' '}
                  {Math.round((featured.bytes ?? 0) / 1024)} KB · {featured.attempts} deneme
                </p>

                {checks?.vision && (
                  <div className="mt-3 space-y-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      <span className={checks.vision.pass ? 'pill-ok' : 'pill-warn'}>
                        görsel denetim {checks.vision.score}
                      </span>
                      {checks.vision.hasText && <span className="pill-err">metin var</span>}
                      {checks.vision.hasWatermark && <span className="pill-err">filigran</span>}
                      {!checks.vision.relevant && <span className="pill-err">konu dışı</span>}
                    </div>
                    {checks.vision.notes && (
                      <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                        {checks.vision.notes}
                      </p>
                    )}
                    {checks.vision.artifacts?.length > 0 && (
                      <p className="text-xs" style={{ color: 'var(--warn)' }}>
                        {checks.vision.artifacts.join(', ')}
                      </p>
                    )}
                  </div>
                )}

                {checks?.technical && !checks.technical.ok && (
                  <p className="mt-2 text-xs" style={{ color: 'var(--warn)' }}>
                    {checks.technical.problems.join(' ')}
                  </p>
                )}

                {featured.remoteMediaId && (
                  <p className="mt-2 text-xs" style={{ color: 'var(--ok)' }}>
                    Siteye yüklendi (#{featured.remoteMediaId})
                  </p>
                )}

                {featured.prompt && (
                  <details className="mt-3">
                    <summary
                      className="cursor-pointer text-xs"
                      style={{ color: 'var(--ink-3)' }}
                    >
                      Kullanılan prompt
                    </summary>
                    <p className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>
                      {featured.prompt}
                    </p>
                  </details>
                )}
              </>
            ) : (
              <p className="text-sm" style={{ color: 'var(--ink-3)' }}>
                {article.status === 'IMAGING' ? 'Üretiliyor...' : 'Görsel yok.'}
              </p>
            )}
          </Panel>

          {/* --- iç linkler --- */}
          <Panel title="İç linkler" icon={<IconLink />}>
            <div className="mb-3 flex gap-4 text-xs">
              <span>
                <strong className="tabular-nums">{article.outboundLinks.length}</strong> giden
                {article.outboundLinks.some((l) => l.external) && (
                  <span style={{ color: 'var(--ink-3)' }}>
                    {' '}
                    ({article.outboundLinks.filter((l) => l.external).length} site sayfası)
                  </span>
                )}
              </span>
              <span>
                <strong className="tabular-nums">{article.inboundLinks.length}</strong> gelen
              </span>
            </div>

            {article.outboundLinks.length === 0 && article.inboundLinks.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                {article.site.interlink
                  ? 'Henüz link yok. Sitenin sayfa dizini boşsa bağlantıyı test edip dizini tazeleyin.'
                  : 'Bu sitede iç linkleme kapalı.'}
              </p>
            ) : (
              <div className="space-y-3">
                {article.outboundLinks.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-medium" style={{ color: 'var(--ink-3)' }}>
                      Bu yazıdan gidenler
                    </div>
                    <ul className="space-y-1">
                      {article.outboundLinks.map((l) => (
                        <li key={l.id} className="text-xs">
                          <span className="pill-accent">{l.anchor}</span>{' '}
                          {l.to ? (
                            <Link href={`/yazilar/${l.to.id}`} className="hover:underline">
                              {l.to.title}
                            </Link>
                          ) : (
                            <a
                              href={l.targetUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="hover:underline"
                            >
                              {l.targetTitle ?? l.targetUrl}
                            </a>
                          )}
                          {l.external && (
                            <span className="ml-1" style={{ color: 'var(--ink-3)' }}>
                              (site sayfası)
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {article.inboundLinks.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-medium" style={{ color: 'var(--ink-3)' }}>
                      Bu yazıya gelenler
                    </div>
                    <ul className="space-y-1">
                      {article.inboundLinks.map((l) => (
                        <li key={l.id} className="text-xs">
                          <Link href={`/yazilar/${l.from.id}`} className="hover:underline">
                            {l.from.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Panel>

          {/* --- çeviriler --- */}
          {article.children.length > 0 && (
            <Panel title="Çeviriler">
              <ul className="space-y-2">
                {article.children.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <Link href={`/yazilar/${c.id}`} className="text-sm hover:underline">
                      {c.locale.toUpperCase()}
                    </Link>
                    <div className="flex items-center gap-2">
                      <ScorePill score={c.seoScore} />
                      <ArticleBadge status={c.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {/* --- iç link önerileri --- */}
          {seo.internalLinkSuggestions?.length ? (
            <Panel title="İç link önerileri">
              <ul className="space-y-2 text-xs">
                {seo.internalLinkSuggestions.map((l, n) => (
                  <li key={n}>
                    <span className="font-medium">{l.anchor}</span>
                    <span className="block" style={{ color: 'var(--ink-3)' }}>
                      → {l.targetTopic}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {/* --- işlem geçmişi --- */}
          <Panel title="İşlem geçmişi">
            <ul className="space-y-2.5">
              {article.jobs.map((j) => (
                <li key={j.id} className="flex gap-2 text-xs">
                  <span
                    className="mt-1 size-1.5 shrink-0 rounded-full"
                    style={{
                      background:
                        j.status === 'FAILED'
                          ? 'var(--err)'
                          : j.status === 'RUNNING'
                            ? 'var(--info)'
                            : 'var(--ok)',
                    }}
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{j.kind}</span>
                    {j.step && <span style={{ color: 'var(--ink-3)' }}> / {j.step}</span>}
                    {j.message && (
                      <span className="block break-words" style={{ color: 'var(--ink-3)' }}>
                        {j.message}
                      </span>
                    )}
                    <span className="block" style={{ color: 'var(--ink-3)' }}>
                      {fmtDate(j.startedAt)}
                      {j.durationMs ? ` · ${(j.durationMs / 1000).toFixed(1)}s` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p
              className="mt-3 pt-3 text-xs"
              style={{ borderTop: '1px solid var(--line)', color: 'var(--ink-3)' }}
            >
              Toplam maliyet {fmtMoney(article.costUsd)} · {article.tokensIn ?? 0} giriş /{' '}
              {article.tokensOut ?? 0} çıkış token
            </p>
          </Panel>
        </div>
      </div>

      {/* ---------------------------------------------------------- önizleme */}
      {article.contentHtml && (
        <details className="card-pad mt-5">
          <summary className="cursor-pointer text-sm font-semibold">Önizleme</summary>
          <article
            className="prose-article mt-5 max-w-3xl"
            dangerouslySetInnerHTML={{ __html: article.contentHtml }}
          />
        </details>
      )}
    </>
  );
}

function CharCount({ len, min, max }: { len: number; min: number; max: number }) {
  const ok = len >= min && len <= max;
  return (
    <span
      className="ml-1.5 tabular-nums"
      style={{ color: len === 0 ? 'var(--ink-3)' : ok ? 'var(--ok)' : 'var(--warn)' }}
    >
      {len}/{max}
    </span>
  );
}

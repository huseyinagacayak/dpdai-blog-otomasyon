import Link from 'next/link';
import type { ArticleStatus } from '@prisma/client';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';
import { IconArticle, IconExternal } from '@/components/icons';
import { PipelineProgress } from '@/components/PipelineProgress';
import { ACTIVE_STATUSES } from '@/lib/pipelineStages';
import {
  ARTICLE_LABEL,
  ArticleBadge,
  EmptyState,
  FilterChip,
  PageHeader,
  ScorePill,
  fmtDate,
} from '@/components/ui';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const DURUMLAR: ArticleStatus[] = [
  'NEEDS_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'QUEUED',
  'DRAFTING',
  'REVISING',
  'IMAGING',
  'TRANSLATING',
  'FAILED',
];

export default async function YazilarPage({
  searchParams,
}: {
  searchParams: Promise<{ durum?: string; site?: string; dil?: string }>;
}) {
  const sp = await searchParams;
  const l = await getLocale();

  const [sites, articles, counts] = await Promise.all([
    prisma.site.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.article.findMany({
      where: {
        ...(sp.durum ? { status: sp.durum as ArticleStatus } : {}),
        ...(sp.site ? { siteId: sp.site } : {}),
        ...(sp.dil ? { locale: sp.dil } : {}),
      },
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      include: {
        site: { select: { id: true, name: true, timezone: true } },
        parent: { select: { id: true, locale: true } },
      },
    }),
    prisma.article.groupBy({ by: ['status'], _count: true }),
  ]);

  const countOf = (s: ArticleStatus) => counts.find((c) => c.status === s)?._count ?? 0;

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/yazilar?${s}` : '/yazilar';
  };

  return (
    <>
      <PageHeader title={t(l, 'Yazılar')} subtitle={`${articles.length} ${t(l, 'kayıt gösteriliyor')}`} />

      <div className="mb-5 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <FilterChip href={qs({ durum: undefined })} active={!sp.durum}>
            Tümü
          </FilterChip>
          {DURUMLAR.filter((d) => countOf(d) > 0 || sp.durum === d).map((d) => (
            <FilterChip key={d} href={qs({ durum: d })} active={sp.durum === d} count={countOf(d)}>
              {ARTICLE_LABEL[d]}
            </FilterChip>
          ))}
        </div>
        {sites.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <FilterChip href={qs({ site: undefined })} active={!sp.site}>
              Tüm siteler
            </FilterChip>
            {sites.map((s) => (
              <FilterChip key={s.id} href={qs({ site: s.id })} active={sp.site === s.id}>
                {s.name}
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      {articles.length === 0 ? (
        <EmptyState
          icon={<IconArticle className="size-5" />}
          title="Yazı bulunamadı"
          hint="Konu havuzuna başlık ekleyin; sistem takvime göre üretmeye başlar."
          action={
            <Link href="/konular" className="btn-primary mt-3">
              Konu havuzu
            </Link>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Başlık</th>
                <th>Site</th>
                <th>Dil</th>
                <th>Durum</th>
                <th>Kalite</th>
                <th>Kelime</th>
                <th>Yayın</th>
              </tr>
            </thead>
            <tbody>
              {articles.map((a) => (
                <tr key={a.id}>
                  <td className="max-w-lg">
                    <Link
                      href={`/yazilar/${a.id}`}
                      className="block truncate font-medium hover:underline"
                    >
                      {a.title}
                    </Link>
                    {a.lastError && (
                      <div className="truncate text-xs" style={{ color: 'var(--err)' }}>
                        {a.lastError}
                      </div>
                    )}
                    {!a.lastError && a.revisionCount > 0 && (
                      <div className="text-xs" style={{ color: 'var(--ink-3)' }}>
                        {a.revisionCount} otomatik düzeltme turu
                      </div>
                    )}
                  </td>
                  <td className="text-xs whitespace-nowrap">{a.site.name}</td>
                  <td className="text-xs whitespace-nowrap">
                    {a.locale.toUpperCase()}
                    {a.parent && (
                      <span style={{ color: 'var(--ink-3)' }}>
                        {' '}
                        ← {a.parent.locale.toUpperCase()}
                      </span>
                    )}
                  </td>
                  <td className="min-w-[120px]">
                    <ArticleBadge status={a.status} />
                    {ACTIVE_STATUSES.includes(a.status) && (
                      <div className="mt-1.5">
                        <PipelineProgress status={a.status} compact />
                      </div>
                    )}
                  </td>
                  <td>
                    <ScorePill score={a.seoScore} />
                  </td>
                  <td className="text-xs tabular-nums" style={{ color: 'var(--ink-3)' }}>
                    {a.wordCount ?? '—'}
                  </td>
                  <td className="text-xs tabular-nums whitespace-nowrap" style={{ color: 'var(--ink-3)' }}>
                    {a.remoteUrl ? (
                      <a
                        href={a.remoteUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        {fmtDate(a.publishedAt ?? a.scheduledFor, a.site.timezone)}
                        <IconExternal className="size-3" />
                      </a>
                    ) : (
                      fmtDate(a.scheduledFor, a.site.timezone)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

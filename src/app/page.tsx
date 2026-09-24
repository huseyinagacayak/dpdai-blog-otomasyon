import Link from 'next/link';
import {
  Alert,
  ArticleBadge,
  EmptyState,
  PageHeader,
  Panel,
  ScorePill,
  ScoreRing,
  Stat,
  fmtDate,
  fmtMoney,
} from '@/components/ui';
import { AreaChart } from '@/components/charts';
import { IconAlert, IconCalendar, IconChart, IconRefresh, IconSparkle } from '@/components/icons';
import { replan } from '@/lib/actions/topics';
import { getBudgetStatus } from '@/lib/budget';
import { prisma } from '@/lib/db';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function OzetPage() {
  const l = await getLocale();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    needsReview,
    publishedWeek,
    topicPool,
    activeSites,
    failed,
    upcoming,
    reviewList,
    recentErrors,
    avgScore,
    revised,
  ] = await Promise.all([
    prisma.article.count({ where: { status: 'NEEDS_REVIEW' } }),
    prisma.article.count({ where: { status: 'PUBLISHED', publishedAt: { gte: weekAgo } } }),
    prisma.topic.count({ where: { status: 'QUEUED' } }),
    prisma.site.count({ where: { status: 'ACTIVE' } }),
    prisma.article.count({ where: { status: 'FAILED' } }),
    prisma.article.findMany({
      where: { scheduledFor: { gte: now }, status: { notIn: ['PUBLISHED', 'FAILED'] } },
      orderBy: { scheduledFor: 'asc' },
      take: 10,
      include: { site: { select: { name: true, timezone: true } } },
    }),
    prisma.article.findMany({
      where: { status: 'NEEDS_REVIEW' },
      orderBy: [{ seoScore: 'asc' }, { scheduledFor: 'asc' }],
      take: 8,
      include: { site: { select: { name: true } } },
    }),
    prisma.jobRun.findMany({
      where: { status: 'FAILED' },
      orderBy: { startedAt: 'desc' },
      take: 5,
      include: { site: { select: { name: true } } },
    }),
    prisma.article.aggregate({
      _avg: { seoScore: true },
      where: { seoScore: { not: null }, createdAt: { gte: monthStart } },
    }),
    prisma.article.aggregate({
      _sum: { revisionCount: true },
      where: { createdAt: { gte: monthStart } },
    }),
  ]);

  const budget = await getBudgetStatus();

  // Son 14 gunun uretim/yayin akisi (ozet grafigi)
  const sonIki = new Date(now.getTime() - 13 * 24 * 3600_000);
  sonIki.setHours(0, 0, 0, 0);
  const sonYazilar = await prisma.article.findMany({
    where: { createdAt: { gte: sonIki } },
    select: { createdAt: true, publishedAt: true },
  });

  const gunAnahtari = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const uretimGun = new Map<string, number>();
  const yayinGun = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 3600_000);
    uretimGun.set(gunAnahtari(d), 0);
    yayinGun.set(gunAnahtari(d), 0);
  }
  for (const a of sonYazilar) {
    const k = gunAnahtari(a.createdAt);
    if (uretimGun.has(k)) uretimGun.set(k, (uretimGun.get(k) ?? 0) + 1);
    if (a.publishedAt) {
      const p = gunAnahtari(a.publishedAt);
      if (yayinGun.has(p)) yayinGun.set(p, (yayinGun.get(p) ?? 0) + 1);
    }
  }
  const akis = [...uretimGun.entries()].map(([k, v]) => ({
    label: new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(new Date(k)),
    value: v,
    value2: yayinGun.get(k) ?? 0,
  }));

  async function planla() {
    'use server';
    await replan();
  }

  const ortalama = Math.round(avgScore._avg.seoScore ?? 0);

  return (
    <>
      <PageHeader
        title={t(l, 'Özet')}
        subtitle={`${fmtDate(now)} · ${t(l, 'üretim hattı ve yayın takvimi')}`}
        actions={
          <form action={planla}>
            <button className="btn">
              <IconRefresh />
              {t(l, 'Takvimi yeniden hesapla')}
            </button>
          </form>
        }
      />

      {/* ---------------------------------------------------------- ölçüler */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Stat
          label={t(l, 'İnceleme bekliyor')}
          value={needsReview}
          href="/yazilar?durum=NEEDS_REVIEW"
          tone={needsReview > 0 ? 'warn' : undefined}
        />
        <Stat label={t(l, 'Son 7 günde yayında')} value={publishedWeek} href="/yazilar?durum=PUBLISHED" />
        <Stat label={t(l, 'Havuzdaki konu')} value={topicPool} href="/konular" />
        <Stat label={t(l, 'Aktif site')} value={activeSites} href="/siteler" />
        <Stat
          label={t(l, 'Bu ay maliyet')}
          value={fmtMoney(budget.spent)}
          hint={
            budget.limit > 0
              ? `${t(l, 'bütçe')} ${fmtMoney(budget.limit)} · %${Math.round(budget.ratio * 100)} ${t(l, 'kullanıldı')}`
              : `${revised._sum.revisionCount ?? 0} ${t(l, 'otomatik düzeltme turu')}`
          }
          tone={budget.limit > 0 && !budget.allowed ? 'err' : budget.warning ? 'warn' : undefined}
          href="/kayitlar"
        />
      </div>

      {budget.limit > 0 && !budget.allowed && (
        <div className="mt-4">
          <Alert tone="err" title={t(l, 'Aylık bütçe doldu')}>
            {t(l, 'Bu ay {x} harcandı. Yeni üretim durduruldu; onaylı yazıların yayını sürüyor.')
              .replace('{x}', `${fmtMoney(budget.spent)} / ${fmtMoney(budget.limit)}`)}{' '}
            <Link href="/ayarlar" className="underline">
              {t(l, 'Bütçeyi ayarla')}
            </Link>
          </Alert>
        </div>
      )}

      {budget.limit > 0 && budget.allowed && budget.warning && (
        <div className="mt-4">
          <Alert tone="warn" title={t(l, 'Bütçenin sonuna yaklaşıldı')}>
            {t(l, 'Bu ay {x} harcandı').replace('{x}', `${fmtMoney(budget.spent)} / ${fmtMoney(budget.limit)}`)}{' '}
            (%{Math.round(budget.ratio * 100)}).
          </Alert>
        </div>
      )}

      {failed > 0 && (
        <div className="mt-4">
          <Alert tone="err" title={`${failed} ${t(l, 'yazı hata durumunda')}`}>
            <Link href="/yazilar?durum=FAILED" className="underline">
              {t(l, 'Hatalı yazıları görüntüle')}
            </Link>{' '}
            {t(l, '— çoğu durumda "Tekrar dene" yeterli olur.')}
          </Alert>
        </div>
      )}

      <div className="mt-5">
        <Panel
          title={t(l, 'Son 14 gün')}
          icon={<IconChart />}
          action={
            <Link href="/istatistik" className="text-xs hover:underline" style={{ color: 'var(--ink-3)' }}>
              {t(l, 'tüm istatistikler')}
            </Link>
          }
        >
          <AreaChart data={akis} labels={[t(l, 'üretilen'), t(l, 'yayınlanan')]} height={150} />
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_260px]">
        {/* ------------------------------------------------ inceleme kuyruğu */}
        <Panel
          title={t(l, 'Onayını bekleyenler')}
          icon={<IconSparkle />}
          action={
            <Link href="/yazilar?durum=NEEDS_REVIEW" className="text-xs hover:underline"
              style={{ color: 'var(--ink-3)' }}>
              {t(l, 'tümü')}
            </Link>
          }
        >
          {reviewList.length === 0 ? (
            <p className="py-8 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
              {t(l, 'Bekleyen yazı yok.')}
            </p>
          ) : (
            <ul className="-my-2">
              {reviewList.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-3 py-2.5"
                  style={{ borderBottom: '1px solid var(--line)' }}
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/yazilar/${a.id}`}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {a.title}
                    </Link>
                    <div className="mt-0.5 text-xs" style={{ color: 'var(--ink-3)' }}>
                      {a.site.name} · {a.locale.toUpperCase()} · {a.wordCount ?? 0} {t(l, 'kelime')}
                      {a.revisionCount > 0 && ` · ${a.revisionCount} ${t(l, 'düzeltme')}`}
                    </div>
                  </div>
                  <ScorePill score={a.seoScore} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* ------------------------------------------------------- takvim */}
        <Panel title={t(l, 'Yaklaşan yayınlar')} icon={<IconCalendar />}>
          {upcoming.length === 0 ? (
            <EmptyState
              title={t(l, 'Takvimde yazı yok')}
              hint={t(l, 'Konu havuzuna başlık ekleyin; sistem takvime dizip üretmeye başlar.')}
              action={
                <Link href="/konular" className="btn-primary mt-3">
                  {t(l, 'Konu havuzu')}
                </Link>
              }
            />
          ) : (
            <ul className="-my-2">
              {upcoming.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-3 py-2.5"
                  style={{ borderBottom: '1px solid var(--line)' }}
                >
                  <div
                    className="w-24 shrink-0 text-xs tabular-nums"
                    style={{ color: 'var(--ink-3)' }}
                  >
                    {fmtDate(a.scheduledFor, a.site.timezone)}
                  </div>
                  <Link
                    href={`/yazilar/${a.id}`}
                    className="min-w-0 flex-1 truncate text-sm hover:underline"
                  >
                    {a.title}
                  </Link>
                  <ArticleBadge status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* --------------------------------------------------- kalite özeti */}
        <div className="space-y-5">
          <div className="card-pad flex flex-col items-center text-center">
            <div className="mb-3 text-xs font-medium" style={{ color: 'var(--ink-3)' }}>
              {t(l, 'Bu ayki ortalama kalite')}
            </div>
            <ScoreRing score={ortalama || null} size={92} />
            <p className="mt-3 text-xs" style={{ color: 'var(--ink-3)' }}>
              {t(l, 'Üretilen yazıların otomatik denetim ortalaması')}
            </p>
          </div>

          {recentErrors.length > 0 && (
            <Panel title={t(l, 'Son hatalar')} icon={<IconAlert />}>
              <ul className="space-y-3">
                {recentErrors.map((j) => (
                  <li key={j.id} className="text-xs">
                    <div className="flex items-center gap-2">
                      <span className="pill-err">{j.kind}</span>
                      <span style={{ color: 'var(--ink-3)' }}>{fmtDate(j.startedAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2" style={{ color: 'var(--err)' }}>
                      {j.message}
                    </p>
                    {j.articleId && (
                      <Link href={`/yazilar/${j.articleId}`} className="hover:underline"
                        style={{ color: 'var(--ink-3)' }}>
                        {t(l, 'yazıyı aç →')}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

import type { ArticleStatus } from '@prisma/client';
import { AreaChart, BarList, CalendarHeatmap, ColumnChart, Donut } from '@/components/charts';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';
import { IconActivity, IconCalendar, IconGlobe, IconSparkle } from '@/components/icons';
import {
  ARTICLE_LABEL,
  FilterChip,
  PageHeader,
  Panel,
  ScoreRing,
  Stat,
  fmtMoney,
  scoreTone,
} from '@/components/ui';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const RANGES = [
  { days: 7, label: '7 gün' },
  { days: 30, label: '30 gün' },
  { days: 90, label: '90 gün' },
];

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STATUS_COLOR: Partial<Record<ArticleStatus, string>> = {
  PUBLISHED: 'var(--ok)',
  APPROVED: 'var(--info)',
  NEEDS_REVIEW: 'var(--warn)',
  FAILED: 'var(--err)',
};

export default async function IstatistikPage({
  searchParams,
}: {
  searchParams: Promise<{ gun?: string }>;
}) {
  const sp = await searchParams;
  const l = await getLocale();
  const days = RANGES.find((r) => String(r.days) === sp.gun)?.days ?? 30;

  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 3600_000);
  since.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [articles, sites, jobs, statusGroups, credentials, publishedAll] = await Promise.all([
    prisma.article.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true,
        siteId: true,
        locale: true,
        status: true,
        seoScore: true,
        wordCount: true,
        revisionCount: true,
        costUsd: true,
        createdAt: true,
        publishedAt: true,
      },
    }),
    prisma.site.findMany({ select: { id: true, name: true } }),
    prisma.jobRun.findMany({
      where: { startedAt: { gte: since } },
      select: { kind: true, status: true, costUsd: true, durationMs: true, startedAt: true },
    }),
    prisma.article.groupBy({ by: ['status'], _count: true }),
    prisma.apiCredential.findMany({
      orderBy: [{ kind: 'asc' }, { priority: 'asc' }],
      select: { label: true, kind: true, calls: true, fails: true, costUsd: true, free: true },
    }),
    prisma.article.findMany({
      where: { publishedAt: { not: null } },
      select: { publishedAt: true },
      take: 2000,
    }),
  ]);

  const siteName = new Map(sites.map((s) => [s.id, s.name]));

  /* ---------------------------------------------------------- zaman serisi */

  const uretim = new Map<string, number>();
  const yayin = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 3600_000);
    uretim.set(dayKey(d), 0);
    yayin.set(dayKey(d), 0);
  }
  for (const a of articles) {
    const k = dayKey(a.createdAt);
    if (uretim.has(k)) uretim.set(k, (uretim.get(k) ?? 0) + 1);
    if (a.publishedAt) {
      const p = dayKey(a.publishedAt);
      if (yayin.has(p)) yayin.set(p, (yayin.get(p) ?? 0) + 1);
    }
  }

  const seri = [...uretim.entries()].map(([k, v]) => ({
    label: new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(
      new Date(k),
    ),
    value: v,
    value2: yayin.get(k) ?? 0,
  }));

  /* -------------------------------------------------------------- ölçüler */

  const uretilen = articles.length;
  const yayinlanan = articles.filter((a) => a.status === 'PUBLISHED').length;
  const puanlilar = articles.filter((a) => a.seoScore !== null);
  const ortPuan = puanlilar.length
    ? Math.round(puanlilar.reduce((s, a) => s + (a.seoScore ?? 0), 0) / puanlilar.length)
    : 0;
  const ortKelime = articles.filter((a) => a.wordCount).length
    ? Math.round(
        articles.reduce((s, a) => s + (a.wordCount ?? 0), 0) /
          articles.filter((a) => a.wordCount).length,
      )
    : 0;
  const toplamMaliyet = jobs.reduce((s, j) => s + j.costUsd, 0);
  const duzeltme = articles.reduce((s, a) => s + a.revisionCount, 0);
  const yazıBasi = uretilen ? toplamMaliyet / uretilen : 0;

  /* ---------------------------------------------------------- site bazında */

  const siteMap = new Map<string, { adet: number; puanTop: number; puanAdet: number }>();
  for (const a of articles) {
    const e = siteMap.get(a.siteId) ?? { adet: 0, puanTop: 0, puanAdet: 0 };
    e.adet++;
    if (a.seoScore !== null) {
      e.puanTop += a.seoScore;
      e.puanAdet++;
    }
    siteMap.set(a.siteId, e);
  }

  const siteUretim = [...siteMap.entries()]
    .map(([id, e]) => ({ label: siteName.get(id) ?? id, value: e.adet }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const siteKalite = [...siteMap.entries()]
    .filter(([, e]) => e.puanAdet > 0)
    .map(([id, e]) => ({
      label: siteName.get(id) ?? id,
      value: Math.round(e.puanTop / e.puanAdet),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  /* ------------------------------------------------------- kalite dağılımı */

  const bantlar = [
    { label: '0-59', min: 0, max: 59 },
    { label: '60-69', min: 60, max: 69 },
    { label: '70-79', min: 70, max: 79 },
    { label: '80-89', min: 80, max: 89 },
    { label: '90-100', min: 90, max: 100 },
  ];
  const puanDagilim = bantlar.map((b) => ({
    label: b.label,
    value: puanlilar.filter((a) => (a.seoScore ?? 0) >= b.min && (a.seoScore ?? 0) <= b.max).length,
  }));

  /* ------------------------------------------------------------ durumlar */

  const durumlar = statusGroups
    .filter((g) => g._count > 0)
    .map((g) => ({
      label: ARTICLE_LABEL[g.status],
      value: g._count,
      color: STATUS_COLOR[g.status] ?? 'var(--ink-3)',
    }))
    .sort((a, b) => b.value - a.value);

  /* -------------------------------------------------------------- adımlar */

  const KIND_LABEL: Record<string, string> = {
    outline: 'Plan',
    draft: 'Metin',
    seo: 'SEO',
    critique: 'Editör',
    revise: 'Düzeltme',
    interlink: 'İç link',
    image: 'Görsel',
    translate: 'Çeviri',
    publish: 'Yayın',
    audit: 'Site denetimi',
    discover: 'Keşif',
  };

  const adimMap = new Map<string, { cost: number; ms: number; adet: number; hata: number }>();
  for (const j of jobs) {
    const e = adimMap.get(j.kind) ?? { cost: 0, ms: 0, adet: 0, hata: 0 };
    e.cost += j.costUsd;
    e.ms += j.durationMs ?? 0;
    e.adet++;
    if (j.status === 'FAILED') e.hata++;
    adimMap.set(j.kind, e);
  }

  const adimMaliyet = [...adimMap.entries()]
    .filter(([, e]) => e.cost > 0)
    .map(([k, e]) => ({ label: KIND_LABEL[k] ?? k, value: Number(e.cost.toFixed(2)) }))
    .sort((a, b) => b.value - a.value);

  const adimSure = [...adimMap.entries()]
    .filter(([, e]) => e.adet > 0 && e.ms > 0)
    .map(([k, e]) => ({ label: KIND_LABEL[k] ?? k, value: Math.round(e.ms / e.adet / 1000) }))
    .sort((a, b) => b.value - a.value);

  const hataliAdim = [...adimMap.entries()]
    .filter(([, e]) => e.hata > 0)
    .map(([k, e]) => ({
      label: KIND_LABEL[k] ?? k,
      value: Math.round((e.hata / e.adet) * 100),
    }))
    .sort((a, b) => b.value - a.value);

  /* ------------------------------------------------------------- takvim */

  const takvim: Record<string, number> = {};
  for (const a of publishedAll) {
    if (!a.publishedAt) continue;
    const k = dayKey(a.publishedAt);
    takvim[k] = (takvim[k] ?? 0) + 1;
  }

  /* ------------------------------------------------------------- havuz */

  const havuzKullanim = credentials
    .filter((c) => c.calls > 0)
    .map((c) => ({
      label: `${c.label}${c.free ? ' (ücretsiz)' : ''}`,
      value: c.calls,
    }))
    .sort((a, b) => b.value - a.value);

  const aylikMaliyet = await prisma.jobRun.aggregate({
    _sum: { costUsd: true },
    where: { startedAt: { gte: monthStart } },
  });

  return (
    <>
      <PageHeader
        title={t(l, 'İstatistikler')}
        subtitle={`Son ${days} günün üretim, kalite ve maliyet görünümü`}
        actions={
          <div className="flex gap-1.5">
            {RANGES.map((r) => (
              <FilterChip
                key={r.days}
                href={`/istatistik?gun=${r.days}`}
                active={days === r.days}
              >
                {r.label}
              </FilterChip>
            ))}
          </div>
        }
      />

      {/* ------------------------------------------------------------ özet */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Üretilen yazı" value={uretilen} />
        <Stat label="Yayınlanan" value={yayinlanan} tone={yayinlanan > 0 ? 'ok' : undefined} />
        <Stat label="Ortalama kalite" value={ortPuan || '—'} />
        <Stat label="Ortalama uzunluk" value={ortKelime ? `${ortKelime}` : '—'} hint="kelime" />
        <Stat label="Dönem maliyeti" value={fmtMoney(toplamMaliyet)} hint={`yazı başı ${fmtMoney(yazıBasi)}`} />
        <Stat label="Bu ay toplam" value={fmtMoney(aylikMaliyet._sum.costUsd ?? 0)} />
      </div>

      {/* -------------------------------------------------------- zaman serisi */}
      <div className="mt-5">
        <Panel title="Üretim ve yayın akışı" icon={<IconActivity />}>
          <AreaChart data={seri} labels={['üretilen', 'yayınlanan']} height={200} />
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {/* ------------------------------------------------------ durumlar */}
        <Panel title="Yazı durumları" icon={<IconSparkle />}>
          <Donut data={durumlar} centerLabel="yazı" />
        </Panel>

        {/* ------------------------------------------------- kalite dağılımı */}
        <Panel title="Kalite puanı dağılımı">
          <ColumnChart
            data={puanDagilim}
            height={150}
            colorBy={(d) =>
              d.label === '0-59'
                ? 'var(--err)'
                : d.label === '60-69'
                  ? 'var(--warn)'
                  : d.label === '70-79'
                    ? 'var(--info)'
                    : 'var(--ok)'
            }
          />
          <div className="mt-4 flex items-center gap-4">
            <ScoreRing score={ortPuan || null} size={56} />
            <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
              {puanlilar.length} yazı denetlendi · ortalama {ortPuan} ({scoreTone(ortPuan).label})
              · {duzeltme} otomatik düzeltme turu
            </p>
          </div>
        </Panel>

        {/* ---------------------------------------------------- site bazında */}
        <Panel title="Site başına üretim" icon={<IconGlobe />}>
          <BarList data={siteUretim} format={(v) => `${v} yazı`} />
        </Panel>

        <Panel title="Site başına ortalama kalite">
          <BarList
            data={siteKalite}
            max={100}
            format={(v) => String(v)}
            colorBy={(d) => scoreTone(d.value).color}
          />
        </Panel>

        {/* ------------------------------------------------------- maliyet */}
        <Panel title="Adım başına maliyet">
          <BarList data={adimMaliyet} format={(v) => fmtMoney(v)} />
          {adimMaliyet.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
              Henüz ücretli çağrı yapılmadı.
            </p>
          )}
        </Panel>

        <Panel title="Adım başına ortalama süre">
          <BarList data={adimSure} format={(v) => `${v} sn`} />
        </Panel>

        {/* -------------------------------------------------------- havuz */}
        <Panel title="Sağlayıcı kullanımı">
          <BarList data={havuzKullanim} format={(v) => `${v} çağrı`} />
          {havuzKullanim.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
              Henüz sağlayıcı çağrısı yapılmadı.
            </p>
          )}
        </Panel>

        {/* --------------------------------------------------- hata oranları */}
        <Panel title="Adım başına hata oranı">
          {hataliAdim.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--ok)' }}>
              Bu dönemde hiç hata yok.
            </p>
          ) : (
            <BarList
              data={hataliAdim}
              max={100}
              format={(v) => `%${v}`}
              colorBy={(d) => (d.value > 30 ? 'var(--err)' : 'var(--warn)')}
            />
          )}
        </Panel>
      </div>

      {/* ------------------------------------------------------------ takvim */}
      <div className="mt-5">
        <Panel title="Yayın yoğunluğu" icon={<IconCalendar />}>
          <p className="mb-3 text-xs" style={{ color: 'var(--ink-3)' }}>
            Son 13 haftanın günlük yayın sayısı. Boşluklar yayın yapılmayan günleri gösterir.
          </p>
          <CalendarHeatmap data={takvim} />
        </Panel>
      </div>
    </>
  );
}

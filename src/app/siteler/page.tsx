import Link from 'next/link';
import { IconGlobe, IconPlus } from '@/components/icons';
import { EmptyState, PageHeader, ScorePill, SiteBadge, fmtDate } from '@/components/ui';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const I18N_LABEL: Record<string, string> = {
  NONE: 'Tek dil',
  POLYLANG: 'Polylang',
  WPML: 'WPML',
  SIBLING: 'Ayrı siteler',
};

const QUALITY_LABEL: Record<string, string> = {
  OFF: 'kapalı',
  CHECK: 'denetim',
  AUTONOMOUS: 'otonom',
};

export default async function SitelerPage() {
  const sites = await prisma.site.findMany({
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { topics: true, articles: true } },
      audits: { orderBy: { createdAt: 'desc' }, take: 1, select: { score: true, createdAt: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="Siteler"
        subtitle={`${sites.length} site kayıtlı`}
        actions={
          <Link href="/siteler/yeni" className="btn-primary">
            <IconPlus />
            Yeni site
          </Link>
        }
      />

      {sites.length === 0 ? (
        <EmptyState
          icon={<IconGlobe className="size-5" />}
          title="Henüz site eklenmedi"
          hint="İlk WordPress sitenizi ekleyin. Kullanıcı adı ve uygulama şifresi yeterli; SEO metaları ve site denetimi için dpdai-bridge eklentisini de kurmanız önerilir."
          action={
            <Link href="/siteler/yeni" className="btn-primary mt-3">
              Site ekle
            </Link>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Site</th>
                <th>Durum</th>
                <th>Takvim</th>
                <th>Dil</th>
                <th>SEO kanalı</th>
                <th>Kalite</th>
                <th>Site SEO</th>
                <th>Havuz</th>
                <th>Bağlantı</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/siteler/${s.id}`} className="font-medium hover:underline">
                      {s.name}
                    </Link>
                    <div className="text-xs" style={{ color: 'var(--ink-3)' }}>
                      {s.url.replace(/^https?:\/\//, '')}
                    </div>
                  </td>
                  <td>
                    <SiteBadge status={s.status} />
                  </td>
                  <td className="text-xs whitespace-nowrap">
                    haftada {s.weeklyQuota}
                    <span className="block" style={{ color: 'var(--ink-3)' }}>
                      saat {String(s.publishHour).padStart(2, '0')}:00
                    </span>
                  </td>
                  <td className="text-xs whitespace-nowrap">
                    {s.locales.join(', ').toUpperCase()}
                    <span className="block" style={{ color: 'var(--ink-3)' }}>
                      {I18N_LABEL[s.i18nMode]}
                    </span>
                  </td>
                  <td className="text-xs">
                    {s.hasBridge ? (
                      <span className="pill-ok">bridge</span>
                    ) : s.seoPlugin === 'NONE' ? (
                      <span className="pill-err">yok</span>
                    ) : (
                      <span className="pill-neutral">{s.seoPlugin.toLowerCase()}</span>
                    )}
                  </td>
                  <td className="text-xs whitespace-nowrap">
                    {s.autoPublish ? 'otomatik' : 'onaylı'}
                    <span className="block" style={{ color: 'var(--ink-3)' }}>
                      {QUALITY_LABEL[s.qualityMode]} · eşik {s.minSeoScore}
                    </span>
                  </td>
                  <td>
                    {s.audits[0] ? (
                      <Link href={`/siteler/${s.id}/seo`}>
                        <ScorePill score={s.audits[0].score} />
                      </Link>
                    ) : (
                      <Link
                        href={`/siteler/${s.id}/seo`}
                        className="text-xs hover:underline"
                        style={{ color: 'var(--ink-3)' }}
                      >
                        denetle
                      </Link>
                    )}
                  </td>
                  <td className="text-xs tabular-nums">{s._count.topics}</td>
                  <td className="text-xs whitespace-nowrap">
                    {s.lastCheckAt ? (
                      <>
                        <span style={{ color: s.lastCheckOk ? 'var(--ok)' : 'var(--err)' }}>
                          {s.lastCheckOk ? 'çalışıyor' : 'hata'}
                        </span>
                        <span className="block" style={{ color: 'var(--ink-3)' }}>
                          {fmtDate(s.lastCheckAt)}
                        </span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--ink-3)' }}>test edilmedi</span>
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

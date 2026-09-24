import Link from 'next/link';
import { FilterChip, PageHeader, fmtDate, fmtMoney } from '@/components/ui';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

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
  discover: 'Keşif',
  audit: 'Site denetimi',
};

export default async function KayitlarPage({
  searchParams,
}: {
  searchParams: Promise<{ durum?: string; tur?: string }>;
}) {
  const sp = await searchParams;
  const l = await getLocale();

  const [jobs, byKind, monthCost] = await Promise.all([
    prisma.jobRun.findMany({
      where: {
        ...(sp.durum ? { status: sp.durum as never } : {}),
        ...(sp.tur ? { kind: sp.tur } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: 200,
      include: {
        site: { select: { name: true } },
        article: { select: { id: true, title: true, locale: true } },
      },
    }),
    prisma.jobRun.groupBy({
      by: ['kind'],
      _count: true,
      _sum: { costUsd: true, tokensIn: true, tokensOut: true },
    }),
    prisma.jobRun.aggregate({
      _sum: { costUsd: true },
      where: { startedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } },
    }),
  ]);

  return (
    <>
      <PageHeader
        title={t(l, 'Kayıtlar')}
        subtitle={`Bu ay toplam maliyet ${fmtMoney(monthCost._sum.costUsd ?? 0)}`}
      />

      <div className="table-wrap mb-5">
        <table className="tbl">
          <thead>
            <tr>
              <th>Adım</th>
              <th>Çalıştırma</th>
              <th>Token (giriş/çıkış)</th>
              <th>Maliyet</th>
            </tr>
          </thead>
          <tbody>
            {byKind.map((k) => (
              <tr key={k.kind}>
                <td>{KIND_LABEL[k.kind] ?? k.kind}</td>
                <td className="tabular-nums">{k._count}</td>
                <td className="tabular-nums" style={{ color: 'var(--ink-3)' }}>
                  {(k._sum.tokensIn ?? 0).toLocaleString('tr-TR')} /{' '}
                  {(k._sum.tokensOut ?? 0).toLocaleString('tr-TR')}
                </td>
                <td className="tabular-nums">{fmtMoney(k._sum.costUsd ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mb-5 flex flex-wrap gap-1.5">
        <FilterChip href="/kayitlar" active={!sp.durum && !sp.tur}>
          Tümü
        </FilterChip>
        <FilterChip href="/kayitlar?durum=FAILED" active={sp.durum === 'FAILED'}>
          Hatalar
        </FilterChip>
        {Object.entries(KIND_LABEL).map(([k, l]) => (
          <FilterChip key={k} href={`/kayitlar?tur=${k}`} active={sp.tur === k}>
            {l}
          </FilterChip>
        ))}
      </div>

      <div className="table-wrap mb-5">
        <table className="tbl">
          <thead>
            <tr>
              <th>Zaman</th>
              <th>Adım</th>
              <th>Yazı</th>
              <th>Sonuç</th>
              <th>Süre</th>
              <th>Maliyet</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td className="text-xs tabular-nums whitespace-nowrap" style={{ color: 'var(--ink-3)' }}>
                  {fmtDate(j.startedAt)}
                </td>
                <td className="text-xs">
                  {KIND_LABEL[j.kind] ?? j.kind}
                  {j.step && <span style={{ color: 'var(--ink-3)' }}> / {j.step}</span>}
                </td>
                <td className="max-w-xs text-xs">
                  {j.article ? (
                    <Link href={`/yazilar/${j.article.id}`} className="block truncate hover:underline">
                      {j.article.title}
                    </Link>
                  ) : (
                    <span style={{ color: 'var(--ink-3)' }}>{j.site?.name ?? '—'}</span>
                  )}
                </td>
                <td className="max-w-md text-xs">
                  <span
                    style={{
                      color:
                        j.status === 'FAILED'
                          ? 'var(--err)'
                          : j.status === 'RUNNING'
                            ? 'var(--info)'
                            : 'var(--ok)',
                    }}
                  >
                    {j.status === 'FAILED' ? 'hata' : j.status === 'RUNNING' ? 'çalışıyor' : 'tamam'}
                  </span>
                  {j.message && <span className="block truncate" style={{ color: 'var(--ink-3)' }}>{j.message}</span>}
                </td>
                <td className="text-xs tabular-nums" style={{ color: 'var(--ink-3)' }}>
                  {j.durationMs ? `${(j.durationMs / 1000).toFixed(1)}s` : '—'}
                </td>
                <td className="text-xs tabular-nums" style={{ color: 'var(--ink-3)' }}>
                  {j.costUsd ? fmtMoney(j.costUsd) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

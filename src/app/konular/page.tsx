import Link from 'next/link';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';
import { ConflictBadge } from '@/components/ConflictBadge';
import { IconPlus, IconRefresh, IconSearch, IconSparkle, IconTopics, IconTrash } from '@/components/icons';
import { EmptyState, FilterChip, PageHeader, Panel, TopicBadge, fmtDate } from '@/components/ui';
import { runNow } from '@/lib/actions/articles';
import {
  addTopics,
  deleteTopic,
  dismissConflict,
  replan,
  requeueTopic,
  rescanConflicts,
} from '@/lib/actions/topics';
import { prisma } from '@/lib/db';
import type { Conflict } from '@/lib/quality/similarity';

export const dynamic = 'force-dynamic';

export default async function KonularPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; durum?: string }>;
}) {
  const sp = await searchParams;

  const sites = await prisma.site.findMany({
    where: { status: { not: 'ARCHIVED' } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, defaultLocale: true, locales: true, weeklyQuota: true },
  });

  const topics = await prisma.topic.findMany({
    where: {
      ...(sp.site ? { siteId: sp.site } : {}),
      ...(sp.durum ? { status: sp.durum as never } : {}),
    },
    orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }],
    take: 300,
    include: { site: { select: { id: true, name: true } } },
  });

  const selected = sites.find((s) => s.id === sp.site);
  const havuzda = topics.filter((t) => t.status === 'QUEUED').length;
  const cakisan = topics.filter(
    (t) => Array.isArray(t.conflicts) && (t.conflicts as unknown[]).length > 0,
  ).length;

  async function yenidenPlanla() {
    'use server';
    await replan(sp.site);
  }

  async function cakismaTara() {
    'use server';
    await rescanConflicts(sp.site);
  }

  const l = await getLocale();

  return (
    <>
      <PageHeader
        title={t(l, 'Konu havuzu')}
        subtitle={
          cakisan > 0
            ? `${havuzda} başlık sırada · ${cakisan} tanesinde çakışma uyarısı`
            : `${havuzda} başlık sırada · sistem takvime göre üretir`
        }
        actions={
          <>
            <form action={cakismaTara}>
              <button className="btn">
                <IconSearch />
                Çakışma taraması
              </button>
            </form>
            <form action={yenidenPlanla}>
              <button className="btn">
                <IconRefresh />
                Takvimi yeniden hesapla
              </button>
            </form>
          </>
        }
      />

      {sites.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          <FilterChip href="/konular" active={!sp.site}>
            Tümü
          </FilterChip>
          {sites.map((s) => (
            <FilterChip key={s.id} href={`/konular?site=${s.id}`} active={sp.site === s.id}>
              {s.name}
            </FilterChip>
          ))}
        </div>
      )}

      {/* ---------------------------------------------------------- ekleme */}
      <form action={addTopics} className="mb-6">
        <Panel title="Toplu başlık ekle" icon={<IconPlus />}>
          <p className="mb-4 text-xs" style={{ color: 'var(--ink-3)' }}>
            Her satır bir konu. Dilerseniz boru işaretiyle odak kelime ve brief ekleyin:
            <br />
            <code className="font-mono">
              Kedilerde diş bakımı | kedi diş bakımı | veteriner görüşü içersin
            </code>
          </p>

          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <label className="label">Site</label>
              <select name="siteId" required defaultValue={sp.site ?? ''} className="input">
                <option value="">Seçin</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Yazım dili</label>
              <input name="locale" className="input" placeholder={selected?.defaultLocale ?? 'tr'} />
              <p className="hint">Boşsa sitenin ana dili</p>
            </div>
            <div>
              <label className="label">Çeviri dilleri</label>
              <input
                name="targetLocales"
                className="input"
                placeholder={(selected?.locales ?? ['tr']).join(', ')}
              />
              <p className="hint">Boşsa sitenin dilleri</p>
            </div>
            <div>
              <label className="label">Öncelik</label>
              <input name="priority" type="number" defaultValue={0} className="input" />
              <p className="hint">Büyük olan önce üretilir</p>
            </div>
          </div>

          <div className="mt-4">
            <label className="label">Başlıklar</label>
            <textarea
              name="bulk"
              rows={6}
              required
              className="input font-mono text-xs"
              placeholder={
                'İlk konu başlığı\nİkinci konu | odak kelime\nÜçüncü konu | odak kelime | ek talimat'
              }
            />
          </div>

          <button type="submit" className="btn-primary mt-4">
            Havuza ekle
          </button>
        </Panel>
      </form>

      {/* ---------------------------------------------------------- liste */}
      {topics.length === 0 ? (
        <EmptyState
          icon={<IconTopics className="size-5" />}
          title="Havuzda konu yok"
          hint="Yukarıdaki kutuya başlıklarınızı yapıştırın; sistem takvime dizip üretmeye başlar."
        />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Başlık</th>
                <th>Site</th>
                <th>Odak kelime</th>
                <th>Dil</th>
                <th>Durum</th>
                <th>Planlanan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => {
                const sil = deleteTopic.bind(null, t.id);
                const simdi = runNow.bind(null, t.id);
                const geri = requeueTopic.bind(null, t.id);
                const yoksay = dismissConflict.bind(null, t.id);
                const conflicts = (t.conflicts ?? []) as Conflict[];
                return (
                  <tr key={t.id}>
                    <td className="max-w-md">
                      <div className="truncate font-medium">{t.title}</div>
                      {t.notes && (
                        <div className="truncate text-xs" style={{ color: 'var(--ink-3)' }}>
                          {t.notes}
                        </div>
                      )}
                      <ConflictBadge conflicts={conflicts} />
                    </td>
                    <td className="text-xs whitespace-nowrap">
                      <Link href={`/siteler/${t.site.id}`} className="hover:underline">
                        {t.site.name}
                      </Link>
                    </td>
                    <td className="text-xs" style={{ color: 'var(--ink-3)' }}>
                      {t.keyword ?? '—'}
                    </td>
                    <td className="text-xs whitespace-nowrap">
                      {(t.locale ?? '—').toUpperCase()}
                      {t.targetLocales.length > 0 && (
                        <span className="block" style={{ color: 'var(--ink-3)' }}>
                          → {t.targetLocales.join(', ').toUpperCase()}
                        </span>
                      )}
                    </td>
                    <td>
                      <TopicBadge status={t.status} />
                    </td>
                    <td className="text-xs tabular-nums whitespace-nowrap" style={{ color: 'var(--ink-3)' }}>
                      {fmtDate(t.scheduledFor)}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {t.status === 'QUEUED' && (
                          <form action={simdi}>
                            <button className="btn-ghost btn-sm" title="Takvimi beklemeden üret">
                              <IconSparkle className="size-3.5" />
                              şimdi üret
                            </button>
                          </form>
                        )}
                        {conflicts.length > 0 && (
                          <form action={yoksay}>
                            <button className="btn-ghost btn-sm" title="Çakışma uyarısını kaldır">
                              yok say
                            </button>
                          </form>
                        )}
                        {(t.status === 'FAILED' || t.status === 'SCHEDULED') && (
                          <form action={geri}>
                            <button className="btn-ghost btn-sm">havuza al</button>
                          </form>
                        )}
                        <form action={sil}>
                          <button className="btn-ghost btn-sm" style={{ color: 'var(--err)' }}>
                            <IconTrash className="size-3.5" />
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

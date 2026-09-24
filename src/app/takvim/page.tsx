import Link from 'next/link';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { IconCalendar } from '@/components/icons';
import { ARTICLE_LABEL, FilterChip, PageHeader } from '@/components/ui';
import { prisma } from '@/lib/db';
import type { ArticleStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

const TZ = 'Europe/Istanbul';
const GUN_ADI = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const AY_ADI = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

/** Durum -> nokta rengi (CSS degiskeni) */
const DOT: Record<ArticleStatus, string> = {
  QUEUED: 'var(--ink-4, #9ca3af)',
  DRAFTING: 'var(--accent)',
  REVISING: 'var(--accent)',
  IMAGING: 'var(--accent)',
  TRANSLATING: 'var(--accent)',
  NEEDS_REVIEW: 'var(--warn)',
  APPROVED: 'var(--ok)',
  PUBLISHING: 'var(--ok)',
  PUBLISHED: 'var(--ok)',
  FAILED: 'var(--err)',
};

export default async function TakvimPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; ay?: string }>;
}) {
  const sp = await searchParams;
  const l = await getLocale();

  const sites = await prisma.site.findMany({
    where: { status: { not: 'ARCHIVED' } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  // Her siteye sabit bir renk (cok siteli takvimde karismasin diye)
  const SITE_COLORS = ['#0ea5e9', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#14b8a6', '#6366f1'];
  const siteColor = new Map(sites.map((s, i) => [s.id, SITE_COLORS[i % SITE_COLORS.length]]));

  // Hangi ay? ?ay=YYYY-MM, yoksa bu ay
  const now = new Date();
  const base =
    sp.ay && /^\d{4}-\d{2}$/.test(sp.ay)
      ? new Date(Number(sp.ay.slice(0, 4)), Number(sp.ay.slice(5, 7)) - 1, 15)
      : now;

  const monthStart = startOfMonth(base);
  const monthEnd = endOfMonth(base);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const articles = await prisma.article.findMany({
    where: {
      parentId: null,
      scheduledFor: { gte: gridStart, lte: gridEnd },
      ...(sp.site ? { siteId: sp.site } : {}),
    },
    orderBy: { scheduledFor: 'asc' },
    select: {
      id: true,
      title: true,
      status: true,
      scheduledFor: true,
      siteId: true,
      site: { select: { name: true } },
    },
  });

  // Gune gore grupla (Istanbul yerel gunu)
  const byDay = new Map<string, typeof articles>();
  for (const a of articles) {
    if (!a.scheduledFor) continue;
    const key = format(toZonedTime(a.scheduledFor, TZ), 'yyyy-MM-dd');
    const arr = byDay.get(key) ?? [];
    arr.push(a);
    byDay.set(key, arr);
  }

  const prevAy = format(addMonths(base, -1), 'yyyy-MM');
  const nextAy = format(addMonths(base, 1), 'yyyy-MM');
  const q = (ay: string) => `/takvim?ay=${ay}${sp.site ? `&site=${sp.site}` : ''}`;
  const todayKey = format(toZonedTime(now, TZ), 'yyyy-MM-dd');
  const monthlyCount = articles.filter((a) => {
    const d = a.scheduledFor ? toZonedTime(a.scheduledFor, TZ) : null;
    return d && d >= monthStart && d <= monthEnd;
  }).length;

  return (
    <>
      <PageHeader
        title={t(l, 'Takvim')}
        subtitle={`${AY_ADI[base.getMonth()]} ${base.getFullYear()} · ${monthlyCount} yazı planlı`}
        actions={
          <div className="flex items-center gap-1">
            <Link href={q(prevAy)} className="btn btn-sm" aria-label="Önceki ay">
              ‹
            </Link>
            <Link href={q(format(now, 'yyyy-MM'))} className="btn btn-sm">
              Bugün
            </Link>
            <Link href={q(nextAy)} className="btn btn-sm" aria-label="Sonraki ay">
              ›
            </Link>
          </div>
        }
      />

      {sites.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          <FilterChip href={`/takvim?ay=${format(base, 'yyyy-MM')}`} active={!sp.site}>
            Tümü
          </FilterChip>
          {sites.map((s) => (
            <FilterChip
              key={s.id}
              href={`/takvim?ay=${format(base, 'yyyy-MM')}&site=${s.id}`}
              active={sp.site === s.id}
            >
              <span
                className="mr-1 inline-block size-2 rounded-full align-middle"
                style={{ background: siteColor.get(s.id) }}
              />
              {s.name}
            </FilterChip>
          ))}
        </div>
      )}

      <div className="table-wrap">
        {/* gun basliklari */}
        <div className="grid grid-cols-7 text-center text-[11px] font-semibold" style={{ color: 'var(--ink-3)' }}>
          {GUN_ADI.map((g) => (
            <div key={g} className="py-2">
              {g}
            </div>
          ))}
        </div>

        {/* gunler */}
        <div className="grid grid-cols-7" style={{ borderTop: '1px solid var(--line)', borderLeft: '1px solid var(--line)' }}>
          {days.map((day) => {
            const key = format(day, 'yyyy-MM-dd');
            const items = byDay.get(key) ?? [];
            const inMonth = day.getMonth() === base.getMonth();
            const isToday = key === todayKey;
            return (
              <div
                key={key}
                className="min-h-[92px] p-1.5"
                style={{
                  borderRight: '1px solid var(--line)',
                  borderBottom: '1px solid var(--line)',
                  background: inMonth ? 'var(--surface)' : 'var(--surface-2, transparent)',
                  opacity: inMonth ? 1 : 0.5,
                }}
              >
                <div
                  className="mb-1 flex size-6 items-center justify-center rounded-full text-xs tabular-nums"
                  style={
                    isToday
                      ? { background: 'var(--accent)', color: 'var(--accent-fg)', fontWeight: 700 }
                      : { color: 'var(--ink-3)' }
                  }
                >
                  {day.getDate()}
                </div>
                <div className="space-y-0.5">
                  {items.slice(0, 4).map((a) => (
                    <Link
                      key={a.id}
                      href={`/yazilar/${a.id}`}
                      className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-[11px] hover:bg-[var(--surface-3)]"
                      style={
                        !sp.site
                          ? { borderLeft: `3px solid ${siteColor.get(a.siteId) ?? 'var(--line)'}` }
                          : undefined
                      }
                      title={`${format(toZonedTime(a.scheduledFor!, TZ), 'HH:mm')} · ${a.title} · ${a.site.name} · ${ARTICLE_LABEL[a.status]}`}
                    >
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ background: DOT[a.status] }}
                      />
                      <span className="truncate">{a.title}</span>
                    </Link>
                  ))}
                  {items.length > 4 && (
                    <div className="px-1 text-[10px]" style={{ color: 'var(--ink-3)' }}>
                      +{items.length - 4} daha
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {monthlyCount === 0 && (
        <div className="mt-6 flex flex-col items-center gap-2 py-10 text-center" style={{ color: 'var(--ink-3)' }}>
          <IconCalendar className="size-6" />
          <p className="text-sm">Bu ay planlı yazı yok. Konu havuzuna başlık ekleyip takvime dizin.</p>
        </div>
      )}
    </>
  );
}

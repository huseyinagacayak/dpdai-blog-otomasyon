import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IconRefresh, IconSearch, IconShield } from '@/components/icons';
import { Alert, EmptyState, PageHeader, Panel, ScoreRing, fmtDate, scoreTone } from '@/components/ui';
import { runAudit } from '@/lib/actions/sites';
import { prisma } from '@/lib/db';
import type { AuditFinding, AuditResult, AuditSection } from '@/lib/pipeline/siteAudit';

export const dynamic = 'force-dynamic';

export default async function SiteSeoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const site = await prisma.site.findUnique({
    where: { id },
    include: { audits: { orderBy: { createdAt: 'desc' }, take: 6 } },
  });
  if (!site) notFound();

  const latest = site.audits[0] ?? null;
  const sections = (latest?.sections ?? []) as AuditSection[];
  const findings = (latest?.findings ?? []) as AuditFinding[];
  const plan = (latest?.actionPlan ?? []) as AuditResult['actionPlan'];

  const denetle = runAudit.bind(null, site.id);

  const errors = findings.filter((f) => f.level === 'error');
  const warns = findings.filter((f) => f.level === 'warn');
  const oks = findings.filter((f) => f.level === 'ok');

  return (
    <>
      <PageHeader
        back={{ href: `/siteler/${site.id}`, label: site.name }}
        title="Site SEO denetimi"
        subtitle={
          latest
            ? `Son tarama ${fmtDate(latest.createdAt)} · ${site.url.replace(/^https?:\/\//, '')}`
            : site.url.replace(/^https?:\/\//, '')
        }
        actions={
          <form action={denetle}>
            <button className="btn-primary">
              <IconRefresh />
              Denetimi çalıştır
            </button>
          </form>
        }
      />

      {!site.hasBridge && (
        <div className="mb-5">
          <Alert tone="warn" title="Yüzeysel tarama">
            Bu sitede <code>dpdai-bridge</code> eklentisi kurulu değil. Panel yalnızca dışarıdan
            görülebilenleri (robots.txt, site haritası, ana sayfa etiketleri, yapısal veri)
            kontrol edebiliyor. Eklentiyi kurarsanız indeksleme ayarları, ince içerik, eksik meta,
            kopya başlık ve görsel alt metni taraması da açılır.
          </Alert>
        </div>
      )}

      {!latest ? (
        <EmptyState
          icon={<IconSearch className="size-5" />}
          title="Henüz denetim çalıştırılmadı"
          hint="Denetim, sitenin indeksleme ayarlarını, teknik durumunu, meta etiketlerini, içerik sağlığını ve yapısal verisini tarar; ardından öncelikli bir eylem planı üretir."
          action={
            <form action={denetle} className="mt-3">
              <button className="btn-primary">Denetimi çalıştır</button>
            </form>
          }
        />
      ) : (
        <div className="space-y-5">
          {/* ------------------------------------------------------- puan */}
          <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="card-pad flex flex-col items-center text-center">
              <ScoreRing score={latest.score} size={110} />
              <div className="mt-3 text-sm font-semibold">{scoreTone(latest.score).label}</div>
              <p className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>
                {errors.length} kritik · {warns.length} uyarı · {oks.length} sorunsuz
              </p>
              <p className="mt-2 text-xs" style={{ color: 'var(--ink-3)' }}>
                {(latest.raw as { bridge?: unknown } | null)?.bridge
                  ? 'derin tarama (eklenti verisi dahil)'
                  : 'yüzeysel tarama'}
              </p>
            </div>

            <Panel title="Alan bazlı puanlar" icon={<IconShield />}>
              <div className="space-y-3.5">
                {sections.map((s) => {
                  const pct = Math.round((s.score / s.max) * 100);
                  return (
                    <div key={s.area}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="capitalize">{s.area}</span>
                        <span className="tabular-nums" style={{ color: 'var(--ink-3)' }}>
                          {s.score}/{s.max}
                        </span>
                      </div>
                      <div
                        className="h-2 overflow-hidden rounded-full"
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
            </Panel>
          </div>

          {/* -------------------------------------------------- eylem planı */}
          {plan.length > 0 && (
            <Panel title="Öncelikli eylem planı">
              <ol className="space-y-4">
                {plan.map((p, n) => (
                  <li key={n} className="flex gap-3">
                    <span
                      className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums"
                      style={{
                        background:
                          p.priority === 'yüksek'
                            ? 'var(--err-soft)'
                            : p.priority === 'orta'
                              ? 'var(--warn-soft)'
                              : 'var(--surface-3)',
                        color:
                          p.priority === 'yüksek'
                            ? 'var(--err)'
                            : p.priority === 'orta'
                              ? 'var(--warn)'
                              : 'var(--ink-2)',
                      }}
                    >
                      {n + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{p.title}</span>
                        <span
                          className={
                            p.priority === 'yüksek'
                              ? 'pill-err'
                              : p.priority === 'orta'
                                ? 'pill-warn'
                                : 'pill-neutral'
                          }
                        >
                          {p.priority}
                        </span>
                      </div>
                      <p className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>
                        {p.why}
                      </p>
                      <p className="mt-1 text-sm" style={{ color: 'var(--ink-3)' }}>
                        {p.how}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          {/* ---------------------------------------------------- bulgular */}
          <div className="grid gap-5 lg:grid-cols-2">
            <FindingList title="Kritik ve uyarılar" items={[...errors, ...warns]} />
            <FindingList title="Sorunsuz kontroller" items={oks} muted />
          </div>

          {/* ---------------------------------------------------- geçmiş */}
          {site.audits.length > 1 && (
            <Panel title="Denetim geçmişi">
              <ul className="space-y-2">
                {site.audits.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 text-sm">
                    <span
                      className="w-12 text-right font-semibold tabular-nums"
                      style={{ color: scoreTone(a.score).color }}
                    >
                      {a.score}
                    </span>
                    <span style={{ color: 'var(--ink-3)' }}>{fmtDate(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
            Denetim arka planda çalışır; sonuç birkaç saniye içinde bu sayfaya düşer.{' '}
            <Link href={`/siteler/${site.id}`} className="hover:underline">
              Site ayarlarına dön
            </Link>
          </p>
        </div>
      )}
    </>
  );
}

function FindingList({
  title,
  items,
  muted,
}: {
  title: string;
  items: AuditFinding[];
  muted?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <Panel title={`${title} (${items.length})`}>
      <ul className="space-y-3.5">
        {items.map((f, n) => (
          <li key={n} className="flex gap-2.5">
            <span
              className="mt-1.5 size-2 shrink-0 rounded-full"
              style={{
                background:
                  f.level === 'error'
                    ? 'var(--err)'
                    : f.level === 'warn'
                      ? 'var(--warn)'
                      : 'var(--ok)',
              }}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-sm ${muted ? '' : 'font-medium'}`}>{f.label}</span>
                <span className="pill-neutral capitalize">{f.area}</span>
              </div>
              {f.detail && (
                <p className="mt-0.5 text-xs break-words" style={{ color: 'var(--ink-3)' }}>
                  {f.detail}
                </p>
              )}
              {f.howTo && (
                <p className="mt-1 text-xs" style={{ color: 'var(--ink-2)' }}>
                  → {f.howTo}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

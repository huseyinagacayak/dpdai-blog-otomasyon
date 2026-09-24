import Link from 'next/link';
import type { ArticleStatus, SiteStatus, TopicStatus } from '@prisma/client';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';

/* ------------------------------------------------------------------ durum */

export const ARTICLE_LABEL: Record<ArticleStatus, string> = {
  QUEUED: 'Sırada',
  DRAFTING: 'Metin yazılıyor',
  REVISING: 'Düzeltiliyor',
  IMAGING: 'Görsel üretiliyor',
  TRANSLATING: 'Çevriliyor',
  NEEDS_REVIEW: 'İnceleme bekliyor',
  APPROVED: 'Onaylandı',
  PUBLISHING: 'Yayınlanıyor',
  PUBLISHED: 'Yayında',
  FAILED: 'Hata',
};

const ARTICLE_TONE: Record<ArticleStatus, string> = {
  QUEUED: 'pill-neutral',
  DRAFTING: 'pill-info',
  REVISING: 'pill-accent',
  IMAGING: 'pill-accent',
  TRANSLATING: 'pill-info',
  NEEDS_REVIEW: 'pill-warn',
  APPROVED: 'pill-ok',
  PUBLISHING: 'pill-info',
  PUBLISHED: 'pill-ok',
  FAILED: 'pill-err',
};

export async function ArticleBadge({ status }: { status: ArticleStatus }) {
  const l = await getLocale();
  return (
    <span className={ARTICLE_TONE[status]}>
      <i className="pill-dot" />
      {t(l, ARTICLE_LABEL[status])}
    </span>
  );
}

export const TOPIC_LABEL: Record<TopicStatus, string> = {
  QUEUED: 'Havuzda',
  SCHEDULED: 'Takvimde',
  RUNNING: 'Üretimde',
  DONE: 'Tamam',
  FAILED: 'Hata',
  ARCHIVED: 'Arşiv',
};

const TOPIC_TONE: Record<TopicStatus, string> = {
  QUEUED: 'pill-neutral',
  SCHEDULED: 'pill-info',
  RUNNING: 'pill-accent',
  DONE: 'pill-ok',
  FAILED: 'pill-err',
  ARCHIVED: 'pill-neutral',
};

export async function TopicBadge({ status }: { status: TopicStatus }) {
  const l = await getLocale();
  return (
    <span className={TOPIC_TONE[status]}>
      <i className="pill-dot" />
      {t(l, TOPIC_LABEL[status])}
    </span>
  );
}

export async function SiteBadge({ status }: { status: SiteStatus }) {
  const l = await getLocale();
  const map: Record<SiteStatus, [string, string]> = {
    ACTIVE: ['Aktif', 'pill-ok'],
    PAUSED: ['Duraklatıldı', 'pill-warn'],
    ARCHIVED: ['Arşiv', 'pill-neutral'],
  };
  const [label, tone] = map[status];
  return (
    <span className={tone}>
      <i className="pill-dot" />
      {t(l, label)}
    </span>
  );
}

/* ------------------------------------------------------------------ skor */

export function scoreTone(score: number): { color: string; label: string } {
  if (score >= 90) return { color: 'var(--ok)', label: 'Mükemmel' };
  if (score >= 80) return { color: 'var(--ok)', label: 'İyi' };
  if (score >= 65) return { color: 'var(--warn)', label: 'Geliştirilmeli' };
  return { color: 'var(--err)', label: 'Yetersiz' };
}

/** Dairesel skor gostergesi. size: px */
export function ScoreRing({
  score,
  size = 56,
  label,
}: {
  score: number | null | undefined;
  size?: number;
  label?: string;
}) {
  if (score === null || score === undefined) {
    return (
      <div
        className="flex items-center justify-center rounded-full border border-dashed"
        style={{ width: size, height: size, borderColor: 'var(--line-strong)', color: 'var(--ink-3)' }}
      >
        <span className="text-xs">—</span>
      </div>
    );
  }

  const stroke = size >= 48 ? 5 : 4;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * circumference;
  const { color } = scoreTone(score);

  return (
    <div className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke="var(--surface-3)"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke={color}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-semibold tabular-nums"
          style={{ color, fontSize: size >= 48 ? 15 : 11 }}
        >
          {score}
        </span>
        {label && size >= 56 && (
          <span className="text-[9px]" style={{ color: 'var(--ink-3)' }}>
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

/** Kompakt satir ici skor rozeti */
export function ScorePill({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined)
    return <span style={{ color: 'var(--ink-3)' }}>—</span>;
  const tone = score >= 80 ? 'pill-ok' : score >= 65 ? 'pill-warn' : 'pill-err';
  return <span className={`${tone} tabular-nums`}>{score}</span>;
}

/* ------------------------------------------------------------------ duzen */

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link
            href={back.href}
            className="mb-1.5 inline-flex items-center gap-1 text-xs transition-colors hover:underline"
            style={{ color: 'var(--ink-3)' }}
          >
            ← {back.label}
          </Link>
        )}
        <h1 className="truncate text-[22px] leading-tight font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <div className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>
            {subtitle}
          </div>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  tone?: 'ok' | 'warn' | 'err' | 'accent';
}) {
  const color = tone ? `var(--${tone === 'accent' ? 'accent' : tone})` : 'var(--ink)';
  const body = (
    <div className="card-pad h-full">
      <div className="text-xs font-medium" style={{ color: 'var(--ink-3)' }}>
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>
          {hint}
        </div>
      )}
    </div>
  );
  return href ? (
    <Link href={href} className="block transition-opacity hover:opacity-80">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Panel({
  title,
  action,
  children,
  icon,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className ?? ''}`}>
      <header
        className="flex items-center justify-between gap-3 px-5 py-3.5"
        style={{ borderBottom: '1px solid var(--line)' }}
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {icon && <span style={{ color: 'var(--ink-3)' }}>{icon}</span>}
          {title}
        </h2>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  icon,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="card-pad flex flex-col items-center gap-2 py-14 text-center">
      {icon && (
        <div
          className="mb-1 flex size-10 items-center justify-center rounded-full"
          style={{ background: 'var(--surface-3)', color: 'var(--ink-3)' }}
        >
          {icon}
        </div>
      )}
      <div className="text-sm font-medium">{title}</div>
      {hint && (
        <div className="max-w-md text-sm" style={{ color: 'var(--ink-3)' }}>
          {hint}
        </div>
      )}
      {action}
    </div>
  );
}

export function FilterChip({
  href,
  active,
  children,
  count,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
      style={
        active
          ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
          : {
              background: 'var(--surface)',
              color: 'var(--ink-2)',
              border: '1px solid var(--line)',
            }
      }
    >
      {children}
      {count !== undefined && <span className="tabular-nums opacity-70">{count}</span>}
    </Link>
  );
}

export function Alert({
  tone,
  title,
  children,
}: {
  tone: 'ok' | 'warn' | 'err' | 'info';
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl px-4 py-3 text-sm"
      style={{
        background: `var(--${tone}-soft)`,
        color: `var(--${tone})`,
        border: `1px solid var(--${tone}-line)`,
      }}
    >
      {title && <div className="mb-0.5 font-medium">{title}</div>}
      <div className="opacity-90">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ bicim */

export function fmtDate(d: Date | null | undefined, tz = 'Europe/Istanbul'): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: tz,
  }).format(d);
}

export function fmtDay(d: Date | null | undefined, tz = 'Europe/Istanbul'): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'short',
    weekday: 'short',
    timeZone: tz,
  }).format(d);
}

export function fmtMoney(v: number): string {
  return `$${v.toFixed(2)}`;
}

export function fmtNum(v: number): string {
  return v.toLocaleString('tr-TR');
}

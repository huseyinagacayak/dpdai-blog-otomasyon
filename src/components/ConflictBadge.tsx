import Link from 'next/link';
import type { Conflict } from '@/lib/quality/similarity';

const SOURCE_LABEL: Record<Conflict['source'], string> = {
  topic: 'havuzdaki konu',
  article: 'üretilmiş yazı',
  site: 'sitede yayında',
};

/**
 * Konu satirinda cakisma uyarisi.
 * Ayrintilar acilir kapanir; boylece liste kalabaliklasmaz.
 */
export function ConflictBadge({ conflicts }: { conflicts: Conflict[] }) {
  if (!conflicts?.length) return null;

  const high = conflicts.filter((c) => c.level === 'high').length;

  return (
    <details className="mt-1">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5">
        <span className={high > 0 ? 'pill-err' : 'pill-warn'}>
          <i className="pill-dot" />
          {high > 0 ? 'çakışma' : 'benzer içerik'}
          <span className="tabular-nums opacity-70">{conflicts.length}</span>
        </span>
      </summary>

      <ul className="mt-1.5 space-y-1">
        {conflicts.map((c, n) => (
          <li key={n} className="text-xs" style={{ color: 'var(--ink-3)' }}>
            <span style={{ color: c.level === 'high' ? 'var(--err)' : 'var(--warn)' }}>
              {c.kind === 'keyword' ? 'aynı odak kelime' : `%${Math.round(c.score * 100)} benzer`}
            </span>
            {' · '}
            {c.articleId ? (
              <Link href={`/yazilar/${c.articleId}`} className="hover:underline">
                {c.title}
              </Link>
            ) : c.url ? (
              <a href={c.url} target="_blank" rel="noreferrer noopener" className="hover:underline">
                {c.title}
              </a>
            ) : (
              c.title
            )}
            {' · '}
            <span>{SOURCE_LABEL[c.source]}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

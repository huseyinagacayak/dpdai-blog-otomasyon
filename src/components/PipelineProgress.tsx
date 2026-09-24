'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { ArticleStatus } from '@prisma/client';
import { ACTIVE_STATUSES } from '@/lib/pipelineStages';

/**
 * Yazinin uretim hattindaki konumunu gosteren ilerleme cubugu.
 *
 * Aktif bir asamadaysa (uretiliyor/gorsel/yayin...) sayfayi birkac saniyede
 * bir kendiliginden yeniler; boylece "gorsel yenileniyor ama ne oluyor belli
 * degil" durumu biter, kullanici asamalari canli gorur.
 */

const STAGES: { label: string; statuses: ArticleStatus[] }[] = [
  { label: 'Sırada', statuses: ['QUEUED'] },
  { label: 'Metin', statuses: ['DRAFTING'] },
  { label: 'Kalite', statuses: ['REVISING'] },
  { label: 'Görsel', statuses: ['IMAGING'] },
  { label: 'Çeviri/Onay', statuses: ['TRANSLATING', 'NEEDS_REVIEW', 'APPROVED'] },
  { label: 'Yayın', statuses: ['PUBLISHING', 'PUBLISHED'] },
];

const ACTIVE = ACTIVE_STATUSES;

function stageIndex(status: ArticleStatus): number {
  const i = STAGES.findIndex((s) => s.statuses.includes(status));
  return i === -1 ? 0 : i;
}

export function PipelineProgress({
  status,
  compact = false,
}: {
  status: ArticleStatus;
  compact?: boolean;
}) {
  const router = useRouter();
  const isActive = ACTIVE.includes(status);

  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [isActive, status, router]);

  const failed = status === 'FAILED';
  const done = status === 'PUBLISHED';
  const cur = stageIndex(status);
  const pct = failed ? 100 : done ? 100 : ((cur + (isActive ? 0.5 : 1)) / STAGES.length) * 100;
  const color = failed ? 'var(--err)' : done ? 'var(--ok)' : 'var(--accent)';

  if (compact) {
    return (
      <div
        className="h-1 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--surface-3)' }}
        title={failed ? 'Başarısız' : STAGES[cur]?.label}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium" style={{ color }}>
          {failed ? 'Başarısız' : done ? 'Yayında' : STAGES[cur]?.label}
          {isActive && <span className="ml-1 animate-pulse">…</span>}
        </span>
        <span className="tabular-nums" style={{ color: 'var(--ink-3)' }}>
          {failed ? '' : `${cur + 1}/${STAGES.length}`}
        </span>
      </div>

      {/* asamalar */}
      <div className="flex gap-1">
        {STAGES.map((s, i) => {
          const state = failed
            ? i <= cur
              ? 'fail'
              : 'todo'
            : done || i < cur
              ? 'done'
              : i === cur
                ? 'now'
                : 'todo';
          const bg =
            state === 'fail'
              ? 'var(--err)'
              : state === 'done'
                ? 'var(--ok)'
                : state === 'now'
                  ? 'var(--accent)'
                  : 'var(--surface-3)';
          return (
            <div key={s.label} className="flex-1">
              <div
                className={`h-1.5 rounded-full ${state === 'now' && isActive ? 'animate-pulse' : ''}`}
                style={{ background: bg }}
              />
              <div
                className="mt-1 truncate text-center text-[10px]"
                style={{ color: state === 'todo' ? 'var(--ink-4, #9ca3af)' : 'var(--ink-3)' }}
              >
                {s.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

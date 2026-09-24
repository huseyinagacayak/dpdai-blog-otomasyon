'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Toplu ceviri ilerlemesi. "Eksik cevirileri tamamla" ile kuyruga atilan
 * islerin kaci tamamlandi gosterir; is bitene kadar birkac saniyede bir
 * kendini yeniler. Boylece kullanici cevirilerin YAPILDIGINI canli gorur.
 */
export function TranslationProgress({ total, done }: { total: number; done: number }) {
  const router = useRouter();
  const bitti = done >= total;

  useEffect(() => {
    if (bitti) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [bitti, router]);

  if (total === 0) return null;

  const pct = Math.min(100, Math.round((done / total) * 100));
  const kalan = Math.max(0, total - done);

  return (
    <div
      className="mb-6 rounded-xl p-4"
      style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
    >
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium">
          {bitti ? '✓ Çeviriler tamamlandı' : 'Çeviriler yapılıyor'}
          {!bitti && <span className="ml-1 animate-pulse">…</span>}
        </span>
        <span className="tabular-nums" style={{ color: 'var(--ink-3)' }}>
          {done} / {total} · %{pct}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--surface-3)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: bitti ? 'var(--ok)' : 'var(--accent)' }}
        />
      </div>
      {!bitti && (
        <p className="hint mt-1.5">
          {kalan} çeviri sırada. Her biri kaynağı çekip çeviriyor ve yayınlıyor — arka planda
          sürüyor, bu sayfadan ayrılabilirsiniz. Ayrıntılar <strong>Kayıtlar</strong> sekmesinde.
        </p>
      )}
    </div>
  );
}

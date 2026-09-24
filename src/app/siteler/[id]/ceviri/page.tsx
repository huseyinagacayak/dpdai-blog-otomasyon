import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, PageHeader, Panel } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getPublishAdapter } from '@/lib/providers/publish';
import {
  completeMissingTranslations,
  getTranslationProgress,
  translateMenus,
} from '@/lib/actions/translations';
import { SubmitButton } from '@/components/SubmitButton';
import { TranslationProgress } from '@/components/TranslationProgress';

export const dynamic = 'force-dynamic';

const DIL_ADI: Record<string, string> = {
  tr: 'Türkçe',
  en: 'İngilizce',
  de: 'Almanca',
  fr: 'Fransızca',
  ar: 'Arapça',
  ru: 'Rusça',
  es: 'İspanyolca',
  it: 'İtalyanca',
};
const dl = (c: string) => DIL_ADI[c] ?? c.toUpperCase();

type Audit = {
  mode: string;
  supported: boolean;
  message?: string;
  languages?: string[];
  default?: string;
  summary?: {
    total_groups: number;
    coverage: Record<string, number>;
    missing: Record<string, number>;
    problems: number;
  };
  items?: { source_id: number; source_lang: string; title: string; url: string; type: string; missing: string[] }[];
  problems?: { post_id: number; lang: string; title: string; url: string; reason: string; ratio: number }[];
};

export default async function CeviriPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const site = await prisma.site.findUnique({ where: { id } });
  if (!site) notFound();

  let audit: Audit | null = null;
  let hata: string | null = null;
  try {
    const adapter = getPublishAdapter(site);
    if (!adapter.translationAudit) throw new Error('Bu site türü çeviri denetimini desteklemiyor.');
    audit = (await adapter.translationAudit()) as Audit;
  } catch (e) {
    hata = (e as Error).message;
  }

  const tamamla = completeMissingTranslations.bind(null, site.id);
  const menuCevir = translateMenus.bind(null, site.id);
  const progress = await getTranslationProgress(site.id);

  return (
    <>
      <PageHeader
        title="Çeviri denetimi"
        subtitle={site.name}
        actions={
          <Link href={`/siteler/${site.id}`} className="btn">
            ← Site
          </Link>
        }
      />

      {hata && (
        <div className="mb-5">
          <Alert tone="err">Denetim yapılamadı: {hata}</Alert>
        </div>
      )}

      <TranslationProgress total={progress.total} done={progress.done} />

      {audit && !audit.supported && (
        <Panel title="Polylang gerekli">
          <p className="mb-3 text-sm" style={{ color: 'var(--ink-3)' }}>
            {audit.message ??
              'Sitede çok dil eklentisi bulunamadı. Çeviri denetimi Polylang gerektirir.'}
          </p>
          <ol className="ml-4 list-decimal space-y-1 text-sm" style={{ color: 'var(--ink-2)' }}>
            <li>WordPress → Eklentiler → <strong>Polylang</strong> kurun</li>
            <li>Dilleri ekleyin (Türkçe varsayılan + İngilizce, Almanca, Fransızca, Arapça, Rusça)</li>
            <li>Mevcut içeriğe dil atayın (hepsi Türkçe)</li>
            <li>DPDAI Bridge <strong>1.4.0+</strong> kurulu olsun, site kartından bağlantıyı test edin</li>
          </ol>
        </Panel>
      )}

      {audit && audit.supported && audit.summary && (
        <div className="space-y-6">
          {/* --- kapsam --- */}
          <Panel title={`Kapsam · ${audit.summary.total_groups} içerik grubu`}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(audit.languages ?? [])
                .filter((l) => l !== audit!.default)
                .map((l) => {
                  const have = audit!.summary!.coverage[l] ?? 0;
                  const miss = audit!.summary!.missing[l] ?? 0;
                  const total = have + miss;
                  const pct = total ? Math.round((have / total) * 100) : 100;
                  return (
                    <div
                      key={l}
                      className="rounded-lg p-3"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface)' }}
                    >
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-sm font-medium">{dl(l)}</span>
                        <span className="text-xs tabular-nums" style={{ color: 'var(--ink-3)' }}>
                          {have}/{total}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--surface-3)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: miss ? 'var(--warn)' : 'var(--ok)' }}
                        />
                      </div>
                      {miss > 0 && (
                        <div className="mt-1.5 text-xs" style={{ color: 'var(--warn)' }}>
                          {miss} eksik çeviri
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            <div className="mt-5 flex flex-wrap items-start gap-3">
              <form action={tamamla}>
                <SubmitButton pendingText="Kuyruğa alınıyor…">Eksik çevirileri tamamla</SubmitButton>
              </form>
              <form action={menuCevir}>
                <SubmitButton className="btn" pendingText="Menüler çevriliyor…">
                  Menüleri çevir
                </SubmitButton>
              </form>
            </div>
            <p className="hint mt-2">
              <strong>Eksik çevirileri tamamla:</strong> her eksik dil için kaynak içerik çekilir,
              sektöre uygun çevrilir, orijinaline bağlı yayınlanır (eşiği geçen yayına, geçmeyen
              incelemeye). <strong>Menüleri çevir:</strong> navigasyon menüsünü her dile kopyalar,
              etiketleri çevirir, çevrili sayfalara bağlar ve dil değiştirici ekler.
            </p>
          </Panel>

          {/* --- bozuk/yarim ceviriler --- */}
          {audit.problems && audit.problems.length > 0 && (
            <Panel title={`Bozuk / yarım çeviriler · ${audit.problems.length}`}>
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Başlık</th>
                      <th>Dil</th>
                      <th>Sorun</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {audit.problems.slice(0, 100).map((p) => (
                      <tr key={p.post_id}>
                        <td className="max-w-md truncate">{p.title}</td>
                        <td className="text-xs whitespace-nowrap">{dl(p.lang)}</td>
                        <td className="text-xs" style={{ color: 'var(--warn)' }}>
                          {p.reason} (%{Math.round(p.ratio * 100)})
                        </td>
                        <td className="text-right">
                          <a href={p.url} target="_blank" rel="noreferrer noopener" className="btn-ghost btn-sm">
                            aç
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {/* --- eksik ceviriler --- */}
          <Panel title={`Eksik çeviriler · ${audit.items?.length ?? 0} içerik`}>
            {!audit.items || audit.items.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--ink-3)' }}>
                Eksik çeviri yok — tüm içerik tüm dillerde mevcut. 🎉
              </p>
            ) : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Başlık</th>
                      <th>Tür</th>
                      <th>Kaynak</th>
                      <th>Eksik diller</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {audit.items.slice(0, 200).map((it) => (
                      <tr key={it.source_id}>
                        <td className="max-w-sm truncate">{it.title}</td>
                        <td className="text-xs whitespace-nowrap" style={{ color: 'var(--ink-3)' }}>
                          {it.type}
                        </td>
                        <td className="text-xs whitespace-nowrap">{dl(it.source_lang)}</td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {it.missing.map((m) => (
                              <span
                                key={m}
                                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                                style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}
                              >
                                {m.toUpperCase()}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="text-right">
                          <a href={it.url} target="_blank" rel="noreferrer noopener" className="btn-ghost btn-sm">
                            aç
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}

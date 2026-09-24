import Link from 'next/link';
import { SubmitButton } from '@/components/SubmitButton';
import { notFound } from 'next/navigation';
import { IconCalendar, IconGlobe, IconPlug, IconSearch, IconTopics } from '@/components/icons';
import { SiteForm } from '@/components/SiteForm';
import { Alert, PageHeader, Panel, ScorePill, fmtDate } from '@/components/ui';
import { deleteSite, testSiteConnection, updateSite } from '@/lib/actions/sites';
import { prisma } from '@/lib/db';
import { computeSlots } from '@/lib/pipeline/schedule';
import { getPluginVersion, isOutdated } from '@/lib/plugin';

export const dynamic = 'force-dynamic';

type Caps = {
  wpVersion?: string;
  bridge?: { installed?: boolean; version?: string };
  i18n?: { mode?: string; languages?: string[] };
  categories?: { id: number; name: string }[];
  authors?: { id: number; name: string }[];
};

export default async function SiteDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const site = await prisma.site.findUnique({
    where: { id },
    include: {
      _count: { select: { topics: true, articles: true } },
      audits: { orderBy: { createdAt: 'desc' }, take: 1, select: { score: true, createdAt: true } },
    },
  });
  if (!site) notFound();

  const credentials = await prisma.apiCredential.findMany({
    orderBy: [{ kind: 'asc' }, { priority: 'asc' }],
  });
  const pluginVersion = await getPluginVersion();
  const caps = (site.capabilities ?? {}) as Caps;
  const bridgeEski = site.hasBridge && isOutdated(caps.bridge?.version, pluginVersion);
  const slots = computeSlots(site).slice(0, 6);
  const audit = site.audits[0] ?? null;

  const kaydet = updateSite.bind(null, site.id);
  const testEt = testSiteConnection.bind(null, site.id);
  const sil = deleteSite.bind(null, site.id);

  return (
    <>
      <PageHeader
        back={{ href: '/siteler', label: 'Siteler' }}
        title={site.name}
        subtitle={
          <a href={site.url} target="_blank" rel="noreferrer noopener" className="hover:underline">
            {site.url}
          </a>
        }
        actions={
          <>
            <form action={testEt}>
              <SubmitButton className="btn" pendingText="Test ediliyor…">
                <IconPlug />
                Bağlantıyı test et
              </SubmitButton>
            </form>
            <Link href={`/siteler/${site.id}/seo`} className="btn">
              <IconSearch />
              SEO denetimi
              {audit && (
                <span className="ml-1">
                  <ScorePill score={audit.score} />
                </span>
              )}
            </Link>
            <Link href={`/siteler/${site.id}/ceviri`} className="btn">
              <IconGlobe />
              Çeviri denetimi
            </Link>
            <Link href={`/konular?site=${site.id}`} className="btn">
              <IconTopics />
              Konular ({site._count.topics})
            </Link>
          </>
        }
      />

      {/* ------------------------------------------------------ durum kartları */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Panel title="Bağlantı" icon={<IconPlug />}>
          {site.lastCheckAt ? (
            <>
              <div
                className="text-sm font-medium"
                style={{ color: site.lastCheckOk ? 'var(--ok)' : 'var(--err)' }}
              >
                {site.lastCheckOk ? 'Çalışıyor' : 'Hata'}
              </div>
              <p className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>
                {site.lastCheckMsg}
              </p>
              <p className="mt-2 text-xs" style={{ color: 'var(--ink-3)' }}>
                {fmtDate(site.lastCheckAt)}
              </p>
            </>
          ) : (
            <p className="text-sm" style={{ color: 'var(--ink-3)' }}>
              Henüz test edilmedi.
            </p>
          )}
        </Panel>

        <Panel title="Tespit edilen eklentiler">
          <dl className="space-y-1.5 text-sm">
            <Row label="dpdai-bridge" value={site.hasBridge ? `v${caps.bridge?.version ?? '?'}` : 'kurulu değil'} />
            <Row label="SEO" value={site.seoPlugin.toLowerCase()} />
            <Row
              label="Çok dil"
              value={`${caps.i18n?.mode ?? 'none'}${
                caps.i18n?.languages?.length ? ` (${caps.i18n.languages.join(', ')})` : ''
              }`}
            />
            {caps.wpVersion && <Row label="WordPress" value={caps.wpVersion} />}
          </dl>

          {!site.hasBridge && (
            <div className="mt-3 space-y-2">
              <Alert tone="warn">
                SEO metaları, dil bağlantısı ve site denetimi için <code>dpdai-bridge</code>{' '}
                eklentisi gerekir.
              </Alert>
              <a href="/api/plugin/download" className="btn-primary btn-sm" download>
                Eklentiyi indir (v{pluginVersion})
              </a>
            </div>
          )}

          {bridgeEski && (
            <div className="mt-3">
              <Alert tone="warn">
                Sitede v{caps.bridge?.version} kurulu, güncel sürüm v{pluginVersion}. WordPress
                yönetiminde <strong>Eklentiler</strong> ekranından güncelleyebilirsiniz.
              </Alert>
            </div>
          )}
        </Panel>

        <Panel title="Sıradaki yayın saatleri" icon={<IconCalendar />}>
          {slots.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--ink-3)' }}>
              Yayın günü seçilmemiş.
            </p>
          ) : (
            <ul className="space-y-1 text-sm tabular-nums">
              {slots.map((d) => (
                <li key={d.toISOString()} style={{ color: 'var(--ink-2)' }}>
                  {fmtDate(d, site.timezone)}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {caps.categories?.length ? (
        <div className="mb-6">
          <Panel title="Sitedeki kategoriler">
            <p className="mb-3 text-xs" style={{ color: 'var(--ink-3)' }}>
              Üretim sırasında yazının kategorisi bunlarla eşleştirilir; eşleşme yoksa yenisi
              oluşturulur.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {caps.categories.slice(0, 40).map((c) => (
                <span key={c.id} className="pill-neutral">
                  {c.name}
                </span>
              ))}
            </div>
          </Panel>
        </div>
      ) : null}

      <SiteForm
        site={site}
        action={kaydet}
        submitLabel="Değişiklikleri kaydet"
        credentials={credentials}
      />

      <div className="card-pad mt-6" style={{ borderColor: 'var(--err-line)' }}>
        <h3 className="section-title" style={{ color: 'var(--err)' }}>
          Tehlikeli alan
        </h3>
        <p className="mt-2 mb-3 text-sm" style={{ color: 'var(--ink-2)' }}>
          Siteyi silmek, bu siteye ait tüm konuları, yazı kayıtlarını ve denetim geçmişini de
          siler. WordPress tarafındaki yayınlanmış yazılara dokunulmaz.
        </p>
        <form action={sil}>
          <button className="btn-danger">Siteyi sil</button>
        </form>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt style={{ color: 'var(--ink-3)' }}>{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

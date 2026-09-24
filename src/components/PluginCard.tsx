import Link from 'next/link';
import { IconCheck, IconPlug } from '@/components/icons';
import { Alert, Panel, fmtDate } from '@/components/ui';

export type SitePluginState = {
  id: string;
  name: string;
  hasBridge: boolean;
  installedVersion?: string;
  outdated: boolean;
  lastCheckAt: Date | null;
};

/**
 * Eklenti dagitim karti.
 *
 * Zip her indirmede depodaki kaynaktan uretilir; ayri bir yayin adimi yok.
 * Sitelere kurulan eklenti ayni adresi guncelleme icin de kullandigindan
 * surumu yukseltmek tek yerde yeterlidir.
 */
export function PluginCard({
  version,
  available,
  panelUrl,
  sites,
}: {
  version: string;
  available: boolean;
  panelUrl: string;
  sites: SitePluginState[];
}) {
  const kurulu = sites.filter((s) => s.hasBridge);
  const eski = kurulu.filter((s) => s.outdated);
  const eksik = sites.filter((s) => !s.hasBridge);

  // Uzak siteler localhost'a ulasamaz; otomatik guncelleme sessizce calismaz
  const yerelAdres = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(
    panelUrl,
  );

  return (
    <Panel
      title="WordPress köprü eklentisi"
      icon={<IconPlug />}
      action={
        available ? (
          <a href="/api/plugin/download" className="btn-primary btn-sm" download>
            <IconDownload />
            Eklentiyi indir
          </a>
        ) : null
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="pill-accent">sürüm {version}</span>
        {kurulu.length > 0 && (
          <span className="pill-neutral">{kurulu.length} sitede kurulu</span>
        )}
        {eski.length > 0 && <span className="pill-warn">{eski.length} sitede güncelleme var</span>}
        {eksik.length > 0 && <span className="pill-err">{eksik.length} sitede eksik</span>}
      </div>

      {!available && (
        <div className="mb-4">
          <Alert tone="err" title="Eklenti kaynağı bulunamadı">
            Sunucuda <code>wp-plugin/dpdai-bridge</code> klasörü yok. Docker imajını yeniden
            oluşturun.
          </Alert>
        </div>
      )}

      {!panelUrl && (
        <div className="mb-4">
          <Alert tone="warn" title="PANEL_URL tanımlı değil">
            Otomatik güncellemenin çalışması için <code>.env</code> içindeki{' '}
            <code>PANEL_URL</code> değerini panelin sitelerden erişilebilir adresi olarak
            ayarlayın. Tanımsızken eklenti güncellemeleri göremez, indirme butonu yine çalışır.
          </Alert>
        </div>
      )}

      {panelUrl && yerelAdres && (
        <div className="mb-4">
          <Alert tone="warn" title="Panel adresi yerel görünüyor">
            <code>PANEL_URL</code> şu an <code>{panelUrl}</code>. Uzaktaki WordPress siteleri bu
            adrese ulaşamaz, dolayısıyla otomatik güncelleme bildirimi çalışmaz —{' '}
            <strong>indirip elle kurmak yine çalışır</strong>. Sunucuya taşıdığınızda bu değeri
            panelin dışarıdan erişilebilir adresi yapın.
          </Alert>
        </div>
      )}

      {/* ------------------------------------------------------------ kurulum */}
      <details open={kurulu.length === 0}>
        <summary className="cursor-pointer text-sm font-medium">İlk kurulum</summary>
        <ol className="mt-3 space-y-2 text-sm" style={{ color: 'var(--ink-2)' }}>
          <li>
            <strong>1.</strong> Yukarıdaki <em>Eklentiyi indir</em> düğmesiyle zip dosyasını alın.
          </li>
          <li>
            <strong>2.</strong> WordPress yönetiminde{' '}
            <strong>Eklentiler → Yeni Ekle → Eklenti Yükle</strong> yolundan zip&apos;i yükleyip
            etkinleştirin.
          </li>
          <li>
            <strong>3.</strong> <strong>Araçlar → DPDAI Bridge</strong> sayfasındaki token&apos;ı
            kopyalayıp panelde ilgili sitenin kartına yapıştırın.
          </li>
          <li>
            <strong>4.</strong> Panelden <em>Bağlantıyı test et</em> deyin; sürüm ve tespit edilen
            eklentiler görünecek.
          </li>
        </ol>
      </details>

      {/* --------------------------------------------------------- güncelleme */}
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium">Güncelleme nasıl yayınlanır</summary>
        <div className="mt-3 space-y-2 text-sm" style={{ color: 'var(--ink-2)' }}>
          <p>
            Eklenti kodunu <code>wp-plugin/dpdai-bridge/</code> altında güncelleyip ana dosyadaki{' '}
            <code>Version:</code> satırını yükseltin, paneli yeniden başlatın. Hepsi bu kadar.
          </p>
          <p>
            Kurulu eklentiler panelin <code>/api/plugin/manifest</code> adresini 6 saatte bir
            sorar. Yeni sürüm görünce WordPress&apos;in kendi{' '}
            <strong>Eklentiler</strong> ekranında güncelleme rozeti çıkar; tek tıkla ya da
            otomatik güncellemeyle kurulur. Zip&apos;i tekrar tekrar elle yüklemeniz gerekmez.
          </p>
          <p style={{ color: 'var(--ink-3)' }}>
            Panel adresi, sitelere giden her istekte başlıkla bildirildiği için eklenti kendini
            yapılandırır. Sitede elle değiştirmek isterseniz Araçlar → DPDAI Bridge sayfasında
            alan var.
          </p>
        </div>
      </details>

      {/* ------------------------------------------------------------ siteler */}
      {sites.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 section-title">Sitelerdeki durum</div>
          <ul className="space-y-1.5">
            {sites.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/siteler/${s.id}`} className="min-w-0 flex-1 truncate hover:underline">
                  {s.name}
                </Link>

                {!s.hasBridge ? (
                  <span className="pill-err">kurulu değil</span>
                ) : s.outdated ? (
                  <>
                    <span className="pill-warn">
                      {s.installedVersion} → {version}
                    </span>
                  </>
                ) : (
                  <span className="pill-ok">
                    <IconCheck className="size-3" />
                    {s.installedVersion ?? version}
                  </span>
                )}

                <span className="w-28 text-right text-xs" style={{ color: 'var(--ink-3)' }}>
                  {s.lastCheckAt ? fmtDate(s.lastCheckAt) : 'test edilmedi'}
                </span>
              </li>
            ))}
          </ul>
          {eski.length > 0 && (
            <p className="mt-3 text-xs" style={{ color: 'var(--ink-3)' }}>
              Güncellemesi olan siteler WordPress yönetiminde kendiliğinden bildirim gösterir;
              buradan bir işlem yapmanız gerekmez.
            </p>
          )}
        </div>
      )}

      {/* ------------------------------------------------------- php endpoint */}
      <div
        className="mt-4 rounded-lg px-3 py-2.5 text-xs"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
      >
        <strong>WordPress olmayan siteler:</strong>{' '}
        <code>wp-plugin/php-endpoint/dpdai-receive.php</code> dosyasını sitenize kopyalayın,
        içindeki token ve veritabanı ayarlarını düzenleyin. Panelde platformu{' '}
        <em>Özel PHP site</em> seçip endpoint adresini girin.
      </div>
    </Panel>
  );
}

function IconDownload() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5 shrink-0"
    >
      <path d="M12 3v12M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

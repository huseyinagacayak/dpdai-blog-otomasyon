import { CredentialPool } from '@/components/CredentialPool';
import { PluginCard, type SitePluginState } from '@/components/PluginCard';
import { Alert, PageHeader, Panel, fmtDate, fmtMoney } from '@/components/ui';
import {
  runBackupNow,
  saveBudget,
  saveNotifications,
  testNotification,
} from '@/lib/actions/settings';
import { backupConfig, formatBytes, getBackupStatus } from '@/lib/backup';
import { getBudgetSettings, getBudgetStatus } from '@/lib/budget';
import { mask } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { getNotifySettings } from '@/lib/notify';
import { seedCredentialsFromLegacy } from '@/lib/providers/migrate';
import { getPluginVersion, isOutdated, panelUrl, pluginAvailable } from '@/lib/plugin';
import { IMAGE_PRESETS, TEXT_PRESETS } from '@/lib/providers/presets';

export const dynamic = 'force-dynamic';

function Toggle({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={checked} className="size-4" />
      {label}
    </label>
  );
}

export default async function AyarlarPage() {
  // Eski tek anahtarli ayarlar varsa havuza bir kez tasinir
  await seedCredentialsFromLegacy().catch(() => 0);

  const [budget, budgetStatus, notif, credentials, pluginVersion, pluginVar, backupStatus, siteRows] =
    await Promise.all([
      getBudgetSettings(),
      getBudgetStatus(),
      getNotifySettings(),
      prisma.apiCredential.findMany({ orderBy: [{ kind: 'asc' }, { priority: 'asc' }] }),
      getPluginVersion(),
      pluginAvailable(),
      getBackupStatus(),
      prisma.site.findMany({
        where: { status: { not: 'ARCHIVED' }, platform: 'WORDPRESS' },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          hasBridge: true,
          capabilities: true,
          lastCheckAt: true,
        },
      }),
    ]);

  const sitePlugins: SitePluginState[] = siteRows.map((s) => {
    const caps = (s.capabilities ?? {}) as { bridge?: { version?: string } };
    const kurulu = caps.bridge?.version;
    return {
      id: s.id,
      name: s.name,
      hasBridge: s.hasBridge,
      installedVersion: kurulu,
      outdated: s.hasBridge && isOutdated(kurulu, pluginVersion),
      lastCheckAt: s.lastCheckAt,
    };
  });

  const kanalVar = Boolean((notif.telegramToken && notif.telegramChatId) || notif.webhookUrl);
  const textCreds = credentials.filter((c) => c.kind === 'TEXT');
  const imageCreds = credentials.filter((c) => c.kind === 'IMAGE');
  const backupCfg = backupConfig();

  return (
    <>
      <PageHeader
        title="Ayarlar"
        subtitle="Buradaki değerler tüm siteler için varsayılandır. Site kartında istisna tanımlayabilirsiniz."
      />

      {/* ------------------------------------------------------------ eklenti */}
      <div className="mb-6">
        <PluginCard
          version={pluginVersion}
          available={pluginVar}
          panelUrl={panelUrl()}
          sites={sitePlugins}
        />
      </div>

      {/* ---------------------------------------------------------- API havuzu */}
      <div className="space-y-6">
        <Alert tone="info">
          Her iş için birden fazla sağlayıcı tanımlayabilirsiniz. Sıradaki ilk sağlayıcı
          denenir; hata verirse otomatik olarak bir sonrakine geçilir. Hepsi başarısız olursa
          üretim durur ve bildirim gönderilir. Sıralamayı ok tuşlarıyla değiştirin.
        </Alert>

        <CredentialPool
          kind="TEXT"
          title="Metin sağlayıcıları"
          description="Plan, metin, SEO paketi, editör eleştirisi, düzeltme, çeviri ve iç link seçimi bu havuzdan çalışır. Görsel denetimi için işaretli girişler kullanılır (Claude ve OpenAI uyumlu olanlar)."
          items={textCreds}
          presets={TEXT_PRESETS}
        />

        <CredentialPool
          kind="IMAGE"
          title="Görsel sağlayıcıları"
          description="Öne çıkan görseller bu havuzdan üretilir. Ücretli bir sağlayıcının altına ücretsiz bir yedek koymanız önerilir; kota dolduğunda üretim durmaz."
          items={imageCreds}
          presets={IMAGE_PRESETS}
        />
      </div>

      {/* ------------------------------------------------------------- bütçe */}
      <form action={saveBudget} className="mt-6">
        <Panel title="Aylık bütçe tavanı">
          <p className="mb-4 text-xs" style={{ color: 'var(--ink-3)' }}>
            Tüm sitelerin bu ayki toplam model harcaması. Sıfır bırakırsanız sınır uygulanmaz.
          </p>

          {budget.monthlyUsd > 0 && (
            <div className="mb-5">
              <div className="mb-1.5 flex justify-between text-sm">
                <span>
                  Bu ay <strong className="tabular-nums">{fmtMoney(budgetStatus.spent)}</strong> /{' '}
                  {fmtMoney(budget.monthlyUsd)}
                </span>
                <span className="tabular-nums" style={{ color: 'var(--ink-3)' }}>
                  %{Math.round(budgetStatus.ratio * 100)}
                </span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full"
                style={{ background: 'var(--surface-3)' }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, budgetStatus.ratio * 100)}%`,
                    background: !budgetStatus.allowed
                      ? 'var(--err)'
                      : budgetStatus.warning
                        ? 'var(--warn)'
                        : 'var(--ok)',
                  }}
                />
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="label">Aylık sınır (USD)</label>
              <input
                name="monthlyUsd"
                type="number"
                min={0}
                step="1"
                defaultValue={budget.monthlyUsd}
                className="input"
              />
              <p className="hint">0 = sınırsız</p>
            </div>
            <div>
              <label className="label">Sınır dolunca</label>
              <select name="action" defaultValue={budget.action} className="input">
                <option value="pause">Üretimi durdur</option>
                <option value="warn">Sadece uyar, devam et</option>
              </select>
              <p className="hint">Onaylı yazıların yayını her hâlükârda sürer</p>
            </div>
            <div>
              <label className="label">Uyarı eşiği (%)</label>
              <input
                name="warnAt"
                type="number"
                min={10}
                max={100}
                defaultValue={Math.round(budget.warnAt * 100)}
                className="input"
              />
            </div>
          </div>

          <button type="submit" className="btn-primary mt-4">
            Bütçeyi kaydet
          </button>
        </Panel>
      </form>

      {/* --------------------------------------------------------- bildirimler */}
      <form action={saveNotifications} className="mt-6">
        <Panel title="Bildirimler">
          <p className="mb-4 text-xs" style={{ color: 'var(--ink-3)' }}>
            Sistem gözetimsiz çalıştığı için hataları buradan öğrenirsiniz. Telegram için
            BotFather&apos;dan bot açıp token alın, sohbet kimliğini userinfobot&apos;tan öğrenin.
            Webhook alanı Slack ve Discord adresleriyle de çalışır.
          </p>

          {!kanalVar && (
            <div className="mb-4">
              <Alert tone="warn">
                Hiçbir kanal tanımlı değil; hatalar yalnızca panelde görünür.
              </Alert>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label">
                Telegram bot token{' '}
                <span style={{ color: 'var(--ink-3)' }}>
                  — kayıtlı: {mask(notif.telegramToken)}
                </span>
              </label>
              <input
                name="telegramToken"
                type="password"
                autoComplete="off"
                className="input"
                placeholder="Değiştirmek için yazın, silmek için tek tire (-)"
              />
            </div>
            <div>
              <label className="label">Telegram sohbet kimliği</label>
              <input
                name="telegramChatId"
                defaultValue={notif.telegramChatId ?? ''}
                className="input"
                placeholder="123456789"
              />
            </div>
            <div className="md:col-span-2">
              <label className="label">Webhook adresi (Slack / Discord / kendi ucunuz)</label>
              <input
                name="webhookUrl"
                defaultValue={notif.webhookUrl ?? ''}
                className="input"
                placeholder="https://hooks.slack.com/services/..."
              />
            </div>
            <div>
              <label className="label">Aynı konuda tekrar bildirim aralığı (dk)</label>
              <input
                name="throttleMinutes"
                type="number"
                min={1}
                defaultValue={notif.throttleMinutes}
                className="input"
              />
            </div>
            <div>
              <label className="label">Ne zaman bildirilsin</label>
              <div className="space-y-1.5">
                <Toggle name="onFailure" label="Üretim hatası" checked={notif.onFailure} />
                <Toggle name="onBudget" label="Bütçe eşiği" checked={notif.onBudget} />
                <Toggle name="onSiteDown" label="Site bağlantı hatası" checked={notif.onSiteDown} />
              </div>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button type="submit" className="btn-primary">
              Bildirimleri kaydet
            </button>
            <button type="submit" formAction={testNotification} className="btn">
              Test bildirimi gönder
            </button>
          </div>
        </Panel>
      </form>

      {/* ------------------------------------------------------------- yedekleme */}
      <form action={runBackupNow} className="mt-6">
        <Panel title="Veritabanı yedeği">
          <p className="mb-4 text-xs" style={{ color: 'var(--ink-3)' }}>
            Site kimlik bilgileri, API anahtarları ve tüm geçmiş Postgres&apos;te tutulur. Worker
            günde bir kez otomatik yedek alır; en yeni {backupCfg.keep} yedek saklanır, gerisi
            silinir. Yedekler <code>storage</code> volume&apos;una yazılır — sunucuyu silseniz de
            volume&apos;u koruyun. Geri yükleme: <code>pg_restore</code>.
          </p>

          {!backupCfg.enabled && (
            <div className="mb-4">
              <Alert tone="warn">
                Otomatik yedekleme kapalı (<code>BACKUP_ENABLED=false</code>). Aşağıdaki düğmeyle
                elle yedek alabilirsiniz.
              </Alert>
            </div>
          )}

          <div className="grid gap-3 text-sm md:grid-cols-3">
            <div>
              <div className="label">Durum</div>
              {backupStatus ? (
                <span
                  className="tabular-nums"
                  style={{ color: backupStatus.ok ? 'var(--ok)' : 'var(--err)' }}
                >
                  {backupStatus.ok ? '✓ başarılı' : '✕ başarısız'}
                </span>
              ) : (
                <span style={{ color: 'var(--ink-3)' }}>henüz yedek alınmadı</span>
              )}
            </div>
            <div>
              <div className="label">Son yedek</div>
              <span className="tabular-nums" style={{ color: 'var(--ink-3)' }}>
                {backupStatus ? fmtDate(new Date(backupStatus.at)) : '—'}
              </span>
            </div>
            <div>
              <div className="label">Boyut</div>
              <span className="tabular-nums" style={{ color: 'var(--ink-3)' }}>
                {backupStatus?.ok && backupStatus.bytes ? formatBytes(backupStatus.bytes) : '—'}
              </span>
            </div>
          </div>

          {backupStatus && !backupStatus.ok && backupStatus.error && (
            <div className="mt-3">
              <Alert tone="err">{backupStatus.error}</Alert>
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button type="submit" className="btn-primary">
              Şimdi yedekle
            </button>
            <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
              Zamanlama: <code>{backupCfg.cron}</code> ({process.env.TZ || 'Europe/Istanbul'})
            </span>
          </div>
        </Panel>
      </form>
    </>
  );
}

import type { ApiCredential, Site } from '@prisma/client';
import { SubmitButton } from '@/components/SubmitButton';
import { IMAGE_STYLE_PRESETS } from '@/lib/quality/imagePrompt';

const GUNLER = [
  { v: 1, l: 'Pzt' },
  { v: 2, l: 'Sal' },
  { v: 3, l: 'Çar' },
  { v: 4, l: 'Per' },
  { v: 5, l: 'Cum' },
  { v: 6, l: 'Cmt' },
  { v: 0, l: 'Paz' },
];

export function SiteForm({
  site,
  action,
  submitLabel,
  credentials = [],
}: {
  site?: Site | null;
  action: (fd: FormData) => Promise<void>;
  submitLabel: string;
  /** Havuzdaki saglayicilar - tercih listesi icin */
  credentials?: ApiCredential[];
}) {
  const s = site;
  const sec = 'section-title mt-9 mb-3';

  return (
    <form action={action} className="card-pad">
      {/* ---------------------------------------------------------- temel */}
      <h3 className="section-title">Temel bilgiler</h3>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <label className="label">Site adı</label>
          <input
            name="name"
            required
            defaultValue={s?.name ?? ''}
            className="input"
            placeholder="Örnek Blog"
          />
        </div>
        <div>
          <label className="label">Adres (https:// ile)</label>
          <input
            name="url"
            required
            type="url"
            defaultValue={s?.url ?? ''}
            className="input"
            placeholder="https://ornek.com"
          />
        </div>
        <div>
          <label className="label">Platform</label>
          <select name="platform" defaultValue={s?.platform ?? 'WORDPRESS'} className="input">
            <option value="WORDPRESS">WordPress</option>
            <option value="PHP_CUSTOM">Özel PHP site</option>
          </select>
        </div>
        <div>
          <label className="label">Durum</label>
          <select name="status" defaultValue={s?.status ?? 'ACTIVE'} className="input">
            <option value="ACTIVE">Aktif</option>
            <option value="PAUSED">Duraklatıldı</option>
            <option value="ARCHIVED">Arşiv</option>
          </select>
        </div>
      </div>

      {/* ---------------------------------------------------------- baglanti */}
      <h3 className={sec}>Bağlantı</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="label">WordPress kullanıcı adı</label>
          <input
            name="wpUsername"
            defaultValue={s?.wpUsername ?? ''}
            className="input"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="label">
            Uygulama şifresi{' '}
            {s ? <span className="text-slate-400">(değiştirmek için doldurun)</span> : null}
          </label>
          <input
            name="wpAppPassword"
            type="password"
            className="input"
            autoComplete="new-password"
            placeholder={s?.wpAppPassword ? 'kayıtlı' : 'xxxx xxxx xxxx xxxx'}
          />
        </div>
        <div>
          <label className="label">
            dpdai-bridge token{' '}
            {s ? <span className="text-slate-400">(değiştirmek için doldurun)</span> : null}
          </label>
          <input
            name="bridgeToken"
            type="password"
            className="input"
            autoComplete="off"
            placeholder={s?.bridgeToken ? 'kayıtlı' : 'Araçlar > DPDAI Bridge sayfasından'}
          />
        </div>
        <div>
          <label className="label">PHP endpoint (yalnızca özel PHP site)</label>
          <input
            name="bridgeUrl"
            defaultValue={s?.bridgeUrl ?? ''}
            className="input"
            placeholder="https://ornek.com/dpdai-receive.php"
          />
        </div>
      </div>

      {/* ---------------------------------------------------------- takvim */}
      <h3 className={sec}>Yayın takvimi</h3>
      <div className="grid gap-4 md:grid-cols-4">
        <div className="md:col-span-2">
          <label className="label">Yayın günleri</label>
          <div className="flex flex-wrap gap-1.5">
            {GUNLER.map((g) => (
              <label
                key={g.v}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs has-[:checked]:border-slate-900 has-[:checked]:bg-slate-900 has-[:checked]:text-white dark:border-slate-700 dark:has-[:checked]:border-white dark:has-[:checked]:bg-white dark:has-[:checked]:text-slate-900"
              >
                <input
                  type="checkbox"
                  name="publishDays"
                  value={g.v}
                  defaultChecked={(s?.publishDays ?? [1]).includes(g.v)}
                  className="sr-only"
                />
                {g.l}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Haftalık yazı sayısı</label>
          <input
            name="weeklyQuota"
            type="number"
            min={1}
            max={21}
            defaultValue={s?.weeklyQuota ?? 1}
            className="input"
          />
        </div>
        <div>
          <label className="label">Yayın saati</label>
          <input
            name="publishHour"
            type="number"
            min={0}
            max={23}
            defaultValue={s?.publishHour ?? 9}
            className="input"
          />
        </div>
        <div>
          <label className="label">Saat dilimi</label>
          <input name="timezone" defaultValue={s?.timezone ?? 'Europe/Istanbul'} className="input" />
        </div>
        <div className="md:col-span-3">
          <label className="label">Yayın modu</label>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700">
            <input
              type="checkbox"
              name="autoPublish"
              defaultChecked={s?.autoPublish ?? false}
              className="size-4"
            />
            Otomatik yayınla (kapalıysa yazı panelde inceleme kuyruğuna düşer, siz onaylayınca siteye gider)
          </label>
        </div>
      </div>

      {/* ---------------------------------------------------------- dil */}
      <h3 className={sec}>Dil</h3>
      <div className="grid gap-4 md:grid-cols-4">
        <div>
          <label className="label">Ana dil</label>
          <input
            name="defaultLocale"
            defaultValue={s?.defaultLocale ?? 'tr'}
            className="input"
            placeholder="tr"
          />
        </div>
        <div className="md:col-span-2">
          <label className="label">Yayın dilleri (virgülle)</label>
          <input
            name="locales"
            defaultValue={(s?.locales ?? ['tr']).join(', ')}
            className="input"
            placeholder="tr, en, de"
          />
        </div>
        <div>
          <label className="label">Çeviri yöntemi</label>
          <select name="i18nMode" defaultValue={s?.i18nMode ?? 'NONE'} className="input">
            <option value="NONE">Yok (tek dil)</option>
            <option value="POLYLANG">Polylang</option>
            <option value="WPML">WPML</option>
            <option value="SIBLING">Her dil ayrı site</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label">Kardeş site grubu (yalnızca her dil ayrı site)</label>
          <input
            name="siblingGroup"
            defaultValue={s?.siblingGroup ?? ''}
            className="input"
            placeholder="ornek-grubu"
          />
        </div>
      </div>

      {/* ---------------------------------------------------------- icerik */}
      <h3 className={sec}>İçerik kuralları</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="label">Hedef kitle</label>
          <input
            name="audience"
            defaultValue={s?.audience ?? ''}
            className="input"
            placeholder="Küçük işletme sahipleri"
          />
        </div>
        <div>
          <label className="label">Marka tonu</label>
          <input
            name="brandVoice"
            defaultValue={s?.brandVoice ?? ''}
            className="input"
            placeholder="Sade, güven veren, teknik ama anlaşılır"
          />
        </div>
        <div>
          <label className="label">Kelime sayısı (min)</label>
          <input
            name="wordCountMin"
            type="number"
            min={200}
            defaultValue={s?.wordCountMin ?? 900}
            className="input"
          />
        </div>
        <div>
          <label className="label">Kelime sayısı (maks)</label>
          <input
            name="wordCountMax"
            type="number"
            min={300}
            defaultValue={s?.wordCountMax ?? 1600}
            className="input"
          />
        </div>
        <div className="md:col-span-2">
          <label className="label">Yasaklı kelimeler (virgülle)</label>
          <input
            name="bannedWords"
            defaultValue={(s?.bannedWords ?? []).join(', ')}
            className="input"
          />
        </div>
        <div className="md:col-span-2">
          <label className="label">İç link politikası</label>
          <input
            name="internalLinkPolicy"
            defaultValue={s?.internalLinkPolicy ?? ''}
            className="input"
            placeholder="Her yazıda 2-3 iç link önerisi üret"
          />
        </div>
        <div className="md:col-span-2">
          <label className="label">Ek talimat</label>
          <textarea
            name="extraInstructions"
            rows={3}
            defaultValue={s?.extraInstructions ?? ''}
            className="input"
            placeholder="Bu sitede ürün adları İngilizce kalsın, fiyat verme..."
          />
        </div>
        <div>
          <label className="label">Varsayılan etiketler (virgülle)</label>
          <input
            name="defaultTags"
            defaultValue={(s?.defaultTags ?? []).join(', ')}
            className="input"
          />
        </div>
        <div>
          <label className="label">Varsayılan yazar ID (WordPress)</label>
          <input
            name="defaultAuthorId"
            type="number"
            defaultValue={s?.defaultAuthorId ?? ''}
            className="input"
          />
        </div>
      </div>

      {/* ------------------------------------------------------------ kalite */}
      <h3 className={sec}>Kalite kontrolü</h3>
      <div className="grid gap-4 md:grid-cols-4">
        <div className="md:col-span-4">
          <label className="label">İç linkleme</label>
          <label
            className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm"
            style={{ border: '1px solid var(--line-strong)' }}
          >
            <input
              type="checkbox"
              name="interlink"
              defaultChecked={s?.interlink ?? true}
              className="size-4"
            />
            Üretim sonrası gövdeye, bu sitedeki ilgili yazılara giden gerçek iç linkler yerleştir
          </label>
          <p className="hint">
            Bağlı metni model seçer, yerleştirmeyi kod yapar; metinde birebir geçmeyen ifadeye
            link atılmaz. Az iç link alan yazılar önceliklendirilir.
          </p>
        </div>

        <div className="md:col-span-2">
          <label className="label">Kalite modu</label>
          <select name="qualityMode" defaultValue={s?.qualityMode ?? 'AUTONOMOUS'} className="input">
            <option value="AUTONOMOUS">Otonom — bulguları kendi düzeltsin</option>
            <option value="CHECK">Denetim — sadece ölçüp puanlasın</option>
            <option value="OFF">Kapalı — hiç denetleme</option>
          </select>
          <p className="hint">
            Otonom modda sistem yazıyı ölçer, AI editör eleştirisi alır, kısa/zayıf bölümleri
            uzatır ve meta alanlarını düzeltir.
          </p>
        </div>
        <div>
          <label className="label">Yayın eşiği (0-100)</label>
          <input
            name="minSeoScore"
            type="number"
            min={0}
            max={100}
            defaultValue={s?.minSeoScore ?? 82}
            className="input"
          />
          <p className="hint">Bu puanın altı otomatik yayınlanmaz</p>
        </div>
        <div>
          <label className="label">En fazla düzeltme turu</label>
          <input
            name="maxRevisions"
            type="number"
            min={0}
            max={5}
            defaultValue={s?.maxRevisions ?? 2}
            className="input"
          />
          <p className="hint">Her tur ek maliyet demektir</p>
        </div>

        <div className="md:col-span-2">
          <label className="label">Görsel denetimi</label>
          <label
            className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm"
            style={{ border: '1px solid var(--line-strong)' }}
          >
            <input
              type="checkbox"
              name="imageQualityCheck"
              defaultChecked={s?.imageQualityCheck ?? true}
              className="size-4"
            />
            Üretilen görseli yapay zekâya kontrol ettir
          </label>
          <p className="hint">Metin, filigran, konu uyumsuzluğu ve anatomik bozukluk taraması</p>
        </div>
        <div>
          <label className="label">En fazla görsel denemesi</label>
          <input
            name="maxImageAttempts"
            type="number"
            min={1}
            max={4}
            defaultValue={s?.maxImageAttempts ?? 2}
            className="input"
          />
        </div>
        <div>
          <label className="label">Görselde istenmeyenler</label>
          <input
            name="imageNegative"
            defaultValue={s?.imageNegative ?? ''}
            className="input"
            placeholder="no people, no hands"
          />
          <p className="hint">İngilizce, virgülle</p>
        </div>
      </div>

      {/* ---------------------------------------------------------- saglayici */}
      <h3 className={sec}>Sağlayıcı tercihi (boş bırakılırsa havuz sırası kullanılır)</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="label">Metin sağlayıcı</label>
          <select
            name="preferredTextCredentialId"
            defaultValue={s?.preferredTextCredentialId ?? ''}
            className="input"
          >
            <option value="">Havuz sırası</option>
            {credentials
              .filter((c) => c.kind === 'TEXT')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.free ? ' (ücretsiz)' : ''}
                </option>
              ))}
          </select>
          <p className="hint">Seçilen giriş öne alınır; düşerse zincir yedek olarak devam eder.</p>
        </div>
        <div>
          <label className="label">Metin modeli (üstüne yazar)</label>
          <input
            name="textModel"
            defaultValue={s?.textModel ?? ''}
            className="input"
            placeholder="Boşsa sağlayıcının kendi modeli"
          />
        </div>

        <div>
          <label className="label">Görsel sağlayıcı</label>
          <select
            name="preferredImageCredentialId"
            defaultValue={s?.preferredImageCredentialId ?? ''}
            className="input"
          >
            <option value="">Havuz sırası</option>
            {credentials
              .filter((c) => c.kind === 'IMAGE')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.free ? ' (ücretsiz)' : ''}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="label">Görsel modeli (üstüne yazar)</label>
          <input
            name="imageModel"
            defaultValue={s?.imageModel ?? ''}
            className="input"
            placeholder="Boşsa sağlayıcının kendi modeli"
          />
        </div>

        <div>
          <label className="label">Görsel oranı</label>
          <select name="imageAspect" defaultValue={s?.imageAspect ?? '16:9'} className="input">
            <option value="16:9">16:9</option>
            <option value="3:2">3:2</option>
            <option value="4:3">4:3</option>
            <option value="1:1">1:1</option>
          </select>
        </div>
        <div>
          <label className="label">Görsel stili (marka görünümü)</label>
          <input
            name="imageStyle"
            defaultValue={s?.imageStyle ?? ''}
            className="input"
            list="dpdai-image-styles"
            placeholder="editorial · clean-studio · warm-lifestyle · modern-tech · flat-illustration · isometric"
          />
          <datalist id="dpdai-image-styles">
            {IMAGE_STYLE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </datalist>
        </div>
      </div>

      <div className="mt-8 flex gap-3">
        <SubmitButton pendingText="Kaydediliyor…">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}

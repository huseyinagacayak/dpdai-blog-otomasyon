# DPDAI Blog Otomasyon

**Türkçe** · [English](README.en.md)

Çok siteli, çok dilli, SEO uyumlu blog üretim ve yayın paneli.
Konu başlıklarını girersiniz; sistem takvime göre metni yazar, kendi kendini denetleyip
düzeltir, görseli üretip kalitesini kontrol eder, çevirir ve WordPress'e gönderir.
Siz panelden onaylarsınız.

## Ne yapar

| Adım | Açıklama |
|---|---|
| Takvim | Her site için "haftada kaç yazı, hangi gün, saat kaç" ayarı. Kota otomatik dağıtılır. |
| Plan | Konu başlığından arama niyeti, odak kelime, H2/H3 iskeleti ve SSS listesi çıkarır. |
| Metin | Plana göre HTML gövde. Standartlar prompt'a gömülü; klişe kalıplar yasak. |
| SEO | Meta başlık/açıklama, slug, OG etiketleri, kategori/etiket, iç link önerileri, JSON-LD (BlogPosting + FAQPage, SSS cevapları gövdeden okunur). |
| **Denetim** | 20+ maddelik ölçüm: uzunluk, bölüm yapısı, ince bölüm, yinelenen başlık, anahtar kelime yoğunluğu ve konumu, okunabilirlik (Ateşman), paragraf/cümle uzunluğu, klişe taraması, liste/tablo/SSS, alt metin. 5 alanda ağırlıklı 0-100 puan. |
| **Otonom düzeltme** | AI editör eleştirisi + mekanik bulgular birleştirilip hedefli düzeltme turu çalıştırılır. Kısa metni uzatır, ince bölümü derinleştirir, yoğunluğu dengeler, meta alanlarını yeniden yazar. Puan düşerse eski metin korunur. |
| **Görsel** | Yapılandırılmış prompt (konu / mekân / ruh hali / kadraj + marka stili + teknik kalite + olumsuzlar), WebP dönüşüm, teknik kontrol (boyut, oran, dosya boyutu) ve yapay zekâ ile görsel denetimi (metin, filigran, konu uyumu, anatomik bozukluk). Başarısızsa hatayı prompt'a ekleyip yeniden dener. |
| **İç linkleme** | Üretimden sonra gövdeye, aynı sitedeki yayınlanmış yazılara giden gerçek `<a>` linkleri yerleştirir. Bağlı metni model seçer, yerleştirmeyi kod yapar. |
| **Çakışma kontrolü** | Yeni konu eklerken havuzdaki konular, üretilmiş yazılar ve sitede zaten yayında olan sayfalarla karşılaştırır; yamyamlaşma riskini uyarır. |
| **Bütçe tavanı** | Aylık harcama sınırı; dolunca yeni üretimi durdurur, onaylı yazıların yayınına dokunmaz. |
| **Bildirim** | Üretim hatası, bütçe eşiği ve site bağlantı hatası Telegram veya webhook (Slack/Discord) ile bildirilir. |
| Çeviri | Birebir çeviri değil, hedef pazara uyarlama. HTML yapısı korunur ve doğrulanır; hedef dilde ayrı odak kelime belirlenir. |
| Yayın | WordPress REST + `dpdai-bridge`. Aynı yazı iki kez açılmaz (idempotent). Puan eşiği tutmayan yazı otomatik yayınlanmaz. |
| **İstatistik** | Üretim/yayın akışı, kalite dağılımı, site karşılaştırması, adım başına maliyet ve süre, hata oranları, yayın yoğunluğu ısı haritası. |
| **Site SEO denetimi** | Sitenin tamamını tarar: indeksleme, teknik, meta, içerik, yapısal veri. Sonunda öncelikli eylem planı üretir. |

## API havuzu ve yedeğe geçiş

Her iş için **birden fazla sağlayıcı** tanımlanır ve sıra ile denenir. Biri düşerse
otomatik olarak bir sonrakine geçilir; hepsi düşerse üretim durur ve bildirim gider.

**Ayarlar → Metin / Görsel sağlayıcıları** ekranından yönetilir. Sıralamayı ok tuşlarıyla
değiştirirsiniz. Her giriş için ayrı ayrı: model, anahtar, ücretsiz işareti, görsel denetimi
yeteneği ve etkin/pasif durumu.

### Hata sınıflandırma ve bekleme süreleri

Her arıza türü farklı davranır; geçici sorun yüzünden sağlayıcı kalıcı olarak elenmez:

| Arıza | Durum | Bekleme |
|---|---|---|
| Anahtar geçersiz (401/403) | `BROKEN` | 12 saat — siz düzeltmeden anlamsız |
| Kota/kredi bitti (402) | `BROKEN` | 6 saat |
| Hız sınırı (429) | `COOLDOWN` | 5 dk |
| Sunucu hatası (5xx) | `COOLDOWN` | 3 dk |
| Bağlantı/zaman aşımı | `COOLDOWN` | 2 dk |
| Geçersiz istek (400) | — | beklemez, sıradakine geçer |

Üst üste hata alan giriş giderek daha uzun bekletilir (en fazla 12 saat). Sağlık durumu
veritabanında tutulur, worker yeniden başlasa da bozuk anahtar tekrar tekrar denenmez.
Hepsi beklemedeyse en erken serbest kalacak olan yine de denenir — iş tamamen durmasın diye.

### Ücretsiz sağlayıcılar

Hazır ön ayarlarla gelir; yalnızca anahtarı girmeniz yeter.

**Metin:** Google Gemini, Groq, OpenRouter (`:free` modeller), Cerebras, Mistral,
GitHub Models, kendi yerel sunucunuz (Ollama / vLLM / RunPod).
**Görsel:** Pollinations (anahtar bile istemez), Gemini, Cloudflare Workers AI,
Hugging Face.

Önerilen kurulum: en üste ücretli/kaliteli sağlayıcı, altına bir iki ücretsiz yedek.
Kota dolduğunda üretim durmaz, sadece kalite bir kademe düşer. Ücretsiz işaretli girişlerin
harcaması bütçeye yazılmaz.

Panel yükseltme sonrası eski tek anahtarlı ayarlarınızı havuza otomatik taşır; görsel
sağlayıcınız hiç yoksa anahtarsız çalışan Pollinations yedeğini kendiliğinden ekler.

### Site bazında tercih

Site kartından bir giriş "tercih edilen" olarak seçilebilir — o giriş öne alınır, ama
düşerse zincir yine yedek olarak devreye girer.

## Tema

Panel açık, koyu ve sistem temasını destekler. **Varsayılan açık tema.** Seçim kenar
çubuğunun altındaki düğmelerden yapılır ve çerezde saklanır.

Tema sunucuda okunup `<html data-theme="...">` olarak basıldığı için sayfa önce yanlış
renkle çizilip sonra değişmez. Renk değerleri tek yerde (`globals.css` içindeki `--d-*`
belirteçleri) tanımlıdır; koyu paleti değiştirmek için tek bir yeri düzenlemek yeterlidir.

## İstatistikler

**İstatistik** sekmesi 7 / 30 / 90 günlük pencerelerle şunları gösterir:

- **Üretim ve yayın akışı** — günlük üretilen ve yayınlanan yazı sayısı (alan grafiği)
- **Yazı durumları** — halka grafik, yüzdelerle
- **Kalite puanı dağılımı** — 0-59 / 60-69 / 70-79 / 80-89 / 90-100 bantları, renk kodlu
- **Site başına üretim ve ortalama kalite** — siteleri yan yana karşılaştırma
- **Adım başına maliyet ve süre** — hangi adım ne kadar tutuyor, ne kadar sürüyor
- **Sağlayıcı kullanımı** — havuzdaki hangi API kaç çağrı aldı
- **Adım başına hata oranı** — nerede tıkanıyor
- **Yayın yoğunluğu** — son 13 haftanın günlük ısı haritası

Özet ekranında da son 14 günün akış grafiği var.

Grafikler harici kütüphane kullanmaz; saf SVG ve tema değişkenleriyle çizilir, iki temada
da doğru renklenir.

## Kalite standartları

Tüm eşikler tek dosyada: [`src/lib/quality/standards.ts`](src/lib/quality/standards.ts).
Aynı değerler üç yerde birden kullanılır — prompt üretimi, otomatik denetim ve düzeltme
talimatı — böylece "prompt bir şey der, denetim başka şey ölçer" durumu oluşmaz.

Varsayılanlar: meta başlık 45-60 karakter, meta açıklama 130-158, slug ≤6 kelime,
anahtar kelime yoğunluğu %0.5-2.5, 4-10 H2, bölüm başına ≥80 kelime, paragraf ≤110 kelime,
cümle ≤34 kelime, okunabilirlik ≥45, en az 3 cevaplı SSS sorusu, alt metin ≤125 karakter.

Puanlama ağırlıkları: meta 25, yapı 25, anahtar kelime 20, okunabilirlik 20, zenginlik 10.

### Kalite modu (site bazında)

| Mod | Davranış |
|---|---|
| `AUTONOMOUS` | Ölçer → AI editör eleştirisi alır → bulguları kendi düzeltir → yeniden ölçer. Varsayılan. |
| `CHECK` | Sadece ölçer ve puanlar; düzeltme yapmaz. |
| `OFF` | Denetim yok. |

**Yayın eşiği** (varsayılan 82) altındaki yazı otomatik yayınlanmaz, inceleme kuyruğuna
düşer. Panelden "Uyarılara rağmen yayınla" ile geçebilirsiniz.

## Kurulum (Docker)

```bash
cp .env.example .env
```

`.env` içinde şunları üretin:

```bash
openssl rand -hex 32
```

`ENCRYPTION_KEY` için bu değeri, `AUTH_SECRET` için `openssl rand -base64 32` çıktısını
kullanın. Sonra:

```bash
docker compose up -d --build
```

Panel: `http://sunucu-adresi:3000` — giriş `.env` içindeki `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

### RunPod notu

CPU pod yeterli; GPU gerekmiyor (görseller harici API'den geliyor). 3000 portunu dışarı
açın. `storage` volume'ü üretilen görselleri **ve veritabanı yedeklerini** tutar, silmeyin.
Postgres ve Redis yalnızca `127.0.0.1` üzerinden dinler.

## Kurulum (yerel geliştirme)

```bash
npm install
docker compose up -d postgres redis
npx prisma db push
npm run seed
npm run dev
```

Ayrı bir terminalde worker:

```bash
npm run dev:worker
```

## WordPress tarafı

### 1. Uygulama şifresi

WordPress'te **Kullanıcılar → Profil → Uygulama Şifreleri** bölümünden bir şifre üretin.
Panelde site kartına kullanıcı adı ve bu şifreyi girin. Bu kadarı yazı ve görsel
göndermeye yeter.

### 2. dpdai-bridge eklentisi (önerilir)

SEO metaları, Polylang/WPML dil bağlantısı, tekrarsız yayın ve **site geneli SEO denetimi**
için gerekir. Eklenti olmadan yazı yine gider ama SEO metaları yazılamaz ve denetim
yüzeysel kalır.

**Panelden indirin:** Ayarlar ekranının en üstündeki *WordPress köprü eklentisi* kartında
**Eklentiyi indir** düğmesi var. Zip, depodaki kaynaktan istek anında paketlenir; ayrı bir
yayın adımı yoktur.

WordPress → **Eklentiler → Yeni Ekle → Eklenti Yükle** → zip'i yükleyip etkinleştirin.
Ardından **Araçlar → DPDAI Bridge** sayfasındaki token'ı panelde site kartına yapıştırın.

#### Güncellemeler

Eklenti kendini panelden günceller — 10+ sitede zip'i tek tek yüklemenize gerek yok.

1. `wp-plugin/dpdai-bridge/` altındaki kodu güncelleyin.
2. Ana dosyadaki `Version:` satırını yükseltin (`1.2.0` → `1.3.0`).
3. Paneli yeniden başlatın.

Kurulu eklentiler panelin `/api/plugin/manifest` adresini 6 saatte bir sorar; yeni sürüm
görünce WordPress'in kendi **Eklentiler** ekranında güncelleme rozeti çıkar, tek tıkla
(veya otomatik güncelleme açıksa kendiliğinden) kurulur.

Panel adresi, sitelere giden her istekte `X-DPDAI-Panel` başlığıyla bildirildiği için
eklenti kendini yapılandırır. Bunun çalışması için `.env` içindeki **`PANEL_URL`**
değerinin sitelerden erişilebilir olması gerekir — `localhost` bırakılırsa güncelleme
bildirimi çalışmaz (panel bunu uyarı olarak gösterir), indirip elle kurmak yine çalışır.

`/api/plugin/download` ve `/api/plugin/manifest` uçları oturum aramaz: WordPress bunları
sunucudan sunucuya, çerezsiz çağırır. Pakette gizli bilgi yoktur; her kurulum kendi
token'ını üretir.

Ayarlar ekranındaki kart hangi sitede hangi sürümün kurulu olduğunu ve güncellemesi olanları
listeler.

Eklenti şunları kendi tespit eder: Yoast SEO / Rank Math / hiçbiri, Polylang / WPML /
tek dil, kategoriler ve yazar listesi. SEO eklentisi yoksa meta etiketlerini ve JSON-LD'yi
eklentinin kendisi basar.

### 3. Özel PHP siteler

`wp-plugin/php-endpoint/dpdai-receive.php` dosyasını sitenize kopyalayın, içindeki token
ve veritabanı ayarlarını düzenleyin. Panelde platformu **Özel PHP site**, endpoint'i bu
dosyanın tam URL'si olarak girin.

## İç linkleme

Üretim hattının son adımı. Kalite döngüsünden **sonra** çalışır, çünkü düzeltme turu gövdeyi
yeniden yazıp daha önce konmuş linkleri kaybettirir.

Aday havuzu iki kaynaktan beslenir, böylece **ilk yazı bile linksiz çıkmaz**:

- Bu sistemde üretilmiş, yayınlanmış yazılar
- **Sitenin kendi sayfaları** — ürünler, kategoriler, kurumsal sayfalar, eski yazılar.
  WordPress REST'ten yazı ve sayfa başlıkları, `sitemap.xml` zincirinden geri kalan her şey
  toplanır. Sitemap başlık vermediği için slug'dan etiket türetilir ve en yeni 50 sayfanın
  gerçek `<title>` değeri çekilir. Dizin bağlantı testinde tazelenir, 7 günden eskiyse
  kendiliğinden yenilenir.

Nasıl çalışır:

1. Aday havuzu kurulur; **az iç link alan yazılar önceliklendirilir**, böylece yetim sayfa
   birikmez.
2. Model, gövdede geçen ifadelerden bağlı metin ve hedef seçer.
3. **Yerleştirmeyi kod yapar.** Model uydurma bir bağlı metin verirse link atılmaz. Başlık,
   tablo başlığı ve mevcut link içine link konmaz; aynı paragrafta ikinci link açılmaz;
   aynı hedefe iki kez link verilmez.
4. Kurulan link grafiği veritabanına yazılır — yazı sayfasında "giden / gelen" olarak görünür.
   Site sayfalarına giden linkler ayrıca işaretlenir.

Kalite denetimi artık **öneri değil, gerçek `<a>` sayısını** ölçer. Düzeltme turu
prompt'unda mevcut linkleri birebir koruması istenir.

Site kartından kapatılabilir.

## Çakışma (yamyamlaşma) kontrolü

Aynı anahtar kelimeyi hedefleyen iki yazı birbirinin sıralamasını yer. Hacim arttıkça bu
kaçınılmazdır, o yüzden konu eklerken otomatik taranır.

Karşılaştırma üç kaynağa karşı yapılır: havuzdaki diğer konular, bu sistemde üretilmiş
yazılar ve **sitede halihazırda yayında olan sayfalar** (bağlantı testinde başlıkları çekilip
önbelleklenir).

Türkçe için özel iki ayar var:

- **Ön ek eşleştirme** — "diş" ile "dişleri" aynı kökten sayılır (sondan eklemeli dil).
- **İlk kelime ağırlığı** — "Kedi diş bakımı" ile "Köpek diş bakımı" %50 çıkar (eşiğin
  altında, uyarı vermez); "Kedi maması seçimi" ile "Kedi mamasında dikkat edilecekler" %67
  çıkar (uyarı verir). Konuyu belirleyen ilk kelime iki kat ağırlıklıdır.

Aynı odak kelime = kesin çakışma. Konu havuzunda kırmızı/sarı rozet olarak görünür,
ayrıntısı açılır; yanlış alarmı "yok say" ile kapatabilirsiniz. Tüm havuz her gece 04:20'de
yeniden taranır.

## Bütçe ve bildirimler

**Bütçe** — Ayarlar ekranından aylık USD sınırı verilir. Ücretli her iş (üretim, kalite
döngüsü, görsel, çeviri, iç link, site denetimi) başlamadan önce kontrol edilir. Sınır
dolduğunda:

- yeni üretim ve çeviri kuyruğa alınmaz,
- **onaylı yazıların yayını devam eder** (bu ücretsizdir ve bekletilmemeli),
- ilgili yazıya sebep yazılır, panelde ve bildirimde uyarı çıkar.

Harcama tek kaynaktan (`JobRun.costUsd`) hesaplanır; özet ekranındaki rakam ile bütçe
çubuğu asla farklı sayı göstermez.

**Bildirimler** — Telegram (BotFather token + sohbet kimliği) ve/veya webhook (Slack,
Discord veya kendi ucunuz). Tetikleyiciler: son denemede de başarısız olan iş, bütçe eşiği
ve aşımı, site bağlantı hatası. Aynı konuda tekrar bildirim için bekleme süresi
ayarlanabilir (varsayılan 30 dk), böylece tek bir arıza kanalı doldurmaz.

## Yedekleme

Worker günde bir kez otomatik **Postgres yedeği** alır (`pg_dump`, sıkıştırılmış custom
format). Yedekler `storage` volume'unun altındaki `backups/` klasörüne yazılır; en yeni
`BACKUP_KEEP` (varsayılan 14) dosya saklanır, gerisi silinir. Başarısız olursa bildirim gider
ve **Ayarlar → Veritabanı yedeği** kartında hata görünür. Aynı karttan **Şimdi yedekle**
düğmesiyle elle de alınır.

Ayarlar (`.env`): `BACKUP_ENABLED` (varsayılan açık), `BACKUP_CRON` (varsayılan `30 3 * * *`),
`BACKUP_KEEP`, `BACKUP_DIR`. Docker imajında `postgresql-client-17` kuruludur (dump ikilisi
sunucu sürümüne eşit olmalı). Docker **dışında** çalıştırıyorsanız `pg_dump`'ı PATH'e ekleyin
ya da `PG_DUMP_PATH` ile tam yolu verin; yoksa iş anlaşılır bir hatayla sonuçlanır (yerel
geliştirmede bildirim kanalı tanımlı değilse sadece worker günlüğüne düşer).

**Geri yükleme:**

```bash
# custom format -> pg_restore (temiz veritabanına)
pg_restore --clean --if-exists --no-owner --no-privileges \
  -d "postgresql://dpdai:PAROLA@127.0.0.1:5432/dpdai" storage/backups/dpdai-YYYYMMDD-HHmmss.dump
```

`ENCRYPTION_KEY`'i **ayrı** bir yerde saklayın: yedek şifreli site parolalarını ve API
anahtarlarını içerir, bu anahtar olmadan çözülemezler.

## Site SEO denetimi

**Siteler → (site) → SEO denetimi** ekranından çalıştırılır. İki kaynaktan beslenir:

**Panelin kendi dış sondaları** (her sitede çalışır)
robots.txt (erişim, tüm siteyi engelleme, sitemap satırı), site haritası (varlık, geçerli
XML, bağlantı sayısı), ana sayfa (yanıt süresi, `<title>`, meta description, canonical,
`html lang`, viewport, H1 sayısı, Open Graph, JSON-LD tipleri, hreflang).

**dpdai-bridge derin taraması** (eklenti kuruluysa)
Arama motoru görünürlüğü, kalıcı bağlantı yapısı, PHP/WP sürümü, önbellek ve görsel
optimizasyon eklentisi, `WP_DEBUG`, SEO eklentisi ayarları (etiket/tarih arşivi noindex,
ek dosya yönlendirmesi, kurum şeması), meta başlığı/açıklaması eksik yazılar, öne çıkan
görseli olmayan yazılar, 300 kelime altı ince içerik, yinelenen başlıklar, uzun slug'lar,
2 yıldır güncellenmemiş yazılar, kategorisiz yazılar, açıklamasız kategoriler, aşırı
etiket, alt metni olmayan görseller.

Sonuç 5 alanda puanlanır (indeksleme 25, teknik 20, meta 25, içerik 20, yapısal veri 10)
ve AI bir **öncelikli eylem planı** üretir: ne yapılacak, neden önemli, WordPress'te
nereye tıklanacak.

## Kullanım akışı

1. **Ayarlar** → sağlayıcıları ve API anahtarlarını girin.
2. **Siteler → Yeni site** → bağlantı, takvim, dil, marka tonu, kalite modu.
3. **Bağlantıyı test et** → eklentiler tespit edilir.
4. **SEO denetimi** → sitenin mevcut durumunu görün, eylem planını uygulayın.
5. **Konu havuzu** → başlıkları satır satır yapıştırın:
   ```
   Kedilerde diş bakımı | kedi diş bakımı | veteriner görüşü içersin
   Köpek maması seçimi
   ```
6. Sistem takvime dizer, yayın saatinden `LEAD_HOURS` (varsayılan 36) saat önce üretmeye
   başlar ve kalite döngüsünü çalıştırır.
7. **Yazılar → İnceleme bekliyor** → puanı, denetim bulgularını, AI editör eleştirisini ve
   görsel denetim sonucunu görüp **Onayla ve yayınla**. Onaylamadığınız yazı siteye
   hiç gitmez.

## Zamanlama

- `plan` işi saatte bir çalışır, boş takvim slotlarına konu yerleştirir.
- `dispatch` işi 5 dakikada bir çalışır, zamanı gelen üretim/yayın/çeviri işlerini kuyruğa atar.
- `conflicts` işi her gece 04:20'de tüm havuzu çakışmaya karşı yeniden tarar.
- Üretim, yayın saatinden `LEAD_HOURS` saat önce başlar.

## Sağlayıcılar

Sağlayıcılar artık tek tek değil, **havuz** olarak yönetilir — yukarıdaki
"API havuzu ve yedeğe geçiş" bölümüne bakın.

Görsel denetimi, havuzdaki "görsel denetimi yapabilir" işaretli metin girişlerinden
çalışır (Claude ve OpenAI uyumlu olanlar). Hiç işaretli giriş yoksa denetim atlanır ve
yalnızca teknik kontroller (boyut, oran, dosya boyutu) uygulanır.

## Güvenlik

- Site şifreleri ve API anahtarları veritabanında AES-256-GCM ile şifrelenir
  (`ENCRYPTION_KEY`). Bu anahtarı kaybederseniz kayıtlı şifreleri yeniden girmeniz gerekir.
- Panel oturumu HttpOnly çerez + HS256 JWT (`AUTH_SECRET`).
- Modelden gelen HTML, WordPress'e gitmeden önce beyaz liste ile temizlenir
  (script/iframe/style ve tüm olay öznitelikleri atılır, `javascript:` href'leri düşürülür).
- Paneli internete açacaksanız önüne HTTPS koyun.

## Dizin yapısı

```
prisma/schema.prisma           veri modeli
src/lib/quality/standards.ts   TEK KAYNAK: içerik ve görsel kalite eşikleri
src/lib/quality/analyze.ts     içerik denetim motoru (puan + düzeltme talimatı)
src/lib/quality/readability.ts Ateşman (TR) / Flesch okunabilirlik
src/lib/quality/imagePrompt.ts görsel prompt kurucusu + stil ön ayarları
src/lib/quality/similarity.ts  Türkçe başlık benzerliği (çakışma kontrolü)
src/lib/budget.ts              aylık bütçe tavanı ve durum hesabı
src/lib/backup.ts              otomatik pg_dump yedeği + budama + durum
src/lib/notify.ts              Telegram / webhook bildirimleri
src/lib/providers/pool.ts      API havuzu: zincir, hata sınıflandırma, sağlık takibi
src/lib/providers/presets.ts   hazır sağlayıcı ön ayarları (ücretsizler dahil)
src/lib/providers/text/        Claude / OpenAI / OpenAI uyumlu her servis
src/lib/providers/image/       OpenAI / Gemini / Ideogram / Stability / Pollinations
                               / Cloudflare / Hugging Face
src/lib/providers/vision/      görsel denetimi (havuzdan, görme yetenekli girişlerle)
src/lib/providers/publish/     WordPress REST, özel PHP endpoint
src/lib/pipeline/quality.ts    otonom kalite döngüsü (eleştiri + düzeltme)
src/lib/pipeline/interlink.ts  iç link seçimi ve güvenli yerleştirme
src/lib/pipeline/siteIndex.ts  sitemap + REST ile site sayfa dizini
src/lib/pipeline/conflicts.ts  yamyamlaşma taraması
src/lib/pipeline/siteAudit.ts  site geneli SEO denetimi + eylem planı
src/components/charts.tsx      saf SVG grafikler (alan, çubuk, sütun, halka, ısı haritası)
src/lib/theme.ts               açık / koyu / sistem tema tercihi
src/app/                       panel arayüzü (Türkçe)
worker/index.ts                kuyruk işçisi ve zamanlayıcı
src/lib/plugin.ts              eklenti paketleme, sürüm okuma, karşılaştırma
wp-plugin/dpdai-bridge/        WordPress köprü eklentisi (+ seo-audit, updater)
wp-plugin/php-endpoint/        özel PHP siteler için alıcı
```

## Bilinen notlar

- Next 16, `src/middleware.ts` dosya adını "deprecated" olarak işaretliyor ve `proxy.ts`
  öneriyor. Mevcut hâli çalışıyor; oturum korumasını taşımak ayrı bir adım olarak
  planlanmıştır.
- Proje OneDrive ile eşitlenen bir klasördeyse `.next` ve `node_modules` dosya kilidi
  hatası verebilir (`EPERM ... unlink`). Çözüm: `rm -rf .next` sonra yeniden derleyin ya da
  projeyi eşitlenmeyen bir klasöre taşıyın. Docker ile çalıştırırken bu sorun yaşanmaz.

## Yapılmayanlar (sıradaki adaylar)

- Gövde içi görsel: `MediaAsset` modelinde `INLINE` rolü var ama kullanılmıyor.
- Yayın sonrası IndexNow bildirimi ve içerik tazeleme döngüsü.
- Otomatik test seti (`analyzeContent`, `insertLinks` ve `similarity` saf mantık, kolay
  test edilir).

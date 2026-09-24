/**
 * Panel arayuzu cok dil destegi (TR varsayilan, EN opsiyonel).
 *
 * Tasarim: sozluk anahtari = TURKCE kaynak metin. `t(locale, 'Ayarlar')` EN
 * karsiligini dondurur; yoksa Turkce'yi dondurur. Boylece bir metin henuz
 * cevrilmemis olsa bile arayuz ASLA bozulmaz/bos kalmaz — Turkce gorunur.
 *
 * Bu dosya SAFtir (sunucuya ozel import yok): hem sunucu hem istemci bilesenleri
 * `t` ve `Locale`'i buradan alabilir. Cerezden okuma `getLocale` (lib/locale.ts)
 * sunucu tarafindadir.
 */

export type Locale = 'tr' | 'en';

export const LOCALE_COOKIE = 'dpdai_lang';

/** TR kaynak metin -> EN karsiligi. Buyudukce kapsam artar. */
const EN: Record<string, string> = {
  // --- gezinme / navigation
  'Özet': 'Overview',
  'Yazılar': 'Posts',
  'Konu Havuzu': 'Topic pool',
  'Takvim': 'Calendar',
  'Siteler': 'Sites',
  'İstatistik': 'Statistics',
  'Kayıtlar': 'Logs',
  'Ayarlar': 'Settings',
  'Çıkış yap': 'Log out',
  'İnceleme bekliyor': 'Needs review',
  'Blog Otomasyon': 'Blog Automation',

  // --- ortak / common
  'Kaydet': 'Save',
  'Değişiklikleri kaydet': 'Save changes',
  'İptal': 'Cancel',
  'Sil': 'Delete',
  'Onayla': 'Approve',
  'Onayla, başlat': 'Confirm & start',
  'Vazgeç': 'Cancel',
  'Kapat': 'Close',
  'Düzenle': 'Edit',
  'Geri': 'Back',
  'aç': 'open',
  'Yeni': 'New',
  'Tümü': 'All',
  'Ara': 'Search',
  'İşleniyor…': 'Working…',
  'Kaydediliyor…': 'Saving…',
  'Test ediliyor…': 'Testing…',
  'Kaydedildi': 'Saved',
  'Evet': 'Yes',
  'Hayır': 'No',
  'Açık': 'Light',
  'Koyu': 'Dark',
  'Sistem': 'System',
  'Türkçe': 'Turkish',
  'İngilizce': 'English',
  'Dil': 'Language',

  // --- yazi durumlari / article statuses
  'Sırada': 'Queued',
  'Metin yazılıyor': 'Writing',
  'Düzeltiliyor': 'Revising',
  'Görsel üretiliyor': 'Generating image',
  'Çevriliyor': 'Translating',
  'Onaylandı': 'Approved',
  'Yayında': 'Published',
  'Yayınlanıyor': 'Publishing',
  'Başarısız': 'Failed',

  // --- özet / dashboard
  'Son 14 gün': 'Last 14 days',
  'Bu ay harcama': 'This month’s spend',
  'Toplam yazı': 'Total posts',
  'Aktif site': 'Active sites',
  'Henüz veri yok': 'No data yet',
  'üretim hattı ve yayın takvimi': 'production pipeline & publish schedule',
  'Takvimi yeniden hesapla': 'Recalculate schedule',
  'Son 7 günde yayında': 'Published in last 7 days',
  'Havuzdaki konu': 'Topics in pool',
  'Bu ay maliyet': 'This month’s cost',
  'bütçe': 'budget',
  'kullanıldı': 'used',
  'otomatik düzeltme turu': 'automatic revision rounds',
  'tüm istatistikler': 'all statistics',
  'üretilen': 'produced',
  'yayınlanan': 'published',
  'Onayını bekleyenler': 'Awaiting approval',
  'tümü': 'all',
  'Bekleyen yazı yok.': 'No posts pending.',
  'kelime': 'words',
  'düzeltme': 'revision',
  'Yaklaşan yayınlar': 'Upcoming posts',
  'Takvimde yazı yok': 'No posts scheduled',
  'Konu havuzuna başlık ekleyin; sistem takvime dizip üretmeye başlar.':
    'Add topics to the pool; the system schedules and starts producing them.',
  'Konu havuzu': 'Topic pool',
  'Bu ayki ortalama kalite': 'This month’s average quality',
  'Üretilen yazıların otomatik denetim ortalaması':
    'Average automatic review score of produced posts',
  'Son hatalar': 'Recent errors',
  'yazıyı aç →': 'open post →',
  'Aylık bütçe doldu': 'Monthly budget reached',
  'Bu ay {x} harcandı. Yeni üretim durduruldu; onaylı yazıların yayını sürüyor.':
    'Spent {x} this month. New production is paused; approved posts still publish.',
  'Bütçeyi ayarla': 'Adjust budget',
  'Bütçenin sonuna yaklaşıldı': 'Approaching budget limit',
  'Bu ay {x} harcandı': 'Spent {x} this month',
  'yazı hata durumunda': 'posts in error state',
  'Hatalı yazıları görüntüle': 'View failed posts',
  '— çoğu durumda "Tekrar dene" yeterli olur.':
    '— in most cases "Retry" is enough.',

  // --- siteler / sites
  'Yeni site': 'New site',
  'Bağlantıyı test et': 'Test connection',
  'SEO denetimi': 'SEO audit',
  'Çeviri denetimi': 'Translation audit',
  'Konular': 'Topics',
  'Siteyi sil': 'Delete site',
  'Bağlantı': 'Connection',
  'Tespit edilen eklentiler': 'Detected plugins',
  'Sıradaki yayın saatleri': 'Upcoming publish times',
  'Çalışıyor': 'Working',
  'Çok dil': 'Multilingual',

  // --- ceviri / translation
  'Eksik çevirileri tamamla': 'Complete missing translations',
  'Menüleri çevir': 'Translate menus',
  'Menüler çevriliyor…': 'Translating menus…',
  'Kuyruğa alınıyor…': 'Queuing…',
  'Kapsam': 'Coverage',
  'Eksik çeviriler': 'Missing translations',
  'Bozuk / yarım çeviriler': 'Broken / partial translations',
  'Çeviriler yapılıyor': 'Translations in progress',
  'Çeviriler tamamlandı': 'Translations complete',
  'Polylang gerekli': 'Polylang required',

  // --- giris / login
  'Giriş yap': 'Sign in',
  'E-posta': 'Email',
  'Parola': 'Password',
  'Şifre': 'Password',
  'Giriş yapılıyor…': 'Signing in…',
  'Blog Otomasyon Paneli': 'Blog Automation Panel',
  'E-posta veya şifre hatalı.': 'Wrong email or password.',
};

/** Cevirir; EN karsiligi yoksa Turkce kaynak metni dondurur (guvenli dusus). */
export function t(locale: Locale, tr: string): string {
  if (locale === 'en') return EN[tr] ?? tr;
  return tr;
}

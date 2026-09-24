import type { Site, Topic } from '@prisma/client';
import {
  CONTENT,
  contentRulesBlock,
  seoRulesBlock,
  styleRulesBlock,
} from '@/lib/quality/standards';

export const LOCALE_NAMES: Record<string, string> = {
  tr: 'Türkçe',
  en: 'İngilizce',
  de: 'Almanca',
  fr: 'Fransızca',
  es: 'İspanyolca',
  it: 'İtalyanca',
  ru: 'Rusça',
  ar: 'Arapça',
  nl: 'Felemenkçe',
  pt: 'Portekizce',
  pl: 'Lehçe',
  az: 'Azerbaycan Türkçesi',
  fa: 'Farsça',
  zh: 'Çince',
  ja: 'Japonca',
  uk: 'Ukraynaca',
  el: 'Yunanca',
  ro: 'Rumence',
  bg: 'Bulgarca',
  sv: 'İsveççe',
};

export function localeName(code: string): string {
  return LOCALE_NAMES[code] ?? code.toUpperCase();
}

/** Her istekte gonderilen ortak kimlik/kural blogu. */
export function systemPrompt(site: Site, locale: string): string {
  const lines = [
    'Sen deneyimli bir SEO içerik editörüsün. Arama motorlarında üst sıralara çıkan,',
    'ama önce insanın okuduğu içerikler yazarsın. Yapay zekâ klişelerinden kaçınırsın.',
    '',
    `SİTE: ${site.name} (${site.url})`,
    `YAZIM DİLİ: ${localeName(locale)} (${locale}). Tüm çıktı bu dilde olmalı.`,
  ];

  if (site.audience) lines.push(`HEDEF KİTLE: ${site.audience}`);
  if (site.brandVoice) lines.push(`MARKA TONU: ${site.brandVoice}`);
  if (site.internalLinkPolicy) lines.push(`İÇ LİNK POLİTİKASI: ${site.internalLinkPolicy}`);
  if (site.extraInstructions) lines.push(`EK TALİMAT: ${site.extraInstructions}`);

  lines.push('', styleRulesBlock(site.bannedWords), '', 'DOĞRULUK:',
    '- Bilmediğin veriyi uydurma. Sahte kaynak, sahte tarih, sahte istatistik üretme.',
    '- Sayı verirken doğrulanabilir ve genel olanı seç; belirsizse "yaklaşık" gibi ifade kullan.',
    '- Yasal, tıbbi veya finansal konularda kesin tavsiye verme, uzmana yönlendir.');

  return lines.join('\n');
}

/* ------------------------------------------------------------------ plan */

export type Outline = {
  h1: string;
  searchIntent: string;
  focusKeyword: string;
  secondaryKeywords: string[];
  peopleAlsoAsk: string[];
  sections: { h2: string; points: string[]; h3?: string[] }[];
  faq: string[];
  tags: string[];
  category: string;
};

export function outlinePrompt(site: Site, topic: Topic, locale: string): string {
  return `KONU: ${topic.title}
${topic.keyword ? `ODAK ANAHTAR KELİME: ${topic.keyword}` : ''}
${topic.notes ? `BRIEF: ${topic.notes}` : ''}
HEDEF UZUNLUK: ${site.wordCountMin}-${site.wordCountMax} kelime
DİL: ${localeName(locale)}

Bu konu için arama niyetini karşılayan bir içerik planı çıkar.
Planın her bölümü ayrı bir alt soruyu cevaplasın; bölümler birbirini tekrar etmesin.

Şu JSON şemasında yanıt ver:
{
  "h1": "Yazının ana başlığı (55-65 karakter, odak kelime başta)",
  "searchIntent": "informational | commercial | transactional | navigational",
  "focusKeyword": "tek bir odak anahtar kelime",
  "secondaryKeywords": ["3-6 adet yan anahtar kelime / semantik varyasyon"],
  "peopleAlsoAsk": ["okuyucunun gerçekten sorduğu 3-5 soru"],
  "sections": [
    { "h2": "Bölüm başlığı", "points": ["işlenecek 2-4 somut madde"], "h3": ["varsa alt başlıklar"] }
  ],
  "faq": ["SSS bölümünde cevaplanacak ${CONTENT.minFaq}-5 soru"],
  "tags": ["4-8 etiket"],
  "category": "en uygun tek kategori adı"
}

${CONTENT.h2.min}-${CONTENT.h2.max} arası H2 bölümü planla (ideal ${CONTENT.h2.ideal}).
Her bölümün en az ${CONTENT.sectionMinWords} kelime yazılabilecek kadar dolu olmasına dikkat et:
tek cümlede biten bölüm planlama.`;
}

/* ------------------------------------------------------------------ metin */

export function draftPrompt(site: Site, topic: Topic, outline: Outline): string {
  return `Aşağıdaki plana göre yazının TAM METNİNİ HTML olarak yaz.

BAŞLIK (H1): ${outline.h1}
ODAK KELİME: ${outline.focusKeyword}
YAN KELİMELER: ${(outline.secondaryKeywords ?? []).join(', ')}
ARAMA NİYETİ: ${outline.searchIntent}
${topic.notes ? `BRIEF: ${topic.notes}` : ''}

PLAN:
${outline.sections
  .map(
    (s, i) =>
      `${i + 1}. ${s.h2}\n   - ${s.points.join('\n   - ')}${
        s.h3?.length ? `\n   Alt başlıklar: ${s.h3.join(' | ')}` : ''
      }`,
  )
  .join('\n')}

SSS: ${(outline.faq ?? []).join(' | ')}

${contentRulesBlock({
  wordMin: site.wordCountMin,
  wordMax: site.wordCountMax,
  focusKeyword: outline.focusKeyword,
})}

ÇIKTI KURALLARI (çok önemli):
- Sadece gövde HTML'i döndür. <html>, <head>, <body> YAZMA. H1 YAZMA (WordPress başlığı ayrı).
- İzinli etiketler: <h2> <h3> <p> <ul> <ol> <li> <strong> <em> <blockquote>
  <table> <thead> <tbody> <tr> <th> <td>
- Markdown kullanma, kod bloğu ile sarma. Doğrudan <h2> veya <p> ile başla.
- Başlıkları (H2/H3) cümle düzeninde yaz: yalnızca ilk kelimenin ilk harfi büyük.
  Kısaltmaları büyük bırak (POS, SEO, KDV, KVKK gibi). Başlıkları tümü küçük yazma.
- Dış link verme; iç link önerilerini ayrı adımda vereceksin, metne <a> koyma.
- Sonuç bölümünde okuyucuya net bir sonraki adım ver.`;
}

/* -------------------------------------------------------------------- seo */

export type SeoPack = {
  metaTitle: string;
  metaDescription: string;
  slug: string;
  excerpt: string;
  ogTitle?: string;
  ogDescription?: string;
  tags: string[];
  category: string;
  internalLinkSuggestions?: { anchor: string; targetTopic: string; reason: string }[];
  imageBrief: {
    subject: string;
    setting: string;
    mood: string;
    composition: string;
  };
  imageAlt: string;
  imageCaption?: string;
};

export function seoPrompt(outline: Outline, contentHtml: string, locale: string): string {
  const excerpt = contentHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 6000);

  return `Aşağıdaki yazı için SEO paketini hazırla. Dil: ${localeName(locale)} (${locale}).

BAŞLIK: ${outline.h1}
ODAK KELİME: ${outline.focusKeyword}

YAZI (düz metin, kısaltılmış):
${excerpt}

${seoRulesBlock()}

Şu JSON şemasında yanıt ver:
{
  "metaTitle": "${CONTENT.metaTitle.min}-${CONTENT.metaTitle.max} karakter, odak kelime başta",
  "metaDescription": "${CONTENT.metaDescription.min}-${CONTENT.metaDescription.max} karakter, odak kelime geçen, fayda vaat eden",
  "slug": "kisa-url-slug-ascii",
  "excerpt": "WordPress özeti, 1-2 cümle",
  "ogTitle": "sosyal medya başlığı, en fazla 70 karakter",
  "ogDescription": "sosyal medya açıklaması, en fazla 160 karakter",
  "tags": ["4-8 etiket"],
  "category": "tek kategori adı",
  "internalLinkSuggestions": [
    { "anchor": "yazıda geçen tam ifade", "targetTopic": "hangi konuya link verilmeli", "reason": "neden" }
  ],
  "imageBrief": {
    "subject": "İNGİLİZCE. Görselin ana öznesi: somut, tek bir sahne. Soyut kavram yazma.",
    "setting": "İNGİLİZCE. Mekân, zaman, ışık koşulu.",
    "mood": "İNGİLİZCE. Duygu ve renk hissi.",
    "composition": "İNGİLİZCE. Kadraj ve bakış açısı (ör. close-up, wide shot, overhead, eye-level)."
  },
  "imageAlt": "Görsel alt metni (${localeName(locale)}, görseli betimlesin, odak kelime doğal geçsin, en fazla ${CONTENT.imageAltMax} karakter)",
  "imageCaption": "Kısa görsel açıklaması"
}

slug alanı mutlaka ASCII küçük harf ve tire olmalı (ç>c, ğ>g, ı>i, ö>o, ş>s, ü>u).
imageBrief alanlarının dördü de İngilizce olmalı; görselde yazı/metin olmasını isteme.`;
}

/* ----------------------------------------------------------------- ceviri */

export function translatePrompt(
  site: Site,
  sourceLocale: string,
  targetLocale: string,
  title: string,
  contentHtml: string,
): string {
  const sektor = site.sector?.trim();
  return `Aşağıdaki blog yazısını ${localeName(sourceLocale)} dilinden ${localeName(targetLocale)} diline çevir.
${sektor ? `\nSEKTÖR: ${sektor}. Bu alanın hedef dildeki YERLEŞİK, TEKNİK terimlerini kullan.` : ''}
${site.brandVoice ? `MARKA TONU: ${site.brandVoice}` : ''}
${site.audience ? `HEDEF KİTLE: ${site.audience}` : ''}

Bu bir birebir çeviri değil, HEDEF PAZARA UYARLAMA (transcreation) olacak:
- HTML yapısını birebir koru (aynı etiketler, aynı sıra, aynı başlık sayısı).
- SEKTÖREL/TEKNİK terimleri hedef dilde o sektörün gerçekte kullandığı karşılıkla ver;
  düz sözlük çevirisi yapma. Örneğin fintek/ödeme sektöründe "POS", "chargeback",
  "sanal POS", "taksitlendirme" gibi terimlerin hedef dildeki yerleşik kullanımını seç.
- Deyimleri, örnekleri, para birimlerini ve ölçü birimlerini hedef pazara uyarla.
- ${localeName(targetLocale)} konuşan bir okuyucunun arayacağı anahtar kelimeleri kullan;
  kelime kelime çeviri yapma.
- Başlıkları o dilde doğal ve SEO uyumlu yaz.
- Marka adlarını, ürün adlarını ve özel isimleri çevirme.
- Kaynak metindeki uzunluğu koru; kısaltma veya özetleme yapma.
- Hedef dil sağdan sola yazılıyorsa (Arapça) metni o dilin doğal akışında yaz.
${site.bannedWords.length ? `- Şu kelimeleri kullanma: ${site.bannedWords.join(', ')}` : ''}

BAŞLIK: ${title}

İÇERİK:
${contentHtml}

Şu JSON şemasında yanıt ver:
{
  "title": "hedef dilde başlık",
  "contentHtml": "hedef dilde gövde HTML'i (aynı yapı)"
}`;
}

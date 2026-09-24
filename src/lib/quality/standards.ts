/**
 * TEK KAYNAK: icerik ve gorsel kalite standartlari.
 *
 * Ayni degerler uc yerde kullanilir:
 *   1. Prompt uretimi  (modele ne istedigimizi soylerken)
 *   2. Otomatik denetim (uretileni olcerken)
 *   3. Duzeltme dongusu (neyi duzeltecegini soylerken)
 *
 * Boylece "prompt bir sey der, denetim baska sey olcer" durumu olusmaz.
 */

export const CONTENT = {
  /** Meta baslik karakter araligi (Google ~600px keser) */
  metaTitle: { min: 45, ideal: 55, max: 60, hardMax: 65 },
  /** Meta aciklama karakter araligi */
  metaDescription: { min: 130, ideal: 150, max: 158, hardMax: 168 },
  /** Slug kelime sayisi */
  slug: { maxWords: 6, hardMaxWords: 8 },

  /** Odak kelime yogunlugu (yuzde) */
  density: { min: 0.5, ideal: 1.2, max: 2.5, hardMax: 3.2 },
  /** Odak kelimenin gecmesi gereken ilk kelime penceresi */
  keywordIntroWindow: 100,

  /** Ana bolum (H2) sayisi */
  h2: { min: 4, ideal: 6, max: 10 },
  /** Bir H2 altindaki en fazla H3 */
  h3PerH2Max: 5,
  /** Bir bolum en az kac kelime olmali (ince bolum tespiti) */
  sectionMinWords: 80,

  /** Paragraf uzunlugu (kelime) */
  paragraphMaxWords: 110,
  /** Cumle uzunlugu (kelime) */
  sentenceMaxWords: 34,
  sentenceAvgMaxWords: 22,

  /** Girisin okuyucunun sorusunu cevaplamasi gereken kelime siniri */
  introAnswerWords: 60,

  /** En az kac liste blogu (ul/ol) */
  minLists: 1,
  /** SSS bolumunde en az soru */
  minFaq: 3,
  /** Ic link onerisi sayisi */
  internalLinks: { min: 2, max: 6 },

  /** Gorsel alt metni */
  imageAltMax: 125,

  /** Okunabilirlik alt siniri (Atesman / Flesch 0-100) */
  readabilityMin: 45,
  readabilityGood: 60,

  /** Ayni H2 basliginin tekrari yasak */
  allowDuplicateHeadings: false,
} as const;

export const IMAGE = {
  /** Kaydedilen gorselin hedef genisligi */
  targetWidth: 1600,
  /** Bunun altindaki uretim reddedilir */
  minWidth: 1024,
  /** WebP kalite */
  webpQuality: 82,
  /** Uzerine cikilmamasi gereken dosya boyutu */
  maxBytes: 450 * 1024,
  /** Kabul edilen en dusuk en-boy sapmasi (istenen orana gore) */
  aspectTolerance: 0.06,
} as const;

/** Modelin asla uretmemesi gereken gorsel ozellikleri */
export const IMAGE_NEGATIVE = [
  'no text',
  'no letters',
  'no words',
  'no captions',
  'no watermark',
  'no logo',
  'no signature',
  'no borders',
  'no collage',
  'no distorted hands',
  'no extra fingers',
  'no deformed faces',
  'no cluttered composition',
  'not oversaturated',
  'no stock-photo cliches',
].join(', ');

/** Her gorselde bulunmasi istenen teknik nitelikler */
export const IMAGE_QUALITY = [
  'editorial photography',
  'natural believable lighting',
  'shallow depth of field',
  'sharp focus on the subject',
  'realistic materials and textures',
  'balanced composition with clear negative space',
  'muted, cohesive color grading',
  'high detail, no visual noise',
].join(', ');

/* ------------------------------------------------------------------ prompt */

/**
 * Standartlari prompt'a gomulecek metne cevirir.
 * generate/revise adimlarinin ikisi de bunu kullanir.
 */
export function contentRulesBlock(opts: {
  wordMin: number;
  wordMax: number;
  focusKeyword?: string;
}): string {
  const c = CONTENT;
  return [
    'KALITE STANDARTLARI (bunlar otomatik olarak ölçülecek):',
    `- Uzunluk: ${opts.wordMin}-${opts.wordMax} kelime. Alt sınırın altına düşme.`,
    `- ${c.h2.min}-${c.h2.max} adet H2 bölümü. Her bölüm en az ${c.sectionMinWords} kelime;`,
    '  tek cümlelik bölüm yazma. Aynı başlığı iki kez kullanma.',
    `- Paragraflar en fazla ${c.paragraphMaxWords} kelime. Cümleler en fazla ${c.sentenceMaxWords}`,
    `  kelime, ortalama ${c.sentenceAvgMaxWords} kelimeyi aşmasın.`,
    `- İlk ${c.introAnswerWords} kelime içinde okuyucunun sorusunu net biçimde cevapla`,
    '  (öne çıkan snippet hedefi). Giriş cümlesi kurmadan doğrudan konuya gir.',
    opts.focusKeyword
      ? `- Odak kelime "${opts.focusKeyword}" ilk ${c.keywordIntroWindow} kelimede bir kez geçsin;` +
        ` metin genelinde yoğunluk %${c.density.min}-%${c.density.max} arasında kalsın.` +
        ' Zorlama tekrar yapma.'
      : `- Odak kelime yoğunluğu %${c.density.min}-%${c.density.max} arasında kalsın.`,
    `- En az ${c.minLists} madde listesi. Karşılaştırma varsa tablo kullan.`,
    `- Sonda "Sık Sorulan Sorular" H2 bölümü, altında en az ${c.minFaq} soru (H3) ve`,
    '  her sorunun altında en az 2 cümlelik gerçek bir cevap (P).',
    `- Okunabilirlik: kısa cümle, sade dil. Hedef okunabilirlik puanı ${c.readabilityGood}+.`,
    '- Uydurma istatistik, sahte kaynak, sahte tarih yok. Emin değilsen genel ifade kullan.',
  ].join('\n');
}

export function seoRulesBlock(): string {
  const c = CONTENT;
  return [
    'SEO ALAN KURALLARI:',
    `- metaTitle: ${c.metaTitle.min}-${c.metaTitle.max} karakter, odak kelime başta.`,
    `- metaDescription: ${c.metaDescription.min}-${c.metaDescription.max} karakter,`,
    '  odak kelime geçsin, somut bir fayda vaat etsin, tıklamaya davet etsin.',
    `- slug: ASCII küçük harf ve tire, en fazla ${c.slug.maxWords} kelime (ç>c, ğ>g, ı>i, ö>o, ş>s, ü>u).`,
    `- imageAlt: en fazla ${c.imageAltMax} karakter, görseli betimlesin, odak kelime doğal geçsin.`,
    `- internalLinkSuggestions: ${c.internalLinks.min}-${c.internalLinks.max} adet.`,
  ].join('\n');
}

/** Yasakli kaliplar - tum metin adimlarinda ortak */
export const BANNED_PATTERNS = [
  'Günümüzde',
  'Dijital çağda',
  'Teknolojinin gelişmesiyle',
  'Sonuç olarak diyebiliriz ki',
  'Bu makalede ele alacağız',
  'Bu yazımızda',
  'dalmak',
  'derinlemesine dalış',
  'yolculuğa çıkmak',
  'kilit rol oynamak',
  'olmazsa olmaz',
  'adeta',
  'büyük önem arz etmektedir',
  'hayatımızın vazgeçilmez',
  'peki ya',
  'işte tam bu noktada',
];

export function styleRulesBlock(bannedWords: string[] = []): string {
  return [
    'ÜSLUP KURALLARI:',
    `- Şu kalıpları kullanma: ${BANNED_PATTERNS.join(', ')}.`,
    '- Em dash (—) kullanma. Emoji kullanma. Ünlem işaretini abartma.',
    '- Sıfat yığma. "inanılmaz", "muhteşem", "devrim niteliğinde" gibi şişirme sözcüklerden kaçın.',
    '- Okuyucuya doğrudan hitap et. Edilgen çatıyı azalt.',
    '- Her bölüm okuyucuya yeni bir bilgi versin; önceki bölümü başka kelimelerle tekrarlama.',
    bannedWords.length ? `- Bu siteye özel yasaklı kelimeler: ${bannedWords.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

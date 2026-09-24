import * as cheerio from 'cheerio';
import { readability, type ReadabilityResult } from './readability';
import { BANNED_PATTERNS, CONTENT } from './standards';

export type IssueLevel = 'error' | 'warn' | 'ok';

export type QualityArea = 'meta' | 'yapı' | 'anahtar kelime' | 'okunabilirlik' | 'zenginlik';

export type QualityIssue = {
  level: IssueLevel;
  area: QualityArea;
  code: string;
  label: string;
  detail: string;
  /**
   * Otonom duzeltme turunda modele verilecek somut talimat.
   * Sadece error/warn seviyesindeki bulgular icin dolu olur.
   */
  fix?: string;
};

export type AreaScore = { area: QualityArea; score: number; max: number };

export type SeoReport = {
  score: number;
  wordCount: number;
  readingMinutes: number;
  keywordDensity: number;
  readability: ReadabilityResult;
  areas: AreaScore[];
  issues: QualityIssue[];
  /** Otonom dongude modele verilecek, oncelik sirali duzeltme listesi */
  fixList: string[];
};

export type AnalyzeInput = {
  contentHtml: string;
  title: string;
  metaTitle?: string;
  metaDescription?: string;
  slug?: string;
  focusKeyword?: string;
  imageAlt?: string;
  locale?: string;
  minWords: number;
  maxWords: number;
};

/** Alan agirliklari - toplam 100 */
const WEIGHTS: Record<QualityArea, number> = {
  meta: 25,
  yapı: 25,
  'anahtar kelime': 20,
  okunabilirlik: 20,
  zenginlik: 10,
};

export function analyzeContent(input: AnalyzeInput): SeoReport {
  const $ = cheerio.load(input.contentHtml || '', null, false);
  const locale = input.locale ?? 'tr';

  const plain = $.root().text().replace(/\s+/g, ' ').trim();
  const words = plain ? plain.split(' ').filter(Boolean) : [];
  const wordCount = words.length;
  const kw = (input.focusKeyword ?? '').trim().toLowerCase();
  const read = readability(plain, locale);

  const issues: QualityIssue[] = [];
  /** alan bazli ceza havuzu */
  const penalty: Record<QualityArea, number> = {
    meta: 0,
    yapı: 0,
    'anahtar kelime': 0,
    okunabilirlik: 0,
    zenginlik: 0,
  };

  const add = (
    level: IssueLevel,
    area: QualityArea,
    code: string,
    label: string,
    detail: string,
    cost = 0,
    fix?: string,
  ) => {
    issues.push({ level, area, code, label, detail, fix });
    if (level !== 'ok') penalty[area] += cost;
  };

  /* ---------------------------------------------------------------- meta */

  const mt = (input.metaTitle ?? '').trim();
  if (!mt) {
    add('error', 'meta', 'metaTitle', 'Meta başlık yok', 'SEO başlığı boş.', 10,
      'metaTitle alanını doldur: 45-60 karakter, odak kelime başta.');
  } else if (mt.length > CONTENT.metaTitle.hardMax) {
    add('error', 'meta', 'metaTitle', 'Meta başlık çok uzun',
      `${mt.length} karakter, arama sonucunda kesilir (üst sınır ${CONTENT.metaTitle.hardMax}).`, 7,
      `metaTitle'ı ${CONTENT.metaTitle.max} karakteri geçmeyecek şekilde kısalt, anlamı koru.`);
  } else if (mt.length < CONTENT.metaTitle.min || mt.length > CONTENT.metaTitle.max) {
    add('warn', 'meta', 'metaTitle', 'Meta başlık uzunluğu ideal değil',
      `${mt.length} karakter (ideal ${CONTENT.metaTitle.min}-${CONTENT.metaTitle.max}).`, 3,
      `metaTitle'ı ${CONTENT.metaTitle.min}-${CONTENT.metaTitle.max} karaktere getir.`);
  } else {
    add('ok', 'meta', 'metaTitle', 'Meta başlık uygun', `${mt.length} karakter.`);
  }

  if (mt && kw && !mt.toLowerCase().includes(kw)) {
    add('warn', 'meta', 'metaTitleKw', 'Meta başlıkta odak kelime yok',
      `"${input.focusKeyword}" geçmiyor.`, 4,
      `metaTitle içine "${input.focusKeyword}" ifadesini başa yakın yerleştir.`);
  }

  const md = (input.metaDescription ?? '').trim();
  if (!md) {
    add('error', 'meta', 'metaDesc', 'Meta açıklama yok', 'Arama sonucunda açıklama boş kalır.', 8,
      'metaDescription yaz: 130-158 karakter, odak kelime geçsin, somut fayda vaat etsin.');
  } else if (md.length > CONTENT.metaDescription.hardMax) {
    add('error', 'meta', 'metaDesc', 'Meta açıklama çok uzun',
      `${md.length} karakter, kesilir.`, 5,
      `metaDescription'ı ${CONTENT.metaDescription.max} karaktere indir.`);
  } else if (
    md.length < CONTENT.metaDescription.min ||
    md.length > CONTENT.metaDescription.max
  ) {
    add('warn', 'meta', 'metaDesc', 'Meta açıklama uzunluğu ideal değil',
      `${md.length} karakter (ideal ${CONTENT.metaDescription.min}-${CONTENT.metaDescription.max}).`, 3,
      `metaDescription'ı ${CONTENT.metaDescription.min}-${CONTENT.metaDescription.max} karaktere getir.`);
  } else {
    add('ok', 'meta', 'metaDesc', 'Meta açıklama uygun', `${md.length} karakter.`);
  }

  if (md && kw && !md.toLowerCase().includes(kw)) {
    add('warn', 'meta', 'metaDescKw', 'Meta açıklamada odak kelime yok',
      `"${input.focusKeyword}" geçmiyor.`, 3,
      `metaDescription içine "${input.focusKeyword}" ifadesini doğal biçimde ekle.`);
  }

  const slug = (input.slug ?? '').trim();
  if (!slug) {
    add('error', 'meta', 'slug', 'Slug yok', 'URL adresi üretilmemiş.', 5,
      'Başlıktan ASCII küçük harf ve tireli bir slug üret.');
  } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    add('error', 'meta', 'slug', 'Slug geçersiz',
      `"${slug}" yalnızca ASCII küçük harf, rakam ve tire içermeli.`, 5,
      'Slug\'daki Türkçe karakterleri ASCII karşılığına çevir (ç>c, ğ>g, ı>i, ö>o, ş>s, ü>u).');
  } else if (slug.split('-').length > CONTENT.slug.hardMaxWords) {
    add('warn', 'meta', 'slug', 'Slug uzun',
      `${slug.split('-').length} kelime (ideal ≤${CONTENT.slug.maxWords}).`, 2,
      `Slug'ı en fazla ${CONTENT.slug.maxWords} kelimeye indir, dolgu kelimeleri at.`);
  } else {
    add('ok', 'meta', 'slug', 'Slug uygun', slug);
  }

  /* ---------------------------------------------------------------- yapı */

  if (wordCount < input.minWords * 0.75) {
    const eksik = input.minWords - wordCount;
    add('error', 'yapı', 'length', 'Metin çok kısa',
      `${wordCount} kelime, hedef en az ${input.minWords}.`, 12,
      `Metni en az ${eksik} kelime uzat. Yeni bölüm ekleyerek değil, mevcut ince bölümleri` +
        ' somut örnek, adım listesi, sık yapılan hata ve karşılaştırma ile derinleştirerek yap.');
  } else if (wordCount < input.minWords) {
    add('warn', 'yapı', 'length', 'Metin hedefin altında',
      `${wordCount} / ${input.minWords} kelime.`, 5,
      `Metni ${input.minWords - wordCount} kelime daha uzat; en zayıf bölümleri derinleştir.`);
  } else if (wordCount > input.maxWords * 1.35) {
    add('warn', 'yapı', 'length', 'Metin gereğinden uzun',
      `${wordCount} kelime, hedef en fazla ${input.maxWords}.`, 3,
      'Tekrar eden cümleleri ve dolgu paragrafları çıkararak metni kısalt.');
  } else {
    add('ok', 'yapı', 'length', 'Uzunluk uygun', `${wordCount} kelime.`);
  }

  const h1 = $('h1').length;
  if (h1 > 0) {
    add('error', 'yapı', 'h1', 'Gövdede H1 var',
      `${h1} adet H1 bulundu; H1 yazı başlığıdır, gövdede olmamalı.`, 6,
      'Gövdedeki H1 etiketlerini H2 yap.');
  }

  const h2Nodes = $('h2').toArray();
  const h2 = h2Nodes.length;
  if (h2 < CONTENT.h2.min) {
    add('error', 'yapı', 'h2', 'Yetersiz bölüm',
      `${h2} adet H2 (en az ${CONTENT.h2.min} olmalı).`, 7,
      `Metni ${CONTENT.h2.ideal} bölüme ayır; her bölüm ayrı bir alt soruyu cevaplasın.`);
  } else if (h2 > CONTENT.h2.max) {
    add('warn', 'yapı', 'h2', 'Çok fazla bölüm',
      `${h2} adet H2 (ideal ${CONTENT.h2.min}-${CONTENT.h2.max}).`, 2,
      'Birbirine yakın bölümleri birleştir.');
  } else {
    add('ok', 'yapı', 'h2', 'Başlık yapısı uygun', `${h2} adet H2.`);
  }

  // yinelenen basliklar
  const headingTexts = $('h2, h3')
    .toArray()
    .map((el) => $(el).text().trim().toLocaleLowerCase('tr-TR'));
  const dupes = headingTexts.filter((t, i) => t && headingTexts.indexOf(t) !== i);
  if (dupes.length && !CONTENT.allowDuplicateHeadings) {
    add('warn', 'yapı', 'dupHeading', 'Yinelenen başlık',
      `${[...new Set(dupes)].join(', ')}`, 3,
      'Aynı metne sahip başlıkları farklılaştır veya bölümleri birleştir.');
  }

  // ince bolumler
  const thin = thinSections($);
  if (thin.length) {
    add('warn', 'yapı', 'thinSection', 'İnce bölüm',
      `${thin.length} bölüm ${CONTENT.sectionMinWords} kelimenin altında: ${thin
        .slice(0, 3)
        .map((t) => `"${t.title}" (${t.words} kelime)`)
        .join(', ')}`,
      Math.min(8, thin.length * 3),
      `Şu bölümleri en az ${CONTENT.sectionMinWords} kelimeye çıkar: ${thin
        .map((t) => `"${t.title}"`)
        .join(', ')}. Somut örnek, sayısal veri veya adım listesi ekle.`);
  }

  // SSS
  const faq = faqSection($);
  if (!faq.found) {
    add('warn', 'yapı', 'faq', 'SSS bölümü yok',
      'SSS bölümü öne çıkan sonuç ve FAQPage şeması şansı sağlar.', 5,
      `Sonda "Sık Sorulan Sorular" H2 bölümü ekle; en az ${CONTENT.minFaq} soruyu H3,` +
        ' cevaplarını P olarak yaz.');
  } else if (faq.answered < CONTENT.minFaq) {
    add('warn', 'yapı', 'faq', 'SSS eksik',
      `${faq.answered} cevaplı soru (en az ${CONTENT.minFaq} olmalı).`, 3,
      `SSS bölümüne ${CONTENT.minFaq - faq.answered} soru daha ekle, her birine en az 2 cümle cevap yaz.`);
  } else {
    add('ok', 'yapı', 'faq', 'SSS bölümü uygun', `${faq.answered} soru.`);
  }

  /* -------------------------------------------------------- anahtar kelime */

  let density = 0;
  if (!kw) {
    add('error', 'anahtar kelime', 'kwMissing', 'Odak kelime tanımsız',
      'Yazı için odak anahtar kelime belirlenmemiş.', 10,
      'Konuya uygun tek bir odak anahtar kelime belirle.');
  } else {
    const matches = plain.toLowerCase().split(kw).length - 1;
    density = wordCount ? (matches * kw.split(' ').length * 100) / wordCount : 0;

    if (matches === 0) {
      add('error', 'anahtar kelime', 'kwAbsent', 'Odak kelime metinde yok',
        `"${input.focusKeyword}" hiç geçmiyor.`, 12,
        `"${input.focusKeyword}" ifadesini metne doğal biçimde yerleştir; yoğunluk %${CONTENT.density.min}-%${CONTENT.density.max} olsun.`);
    } else if (density > CONTENT.density.hardMax) {
      add('error', 'anahtar kelime', 'kwStuffing', 'Anahtar kelime doldurma',
        `%${density.toFixed(1)} (üst sınır %${CONTENT.density.hardMax}).`, 8,
        `"${input.focusKeyword}" tekrarlarını azalt, bir kısmını eşanlamlı ifadeyle değiştir.`);
    } else if (density > CONTENT.density.max) {
      add('warn', 'anahtar kelime', 'kwHigh', 'Anahtar kelime yoğunluğu yüksek',
        `%${density.toFixed(1)} (ideal %${CONTENT.density.min}-%${CONTENT.density.max}).`, 4,
        `"${input.focusKeyword}" tekrarlarını biraz azalt.`);
    } else if (density < CONTENT.density.min) {
      add('warn', 'anahtar kelime', 'kwLow', 'Odak kelime az geçiyor',
        `%${density.toFixed(1)} (ideal %${CONTENT.density.min}-%${CONTENT.density.max}).`, 4,
        `"${input.focusKeyword}" ifadesini bölüm başlıklarında ve gövdede birkaç kez daha kullan.`);
    } else {
      add('ok', 'anahtar kelime', 'kw', 'Anahtar kelime dengesi iyi', `%${density.toFixed(1)}.`);
    }

    const intro = words.slice(0, CONTENT.keywordIntroWindow).join(' ').toLowerCase();
    if (matches > 0 && !intro.includes(kw)) {
      add('warn', 'anahtar kelime', 'kwIntro', 'Girişte odak kelime yok',
        `İlk ${CONTENT.keywordIntroWindow} kelimede geçmiyor.`, 4,
        `İlk paragrafı "${input.focusKeyword}" ifadesini doğal biçimde içerecek şekilde yeniden yaz.`);
    }

    const inHeadings = headingTexts.filter((t) => t.includes(kw)).length;
    if (matches > 0 && inHeadings === 0) {
      add('warn', 'anahtar kelime', 'kwHeading', 'Başlıklarda odak kelime yok',
        'Hiçbir H2/H3 odak kelimeyi içermiyor.', 3,
        `En az bir H2 başlığına "${input.focusKeyword}" ifadesini doğal biçimde yerleştir.`);
    }
  }

  /* ------------------------------------------------------- okunabilirlik */

  if (read.score < CONTENT.readabilityMin) {
    add('error', 'okunabilirlik', 'readability', 'Metin zor okunuyor',
      `Puan ${read.score} (${read.label}), ortalama cümle ${read.wordsPerSentence} kelime.`, 9,
      'Uzun cümleleri böl, devrik ve iç içe yan cümleleri sadeleştir, terimleri açıkla.');
  } else if (read.score < CONTENT.readabilityGood) {
    add('warn', 'okunabilirlik', 'readability', 'Okunabilirlik ortalama',
      `Puan ${read.score} (${read.label}).`, 4,
      'En uzun cümleleri ikiye böl, gereksiz sıfatları at.');
  } else {
    add('ok', 'okunabilirlik', 'readability', 'Okunabilirlik iyi',
      `Puan ${read.score} (${read.label}).`);
  }

  if (read.longSentences > 0) {
    add(
      read.longSentences > 5 ? 'warn' : 'ok',
      'okunabilirlik',
      'longSentence',
      read.longSentences > 5 ? 'Uzun cümleler' : 'Cümle uzunlukları makul',
      `${read.longSentences} cümle ${CONTENT.sentenceMaxWords} kelimeyi aşıyor.`,
      read.longSentences > 5 ? 4 : 0,
      read.longSentences > 5
        ? `${CONTENT.sentenceMaxWords} kelimeyi aşan cümleleri böl.`
        : undefined,
    );
  }

  const longParas = $('p')
    .toArray()
    .filter((el) => $(el).text().split(/\s+/).filter(Boolean).length > CONTENT.paragraphMaxWords);
  if (longParas.length) {
    add('warn', 'okunabilirlik', 'paragraph', 'Uzun paragraflar',
      `${longParas.length} paragraf ${CONTENT.paragraphMaxWords} kelimeyi aşıyor.`, 4,
      `${CONTENT.paragraphMaxWords} kelimeyi aşan paragrafları 2-4 cümlelik parçalara böl.`);
  }

  // yasakli kalip taramasi
  const lowered = plain.toLocaleLowerCase('tr-TR');
  const foundBanned = BANNED_PATTERNS.filter((b) =>
    lowered.includes(b.toLocaleLowerCase('tr-TR')),
  );
  if (foundBanned.length) {
    add('warn', 'okunabilirlik', 'cliche', 'Klişe ifadeler',
      foundBanned.slice(0, 5).join(', '), Math.min(6, foundBanned.length * 2),
      `Şu klişe ifadeleri kaldır ve yerine somut anlatım koy: ${foundBanned.join(', ')}.`);
  }

  /* ---------------------------------------------------------- zenginlik */

  const listCount = $('ul, ol').length;
  if (listCount < CONTENT.minLists) {
    add('warn', 'zenginlik', 'list', 'Liste yok',
      'Taranabilirlik için en az bir madde listesi gerekir.', 3,
      'Uygun bir bölüme madde listesi ekle (adımlar, kontrol listesi veya kriterler).');
  } else {
    add('ok', 'zenginlik', 'list', 'Liste var', `${listCount} liste.`);
  }

  if ($('table').length === 0 && wordCount > 1200) {
    add('warn', 'zenginlik', 'table', 'Tablo yok',
      'Uzun yazılarda karşılaştırma tablosu tutunmayı artırır.', 2,
      'Karşılaştırılabilir bir konu varsa küçük bir tablo ekle.');
  }

  const alt = (input.imageAlt ?? '').trim();
  if (!alt) {
    add('warn', 'zenginlik', 'imageAlt', 'Görsel alt metni yok',
      'Öne çıkan görsel için alt metin üretilmemiş.', 3,
      `Görseli betimleyen, en fazla ${CONTENT.imageAltMax} karakterlik bir alt metin yaz.`);
  } else if (alt.length > CONTENT.imageAltMax) {
    add('warn', 'zenginlik', 'imageAlt', 'Alt metin uzun',
      `${alt.length} karakter (ideal ≤${CONTENT.imageAltMax}).`, 2,
      `Alt metni ${CONTENT.imageAltMax} karakterin altına indir.`);
  } else {
    add('ok', 'zenginlik', 'imageAlt', 'Alt metin uygun', `${alt.length} karakter.`);
  }

  // Gercek ic link sayimi (oneri degil, govdedeki <a> etiketi)
  const links = $('a[href]').length;
  if (links === 0) {
    add('warn', 'zenginlik', 'internalLink', 'İç link yok',
      `Gövdede hiç bağlantı yok (ideal ${CONTENT.internalLinks.min}-${CONTENT.internalLinks.max}).`, 3,
      'Aynı sitedeki ilgili yazılara doğal bağlı metinlerle iç link ver.');
  } else if (links < CONTENT.internalLinks.min) {
    add('warn', 'zenginlik', 'internalLink', 'Az iç link',
      `${links} bağlantı (ideal ${CONTENT.internalLinks.min}-${CONTENT.internalLinks.max}).`, 2);
  } else if (links > CONTENT.internalLinks.max) {
    add('warn', 'zenginlik', 'internalLink', 'Fazla iç link',
      `${links} bağlantı (ideal en fazla ${CONTENT.internalLinks.max}).`, 2);
  } else {
    add('ok', 'zenginlik', 'internalLink', 'İç link dengesi iyi', `${links} bağlantı.`);
  }

  /* ------------------------------------------------------------- puanlama */

  const areas: AreaScore[] = (Object.keys(WEIGHTS) as QualityArea[]).map((area) => {
    const max = WEIGHTS[area];
    const lost = Math.min(max, penalty[area]);
    return { area, score: Math.round(max - lost), max };
  });

  const score = Math.max(0, Math.min(100, areas.reduce((sum, a) => sum + a.score, 0)));

  const fixList = issues
    .filter((i) => i.level !== 'ok' && i.fix)
    .sort((a, b) => (a.level === 'error' ? -1 : 1) - (b.level === 'error' ? -1 : 1))
    .map((i) => i.fix as string);

  return {
    score,
    wordCount,
    readingMinutes: Math.max(1, Math.round(wordCount / 200)),
    keywordDensity: Number(density.toFixed(2)),
    readability: read,
    areas,
    issues,
    fixList,
  };
}

/* ------------------------------------------------------------------ yardim */

function thinSections($: cheerio.CheerioAPI): { title: string; words: number }[] {
  const out: { title: string; words: number }[] = [];

  for (const el of $('h2').toArray()) {
    const $h = $(el);
    const title = $h.text().trim();
    if (/sık sorulan|sik sorulan|faq|frequently asked/i.test(title)) continue;

    let node = $h.next();
    let words = 0;
    while (node.length && node.get(0)?.tagName?.toLowerCase() !== 'h2') {
      words += node.text().split(/\s+/).filter(Boolean).length;
      node = node.next();
    }
    if (words < CONTENT.sectionMinWords) out.push({ title, words });
  }
  return out;
}

function faqSection($: cheerio.CheerioAPI): { found: boolean; answered: number } {
  const heading = $('h2')
    .toArray()
    .find((el) =>
      /sık sorulan|sik sorulan|faq|frequently asked|häufig|preguntas frecuentes|questions fréquentes/i.test(
        $(el).text(),
      ),
    );
  if (!heading) return { found: false, answered: 0 };

  let node = $(heading).next();
  let answered = 0;
  let currentHasQuestion = false;

  while (node.length && node.get(0)?.tagName?.toLowerCase() !== 'h2') {
    const tag = node.get(0)?.tagName?.toLowerCase();
    if (tag === 'h3' || tag === 'h4') {
      currentHasQuestion = true;
    } else if (currentHasQuestion && (tag === 'p' || tag === 'ul' || tag === 'ol')) {
      if (node.text().trim().length > 40) {
        answered++;
        currentHasQuestion = false;
      }
    }
    node = node.next();
  }
  return { found: true, answered };
}

export function hasBlockingIssues(report: SeoReport): boolean {
  return report.issues.some((i) => i.level === 'error');
}

export function errorSummary(report: SeoReport): string {
  return report.issues
    .filter((i) => i.level === 'error')
    .map((i) => `${i.label} — ${i.detail}`)
    .join(' | ');
}

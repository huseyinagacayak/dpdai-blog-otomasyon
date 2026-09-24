/**
 * Baslik / anahtar kelime benzerligi.
 *
 * Turkce sondan eklemeli bir dil oldugu icin tam kelime esitligi zayif kalir
 * ("kedi maması" ve "kedi mamasında" farkli goruunur). Bu yuzden kelimeler
 * govde yaklasimiyla kisaltilip karsilastirilir. Kusursuz bir kok bulucu degil,
 * ama cakisma uyarisi icin fazlasiyla yeterli.
 */

const STOPWORDS = new Set([
  've', 'ile', 'için', 'icin', 'nasıl', 'nasil', 'nedir', 'ne', 'mi', 'mı', 'mu', 'mü',
  'bir', 'bu', 'şu', 'su', 'o', 'da', 'de', 'ki', 'en', 'çok', 'cok', 'daha', 'gibi',
  'olarak', 'kadar', 'sonra', 'önce', 'once', 'her', 'hangi', 'kaç', 'kac', 'var', 'yok',
  'the', 'and', 'for', 'with', 'how', 'what', 'best', 'guide',
]);

const TR_MAP: Record<string, string> = {
  ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u',
};

export function normalize(text: string): string {
  return text
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıİöşüâîû]/g, (c) => TR_MAP[c] ?? c)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Kelimeleri agirlikli olarak dondurur.
 *
 * Iki ince ayar var:
 *  1. Baslikta ILK anlamli kelime konuyu belirler ("kedi diş bakımı" ile
 *     "köpek diş bakımı" ayni sey degildir), bu yuzden iki kat agirlik alir.
 *  2. Turkce ek aldiginda kelime uzar ("diş" -> "dişleri"), bu yuzden
 *     esitlik yerine ON EK karsilastirmasi yapilir.
 */
export function weightedTokens(text: string): { word: string; weight: number }[] {
  const words = normalize(text)
    .split(' ')
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  return words.map((word, i) => ({ word, weight: i === 0 ? 2 : 1 }));
}

/** Biri digerinin on eki mi (en az 3 harf ortak govde) */
function related(a: string, b: string): boolean {
  if (a === b) return true;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  return short.length >= 3 && long.startsWith(short);
}

/** Geriye donuk uyum: agirliksiz kelime kumesi */
export function tokens(text: string): Set<string> {
  return new Set(weightedTokens(text).map((t) => t.word));
}

/** Agirlikli Dice katsayisi: 0 (alakasiz) - 1 (ayni) */
export function similarity(a: string, b: string): number {
  const A = weightedTokens(a);
  const B = weightedTokens(b);
  if (A.length === 0 || B.length === 0) return 0;

  const totalA = A.reduce((s, t) => s + t.weight, 0);
  const totalB = B.reduce((s, t) => s + t.weight, 0);

  const usedB = new Set<number>();
  let shared = 0;

  for (const ta of A) {
    const j = B.findIndex((tb, i) => !usedB.has(i) && related(ta.word, tb.word));
    if (j !== -1) {
      usedB.add(j);
      // Eslesen ciftin dusuk agirligini say: biri baslangicta digeri ortadaysa
      // bu tam bir konu ortakligi degildir
      shared += Math.min(ta.weight, B[j].weight);
    }
  }

  return (2 * shared) / (totalA + totalB);
}

/** Iki anahtar kelime pratikte ayni hedefi mi vuruyor */
export function sameKeyword(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  return similarity(a, b) >= 0.85;
}

/* ------------------------------------------------------------------ esikler */

export const CONFLICT = {
  /** Bu ve ustu: kesin cakisma */
  high: 0.72,
  /** Bu ve ustu: benzer, gozden gecir */
  medium: 0.52,
} as const;

export type ConflictKind = 'keyword' | 'title';

export type Conflict = {
  kind: ConflictKind;
  level: 'high' | 'medium';
  score: number;
  /** Cakisilan seyin basligi */
  title: string;
  /** Nerede: havuzdaki baska konu, uretilmis yazi ya da sitede zaten yayinda olan sayfa */
  source: 'topic' | 'article' | 'site';
  topicId?: string;
  articleId?: string;
  url?: string;
};

export type ConflictTarget = {
  title: string;
  keyword?: string | null;
  source: Conflict['source'];
  topicId?: string;
  articleId?: string;
  url?: string;
};

/**
 * Bir konuyu mevcut icerikle karsilastirir.
 * Ayni odak kelime = yuksek; baslik benzerligi esigi asiyorsa yuksek/orta.
 */
export function findConflicts(
  subject: { title: string; keyword?: string | null },
  targets: ConflictTarget[],
): Conflict[] {
  const out: Conflict[] = [];

  for (const t of targets) {
    if (subject.keyword && sameKeyword(subject.keyword, t.keyword)) {
      out.push({
        kind: 'keyword',
        level: 'high',
        score: 1,
        title: t.title,
        source: t.source,
        topicId: t.topicId,
        articleId: t.articleId,
        url: t.url,
      });
      continue;
    }

    const score = similarity(subject.title, t.title);
    if (score >= CONFLICT.medium) {
      out.push({
        kind: 'title',
        level: score >= CONFLICT.high ? 'high' : 'medium',
        score: Number(score.toFixed(2)),
        title: t.title,
        source: t.source,
        topicId: t.topicId,
        articleId: t.articleId,
        url: t.url,
      });
    }
  }

  return out
    .sort((a, b) => (b.level === 'high' ? 1 : 0) - (a.level === 'high' ? 1 : 0) || b.score - a.score)
    .slice(0, 5);
}

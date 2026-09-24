/**
 * Okunabilirlik olcumu.
 *
 * Turkce icin Atesman formulu kullanilir (Turkce'ye uyarlanmis Flesch):
 *   OG = 198.825 - 40.175 x (hece/kelime) - 2.610 x (kelime/cumle)
 *
 * Diger diller icin klasik Flesch Reading Ease'in hece yaklasimiyla
 * hesaplanan bir varyanti kullanilir. Ikisi de 0-100 arasidir; buyuk = kolay.
 */

const TR_VOWELS = 'aeıioöuüâîû';
const LATIN_VOWELS = 'aeiouyáéíóúàèìòùâêîôûäëïöüåæø';

function countSyllables(word: string, locale: string): number {
  const w = word.toLocaleLowerCase(locale === 'tr' ? 'tr-TR' : 'en-US');

  if (locale === 'tr' || locale === 'az') {
    // Turkcede hece sayisi = unlu sayisi
    let n = 0;
    for (const ch of w) if (TR_VOWELS.includes(ch)) n++;
    return n;
  }

  // Diger diller: ardisik unluleri tek hece say
  let n = 0;
  let prevVowel = false;
  for (const ch of w) {
    const isVowel = LATIN_VOWELS.includes(ch);
    if (isVowel && !prevVowel) n++;
    prevVowel = isVowel;
  }
  if (w.endsWith('e') && n > 1) n--; // sessiz e
  return Math.max(1, n);
}

export type ReadabilityResult = {
  /** 0-100, buyuk = kolay okunur */
  score: number;
  words: number;
  sentences: number;
  syllablesPerWord: number;
  wordsPerSentence: number;
  /** 34 kelimeden uzun cumle sayisi */
  longSentences: number;
  label: string;
};

export function readability(text: string, locale = 'tr'): ReadabilityResult {
  const clean = text.replace(/\s+/g, ' ').trim();

  const sentenceParts = clean
    .split(/[.!?…]+(?=\s|$)/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).filter(Boolean).length >= 2);

  const words = clean.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

  if (words.length === 0 || sentenceParts.length === 0) {
    return {
      score: 0,
      words: words.length,
      sentences: sentenceParts.length,
      syllablesPerWord: 0,
      wordsPerSentence: 0,
      longSentences: 0,
      label: 'ölçülemedi',
    };
  }

  let syllables = 0;
  for (const w of words) syllables += countSyllables(w, locale);

  const spw = syllables / words.length;
  const wps = words.length / sentenceParts.length;

  const longSentences = sentenceParts.filter(
    (s) => s.split(/\s+/).filter(Boolean).length > 34,
  ).length;

  const raw =
    locale === 'tr' || locale === 'az'
      ? 198.825 - 40.175 * spw - 2.61 * wps
      : 206.835 - 1.015 * wps - 84.6 * spw;

  const score = Math.round(Math.max(0, Math.min(100, raw)));

  return {
    score,
    words: words.length,
    sentences: sentenceParts.length,
    syllablesPerWord: Number(spw.toFixed(2)),
    wordsPerSentence: Number(wps.toFixed(1)),
    longSentences,
    label: labelFor(score),
  };
}

function labelFor(score: number): string {
  if (score >= 80) return 'çok kolay';
  if (score >= 65) return 'kolay';
  if (score >= 50) return 'orta';
  if (score >= 35) return 'zor';
  return 'çok zor';
}

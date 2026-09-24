import * as cheerio from 'cheerio';

/**
 * Baslik (H2/H3) duzeni: CUMLE DUZENI + KISALTMA duzeltmesi.
 *
 *  - Basligin ilk harfi buyuk (Turkce İ/I kuralina gore).
 *  - Bilinen kisaltmalar butun olarak buyuk yazilir (POS, SEO, KDV, PCI-DSS ...).
 *  - Gerisine dokunulmaz; model cumle duzeninde yazar, biz yalnizca garanti ederiz.
 *
 * Model bazen odak kelimeyi ("pos") kucuk yaziyor; deterministik gecis bunu
 * her seferinde ayni sekilde toparlar, prompt'a bel baglamadan.
 */

/** Butun olarak buyuk yazilacak yaygin kisaltmalar (kucuk harfle tutulur). */
const ACRONYMS = new Set([
  'pos', 'seo', 'sem', 'kdv', 'ötv', 'otv', 'pci', 'dss', 'crm', 'erp',
  'cvv', 'iban', 'ssl', 'tls', 'api', 'url', 'kvkk', 'vuk', 'sgk', 'atm',
  'nfc', 'qr', 'tl', 'usd', 'eur', 'gbp', 'gsm', 'ip', 'sms', 'otp', 'kkb',
  'bkm', 'ptt', 'kobi', 'b2b', 'b2c', '3d', '4g', '5g', 'wc', 'ai', 'seo',
]);

/** Turkce kurala gore ilk harfi buyutur (i->İ, ı->I). */
function trUpperFirst(s: string): string {
  if (!s) return s;
  const c = s[0];
  const up = c === 'i' ? 'İ' : c === 'ı' ? 'I' : c.toLocaleUpperCase('tr-TR');
  return up + s.slice(1);
}

/** Metindeki bilinen kisaltmalari (tire ile bagli parcalar dahil) buyutur. */
export function fixAcronyms(text: string): string {
  return text.replace(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu, (word) => {
    const parts = word.split('-');
    let changed = false;
    const fixed = parts.map((p) => {
      if (ACRONYMS.has(p.toLocaleLowerCase('tr-TR'))) {
        changed = true;
        return p.toLocaleUpperCase('tr-TR');
      }
      return p;
    });
    return changed ? fixed.join('-') : word;
  });
}

/** Tek bir baslik metnini duzenler (cumle duzeni + kisaltmalar). */
export function normalizeHeadingText(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim();
  if (!t) return t;
  t = fixAcronyms(t);
  if (/^\p{L}/u.test(t)) t = trUpperFirst(t);
  return t;
}

/**
 * Govde HTML'indeki tum H2/H3 basliklarini duzenler.
 * Ic etiketli (nadir) basliklarda yalnizca kisaltmalari toparlar.
 */
export function normalizeHeadings(html: string): string {
  if (!html) return html;
  const $ = cheerio.load(html, null, false);
  $('h2, h3').each((_, el) => {
    const $el = $(el);
    if ($el.children().length === 0) {
      $el.text(normalizeHeadingText($el.text()));
    } else {
      $el.html(fixAcronyms($el.html() ?? ''));
    }
  });
  return $.html().trim();
}

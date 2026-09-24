import * as cheerio from 'cheerio';

const ALLOWED = new Set([
  'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i',
  'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'br',
  'figure', 'figcaption', 'img',
]);

/**
 * Modelden gelen HTML'i temizler:
 *  - kod blogu sarmalayicilarini atar
 *  - <html>/<body>/<h1> gibi istenmeyen etiketleri kaldirir
 *  - izin verilmeyen etiketleri icerigini koruyarak acar
 *  - <a> disindaki tum ozellikleri siler (XSS ve tema bozulmasi riski)
 */
export function sanitizeArticleHtml(raw: string): string {
  let t = (raw ?? '').trim();

  if (t.startsWith('```')) {
    t = t.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  t = t.replace(/<!DOCTYPE[^>]*>/gi, '');

  const $ = cheerio.load(t, null, false);

  // H1 gövdede olmamali: H2'ye dusur
  $('h1').each((_, el) => {
    const $el = $(el);
    $el.replaceWith(`<h2>${$el.html() ?? ''}</h2>`);
  });

  $('script, style, iframe, form, input, html, head, body, meta, link, title').remove();

  $('*').each((_, el) => {
    if (el.type !== 'tag') return;
    const $el = $(el);
    const tag = el.tagName.toLowerCase();

    if (!ALLOWED.has(tag)) {
      $el.replaceWith($el.html() ?? $el.text());
      return;
    }

    const attribs = { ...el.attribs };
    for (const name of Object.keys(attribs)) {
      const keep =
        (tag === 'a' && (name === 'href' || name === 'title' || name === 'rel')) ||
        (tag === 'img' && (name === 'src' || name === 'alt' || name === 'width' || name === 'height'));
      if (!keep) $el.removeAttr(name);
    }

    if (tag === 'a') {
      const href = $el.attr('href') ?? '';
      if (/^\s*javascript:/i.test(href)) $el.removeAttr('href');
    }
  });

  // bos paragraflari temizle
  $('p').each((_, el) => {
    const $el = $(el);
    if (!$el.text().trim() && $el.children().length === 0) $el.remove();
  });

  return $.html().trim();
}

/** Metin ozeti (meta description yedegi icin). */
export function toPlainText(html: string, limit = 0): string {
  const text = cheerio.load(html || '', null, false).root().text().replace(/\s+/g, ' ').trim();
  return limit > 0 ? text.slice(0, limit) : text;
}

/** Ceviri sonrasi HTML yapisinin bozulup bozulmadigini kabaca dogrular. */
export function structureMatches(a: string, b: string): boolean {
  const count = (html: string) => {
    const $ = cheerio.load(html || '', null, false);
    return { h2: $('h2').length, h3: $('h3').length, p: $('p').length, li: $('li').length };
  };
  const x = count(a);
  const y = count(b);
  const near = (m: number, n: number) => Math.abs(m - n) <= Math.max(1, Math.round(m * 0.25));
  return near(x.h2, y.h2) && near(x.p, y.p);
}

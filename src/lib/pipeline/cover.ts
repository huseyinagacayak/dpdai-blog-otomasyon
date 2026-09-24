import sharp from 'sharp';
import { normalizeHeadingText } from './headings';

/**
 * Markali kapak gorseli olusturur.
 *
 * Fikir: AI/stok fotograflar soyut is konularinda cogu zaman alakasiz kalir.
 * Bunun yerine her yaziya TUTARLI bir kapak uretiriz: marka renkli zemin +
 * yan tarafta kaynak foto (kucuk) + uzerinde BLOG BASLIGI. Baslik gorselin
 * icinde oldugu icin gorsel her zaman konuyla %100 alakalidir.
 *
 * Tamamen sharp + SVG ile cizilir (harici servis yok). Metin Turkce
 * karakterleri dogru gosterir; Docker imajinda bir sans yazi tipi kuruludur.
 */

export type CoverOptions = {
  /** Yan panele yerlesecek kaynak foto (AI ya da stok) */
  photo: Buffer;
  title: string;
  siteName: string;
  /** Ana marka rengi (hex). Zemin bundan turetilir. */
  brand?: string;
  width?: number;
  height?: number;
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Basligi verilen genislige sigacak satirlara boler (kaba karakter olcusu). */
function wrapTitle(title: string, maxChars: number, maxLines: number): string[] {
  const words = title.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // Sigmayan kismi son satira "..." ile ekle
  if (lines.length === maxLines) {
    const used = lines.join(' ').length;
    if (used < title.length) lines[maxLines - 1] = lines[maxLines - 1].replace(/[\s.,;:]+$/, '') + '…';
  }
  return lines;
}

/** Koyu marka gradyani icin ikinci (daha koyu) tonu uretir. */
function darken(hex: string, amount = 0.55): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#0b2b3a';
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export async function composeCover(opts: CoverOptions): Promise<Buffer> {
  const W = opts.width ?? 1536;
  const H = opts.height ?? 864;
  const brand = opts.brand || process.env.COVER_BRAND || '#0e7490';
  const brandDark = darken(brand, 0.6);

  // Yerlesim: sol %58 metin paneli, sag %42 foto
  const photoW = Math.round(W * 0.42);
  const textPanelW = W - photoW;
  const pad = Math.round(W * 0.045);
  const textW = textPanelW - pad * 2;

  // Foto: sag paneli kaplayacak sekilde kirp
  const photoBuf = await sharp(opts.photo)
    .resize({ width: photoW, height: H, fit: 'cover', position: 'attention' })
    .toBuffer();

  // Baslik: ilk harf buyuk + kisaltmalar (POS/SEO...) duzeltilir; kucuk harf kapak olmasin
  const title = normalizeHeadingText(opts.title);

  // Baslik: sigacak font boyutunu sec
  let fontSize = 66;
  let lines: string[] = [];
  for (const fs of [66, 58, 52, 46, 40]) {
    const maxChars = Math.max(8, Math.floor(textW / (fs * 0.54)));
    lines = wrapTitle(title, maxChars, 5);
    const blockH = lines.length * fs * 1.2;
    if (blockH <= H * 0.6) {
      fontSize = fs;
      break;
    }
  }

  const lineH = fontSize * 1.2;
  const blockH = lines.length * lineH;
  const startY = Math.round((H - blockH) / 2) + fontSize; // dikey ortala
  const accentY = startY - fontSize - Math.round(fontSize * 0.7);

  const tspans = lines
    .map(
      (ln, i) =>
        `<text x="${pad}" y="${startY + i * lineH}" font-family="DejaVu Sans, Arial, sans-serif" ` +
        `font-size="${fontSize}" font-weight="700" fill="#ffffff">${escapeXml(ln)}</text>`,
    )
    .join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${brandDark}"/>
        <stop offset="1" stop-color="${brand}"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <rect x="${pad}" y="${accentY}" width="${Math.round(fontSize * 1.6)}" height="6" rx="3" fill="#ffffff" opacity="0.9"/>
    ${tspans}
    <text x="${pad}" y="${H - pad}" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" font-weight="700" fill="#ffffff" opacity="0.85">${escapeXml(opts.siteName)}</text>
  </svg>`;

  return sharp(Buffer.from(svg))
    .composite([{ input: photoBuf, left: textPanelW, top: 0 }])
    .webp({ quality: 86 })
    .toBuffer();
}

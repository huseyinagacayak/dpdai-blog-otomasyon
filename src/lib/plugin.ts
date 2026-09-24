import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

/**
 * WordPress kopru eklentisinin paketlenmesi.
 *
 * Eklenti kaynagi depoda (wp-plugin/dpdai-bridge) durur; panel bunu istek
 * uzerine zip'leyip sunar. Boylece tek kaynak vardir: kodu guncelleyip
 * surumu yukselttiginizde hem indirme butonu hem de sitelerin otomatik
 * guncellemesi ayni dosyayi alir.
 */

export const PLUGIN_SLUG = 'dpdai-bridge';

function pluginDir(): string {
  return path.join(process.cwd(), 'wp-plugin', PLUGIN_SLUG);
}

/** Ana dosyanin basligindaki "Version:" satirini okur. */
export async function getPluginVersion(): Promise<string> {
  try {
    const main = await readFile(path.join(pluginDir(), `${PLUGIN_SLUG}.php`), 'utf8');
    const m = main.match(/^\s*\*\s*Version:\s*(.+)$/m);
    return m ? m[1].trim() : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Eklenti kaynagi sunucuda var mi (Docker imajina kopyalanmis mi). */
export async function pluginAvailable(): Promise<boolean> {
  try {
    return (await stat(path.join(pluginDir(), `${PLUGIN_SLUG}.php`))).isFile();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------- zip */

type CacheEntry = { version: string; buffer: Buffer; builtAt: number };
let cache: CacheEntry | null = null;

async function collect(dir: string, base = ''): Promise<{ rel: string; abs: string }[]> {
  const out: { rel: string; abs: string }[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    // Gelistirme artiklarini pakete koyma
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const abs = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;

    if (entry.isDirectory()) out.push(...(await collect(abs, rel)));
    else out.push({ rel, abs });
  }
  return out;
}

/**
 * Eklentiyi zip'ler. Ayni surum icin sonuc onbelleklenir; her indirmede
 * yeniden paketlenmez.
 */
export async function buildPluginZip(): Promise<{ buffer: Buffer; version: string; filename: string }> {
  const version = await getPluginVersion();

  if (cache && cache.version === version) {
    return {
      buffer: cache.buffer,
      version,
      filename: `${PLUGIN_SLUG}-${version}.zip`,
    };
  }

  const dir = pluginDir();
  const files = await collect(dir);
  if (files.length === 0) throw new Error('Eklenti kaynağı bulunamadı.');

  const zip = new JSZip();
  // WordPress klasor adiyla acilmasini bekler
  const root = zip.folder(PLUGIN_SLUG);
  if (!root) throw new Error('Zip klasörü oluşturulamadı.');

  for (const f of files) {
    root.file(f.rel, await readFile(f.abs));
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  cache = { version, buffer, builtAt: Date.now() };

  return { buffer, version, filename: `${PLUGIN_SLUG}-${version}.zip` };
}

/* --------------------------------------------------------------- surumler */

/** "1.10.2" > "1.9.0" dogru karsilastirilsin diye parcali kiyaslama. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function isOutdated(installed: string | undefined | null, latest: string): boolean {
  if (!installed) return false;
  return compareVersions(installed, latest) < 0;
}

/** Panelin dis adresi - eklentinin guncelleme icin cagiracagi kok. */
export function panelUrl(): string {
  return (process.env.PANEL_URL ?? '').replace(/\/+$/, '');
}

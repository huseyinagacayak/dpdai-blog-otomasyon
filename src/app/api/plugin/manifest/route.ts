import { NextResponse } from 'next/server';
import { PLUGIN_SLUG, getPluginVersion, panelUrl } from '@/lib/plugin';

/**
 * Guncelleme bildirimi.
 *
 * Kurulu eklenti bu adresi periyodik olarak sorar; surum farkliysa WordPress
 * "guncelleme var" uyarisi gosterir ve paketi buradan ceker.
 */
export async function GET(req: Request) {
  const version = await getPluginVersion();

  // PANEL_URL tanimli degilse istegin geldigi adresi kullan
  const base = panelUrl() || new URL(req.url).origin;

  return NextResponse.json(
    {
      slug: PLUGIN_SLUG,
      name: 'DPDAI Bridge',
      version,
      download_url: `${base}/api/plugin/download`,
      requires: '6.0',
      tested: '6.8',
      requires_php: '7.4',
      author: 'DPDAI',
      homepage: base,
      last_updated: new Date().toISOString().slice(0, 10),
      sections: {
        description:
          'Blog otomasyon paneli ile WordPress arasında köprü. SEO metaları, ' +
          'Polylang/WPML dil bağlantısı, tekrarsız yazı yayını ve site geneli SEO taraması.',
      },
    },
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}

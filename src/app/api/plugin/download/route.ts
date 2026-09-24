import { NextResponse } from 'next/server';
import { buildPluginZip } from '@/lib/plugin';

/**
 * Kopru eklentisinin zip'i.
 *
 * Oturum aranmaz: hem panelden indirme butonu hem de WordPress'in kendi
 * guncelleme mekanizmasi (sunucudan sunucuya, cerezsiz) bu adresi kullanir.
 * Paket icinde gizli bilgi yoktur; her kurulum kendi token'ini uretir.
 */
export async function GET() {
  try {
    const { buffer, filename } = await buildPluginZip();

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Eklenti paketlenemedi: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { STORAGE_DIR } from '@/lib/pipeline/image';

const MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/** Panelde onizleme icin yerel depodaki gorselleri sunar (oturum gerekir). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (!(await getSession())) return new NextResponse('Yetkisiz', { status: 401 });

  const { path: segments } = await params;
  const rel = segments.join('/');

  // dizin disina cikma denemelerini engelle
  const abs = path.resolve(STORAGE_DIR, rel);
  if (!abs.startsWith(path.resolve(STORAGE_DIR) + path.sep)) {
    return new NextResponse('Gecersiz yol', { status: 400 });
  }

  try {
    const buf = await readFile(abs);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return new NextResponse('Bulunamadi', { status: 404 });
  }
}

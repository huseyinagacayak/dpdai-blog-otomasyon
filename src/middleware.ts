import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const COOKIE = 'dpdai_session';
const PUBLIC = [
  '/giris',
  '/api/auth/login',
  // Eklenti paketi ve surum bildirimi: WordPress sunucudan sunucuya cagirir,
  // cerez tasiyamaz. Pakette gizli bilgi yoktur.
  '/api/plugin',
  '/_next',
  '/favicon.ico',
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const token = req.cookies.get(COOKIE)?.value;
  if (token) {
    try {
      await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET ?? ''));
      return NextResponse.next();
    } catch {
      /* gecersiz token */
    }
  }

  const url = req.nextUrl.clone();
  url.pathname = '/giris';
  url.searchParams.set('devam', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

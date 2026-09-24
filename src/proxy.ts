import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

// Next 16: middleware.ts yerine proxy.ts (aynı davranış, yeni ad).

const COOKIE = 'dpdai_session';
const PUBLIC = [
  '/giris',
  '/api/auth/login',
  // Saglik kontrolu: uptime izleme / load balancer / Docker healthcheck (cerezsiz)
  '/api/health',
  // Eklenti paketi ve surum bildirimi: WordPress sunucudan sunucuya cagirir,
  // cerez tasiyamaz. Pakette gizli bilgi yoktur.
  '/api/plugin',
  '/_next',
  '/favicon.ico',
];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const token = req.cookies.get(COOKIE)?.value;
  if (token) {
    return jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET ?? ''))
      .then(() => NextResponse.next())
      .catch(() => redirectToLogin(req, pathname));
  }

  return redirectToLogin(req, pathname);
}

function redirectToLogin(req: NextRequest, pathname: string) {
  const url = req.nextUrl.clone();
  url.pathname = '/giris';
  url.searchParams.set('devam', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

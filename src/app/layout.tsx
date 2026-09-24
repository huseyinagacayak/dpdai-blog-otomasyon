import type { Metadata } from 'next';
import { MobileNav, Sidebar } from '@/components/Sidebar';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getTheme } from '@/lib/theme';
import { getLocale } from '@/lib/locale';
import './globals.css';

export const metadata: Metadata = {
  title: 'DPDAI Blog Otomasyon',
  description: 'Çok siteli, çok dilli SEO blog üretim ve yayın paneli',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [session, theme, locale] = await Promise.all([getSession(), getTheme(), getLocale()]);

  let pending = 0;
  if (session) {
    pending = await prisma.article
      .count({ where: { status: 'NEEDS_REVIEW' } })
      .catch(() => 0);
  }

  return (
    <html lang={locale} data-theme={theme}>
      <body>
        {session ? (
          <div className="flex min-h-screen">
            <Sidebar email={session.email} pending={pending} theme={theme} locale={locale} />
            <div className="flex min-w-0 flex-1 flex-col">
              <MobileNav pending={pending} locale={locale} />
              <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-7 lg:px-8">
                {children}
              </main>
            </div>
          </div>
        ) : (
          <main className="min-h-screen">{children}</main>
        )}
      </body>
    </html>
  );
}

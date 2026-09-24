'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';
import { LangToggle } from './LangToggle';
import type { Theme } from '@/lib/theme';
import { t, type Locale } from '@/lib/i18n';
import {
  IconActivity,
  IconArticle,
  IconCalendar,
  IconChart,
  IconDashboard,
  IconGlobe,
  IconSettings,
  IconTopics,
} from './icons';

const NAV = [
  { href: '/', label: 'Özet', Icon: IconDashboard, exact: true },
  { href: '/yazilar', label: 'Yazılar', Icon: IconArticle },
  { href: '/konular', label: 'Konu Havuzu', Icon: IconTopics },
  { href: '/takvim', label: 'Takvim', Icon: IconCalendar },
  { href: '/siteler', label: 'Siteler', Icon: IconGlobe },
  { href: '/istatistik', label: 'İstatistik', Icon: IconChart },
  { href: '/kayitlar', label: 'Kayıtlar', Icon: IconActivity },
  { href: '/ayarlar', label: 'Ayarlar', Icon: IconSettings },
];

export function Sidebar({
  email,
  pending,
  theme,
  locale,
}: {
  email: string;
  pending: number;
  theme: Theme;
  locale: Locale;
}) {
  const pathname = usePathname();

  return (
    <aside
      className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col self-start lg:flex"
      style={{ borderRight: '1px solid var(--line)', background: 'var(--surface)' }}
    >
      <div className="px-5 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            className="flex size-8 items-center justify-center rounded-lg text-sm font-bold"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            D
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold">DPDAI</span>
            <span className="block text-[11px]" style={{ color: 'var(--ink-3)' }}>
              {t(locale, 'Blog Otomasyon')}
            </span>
          </span>
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {NAV.map(({ href, label, Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link key={href} href={href} className="nav-item" data-active={active}>
              <Icon className="size-[18px]" />
              <span className="flex-1">{t(locale, label)}</span>
              {href === '/yazilar' && pending > 0 && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                  style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}
                >
                  {pending}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-4" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="flex gap-2 px-1 pt-4 pb-3">
          <div className="flex-1">
            <ThemeToggle current={theme} />
          </div>
          <LangToggle current={locale} />
        </div>
        <div className="px-3 pb-2">
          <div className="truncate text-xs font-medium">{email}</div>
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="nav-item w-full text-left">{t(locale, 'Çıkış yap')}</button>
        </form>
      </div>
    </aside>
  );
}

/** Dar ekranlarda ust menu */
export function MobileNav({ pending, locale }: { pending: number; locale: Locale }) {
  const pathname = usePathname();

  return (
    <div
      className="sticky top-0 z-20 flex gap-1 overflow-x-auto px-4 py-2 lg:hidden"
      style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}
    >
      {NAV.map(({ href, label, Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link key={href} href={href} className="nav-item shrink-0" data-active={active}>
            <Icon className="size-4" />
            <span className="text-xs">{t(locale, label)}</span>
            {href === '/yazilar' && pending > 0 && (
              <span
                className="rounded-full px-1.5 text-[10px] font-semibold tabular-nums"
                style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}
              >
                {pending}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

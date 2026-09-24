import { setTheme } from '@/lib/actions/theme';
import type { Theme } from '@/lib/theme';

const OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  {
    value: 'light',
    label: 'Açık',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="size-3.5">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Koyu',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="size-3.5">
        <path d="M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10Z" />
      </svg>
    ),
  },
  {
    value: 'system',
    label: 'Sistem',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="size-3.5">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    ),
  },
];

/** Kenar cubugundaki acik / koyu / sistem secici. */
export function ThemeToggle({ current }: { current: Theme }) {
  return (
    <div
      className="flex gap-0.5 rounded-lg p-0.5"
      style={{ background: 'var(--surface-3)', border: '1px solid var(--line)' }}
    >
      {OPTIONS.map((o) => {
        const active = current === o.value;
        const uygula = setTheme.bind(null, o.value);
        return (
          <form key={o.value} action={uygula} className="flex-1">
            <button
              type="submit"
              title={o.label}
              aria-pressed={active}
              className="flex w-full items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors"
              style={
                active
                  ? {
                      background: 'var(--surface)',
                      color: 'var(--ink)',
                      boxShadow: 'var(--shadow-sm)',
                    }
                  : { color: 'var(--ink-3)' }
              }
            >
              {o.icon}
              {o.label}
            </button>
          </form>
        );
      })}
    </div>
  );
}

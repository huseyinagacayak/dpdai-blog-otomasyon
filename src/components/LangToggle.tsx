import { setLocale } from '@/lib/actions/locale';
import type { Locale } from '@/lib/i18n';

const OPTIONS: { value: Locale; label: string }[] = [
  { value: 'tr', label: 'TR' },
  { value: 'en', label: 'EN' },
];

/** Kenar cubugundaki TR / EN dil secici (tema secici ile ayni stil). */
export function LangToggle({ current }: { current: Locale }) {
  return (
    <div
      className="flex gap-0.5 rounded-lg p-0.5"
      style={{ background: 'var(--surface-3)', border: '1px solid var(--line)' }}
    >
      {OPTIONS.map((o) => {
        const active = current === o.value;
        const uygula = setLocale.bind(null, o.value);
        return (
          <form key={o.value} action={uygula} className="flex-1">
            <button
              type="submit"
              className="w-full rounded-md py-1 text-xs font-semibold transition-colors"
              style={
                active
                  ? { background: 'var(--surface)', color: 'var(--ink)', boxShadow: '0 1px 2px rgba(0,0,0,.08)' }
                  : { color: 'var(--ink-3)' }
              }
            >
              {o.label}
            </button>
          </form>
        );
      })}
    </div>
  );
}

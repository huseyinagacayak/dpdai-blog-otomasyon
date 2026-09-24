import { cookies } from 'next/headers';
import { LOCALE_COOKIE, type Locale } from './i18n';

/** Panel dilini cerezden okur (varsayilan Turkce). Sunucu tarafi. */
export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  return v === 'en' ? 'en' : 'tr';
}

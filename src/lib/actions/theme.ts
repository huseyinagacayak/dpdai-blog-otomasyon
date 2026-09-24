'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { THEME_COOKIE, type Theme } from '@/lib/theme';

/** Tema tercihini cereze yazar (bir yil). */
export async function setTheme(theme: Theme) {
  const store = await cookies();
  store.set(THEME_COOKIE, theme, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  revalidatePath('/', 'layout');
}

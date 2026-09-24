import { cookies } from 'next/headers';

export type Theme = 'light' | 'dark' | 'system';

const COOKIE = 'dpdai_theme';

/**
 * Tema sunucuda cerezden okunur ve <html data-theme> olarak basilir.
 * Boylece sayfa ilk yuklenirken yanlis renkle cizilip sonra degismez.
 * Varsayilan: acik.
 */
export async function getTheme(): Promise<Theme> {
  const v = (await cookies()).get(COOKIE)?.value;
  return v === 'dark' || v === 'system' ? v : 'light';
}

export const THEME_COOKIE = COOKIE;

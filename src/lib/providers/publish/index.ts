import type { Site } from '@prisma/client';
import { decrypt } from '@/lib/crypto';
import { PhpEndpointAdapter } from './phpEndpoint';
import type { PublishAdapter } from './types';
import { WordPressAdapter } from './wordpress';

export * from './types';
export { WordPressAdapter } from './wordpress';
export { PhpEndpointAdapter } from './phpEndpoint';

/** Site kaydindan dogru yayin adaptorunu kurar (sifreler burada cozulur). */
export function getPublishAdapter(site: Site): PublishAdapter {
  if (site.platform === 'PHP_CUSTOM') {
    return new PhpEndpointAdapter(
      site.bridgeUrl ?? '',
      decrypt(site.bridgeToken) ?? '',
    );
  }

  const password = decrypt(site.wpAppPassword);
  if (!site.wpUsername || !password) {
    throw new Error(
      `${site.name}: WordPress kullanici adi veya uygulama sifresi eksik (Site ayarlari).`,
    );
  }

  return new WordPressAdapter({
    baseUrl: site.url,
    username: site.wpUsername,
    appPassword: password,
    preferBridge: site.hasBridge,
    bridgeToken: decrypt(site.bridgeToken),
  });
}

import type { ArticleStatus } from '@prisma/client';

/**
 * Uretim hatti aktif (isleniyor) durumlari. Hem sunucu (liste sayfasi) hem
 * istemci (PipelineProgress) tarafindan kullanildigi icin AYRI, client-olmayan
 * bir dosyada durur: 'use client' dosyasindan duz deger import etmek onu
 * client-referansina cevirir ve .includes gibi metotlar sunucuda calismaz.
 */
export const ACTIVE_STATUSES: ArticleStatus[] = [
  'QUEUED',
  'DRAFTING',
  'REVISING',
  'IMAGING',
  'TRANSLATING',
  'PUBLISHING',
];

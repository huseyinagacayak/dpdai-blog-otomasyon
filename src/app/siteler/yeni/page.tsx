import { PageHeader } from '@/components/ui';
import { SiteForm } from '@/components/SiteForm';
import { createSite } from '@/lib/actions/sites';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function YeniSitePage() {
  const credentials = await prisma.apiCredential.findMany({
    orderBy: [{ kind: 'asc' }, { priority: 'asc' }],
  });

  return (
    <>
      <PageHeader
        back={{ href: '/siteler', label: 'Siteler' }}
        title="Yeni site"
        subtitle="WordPress'te Kullanıcılar > Profil > Uygulama Şifreleri bölümünden bir şifre üretip buraya yapıştırın."
      />
      <SiteForm action={createSite} submitLabel="Siteyi kaydet" credentials={credentials} />
    </>
  );
}

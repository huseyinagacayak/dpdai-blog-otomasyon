import { redirect } from 'next/navigation';
import { createSession, getSession, verifyPassword } from '@/lib/auth';
import { prisma } from '@/lib/db';

export default async function GirisPage({
  searchParams,
}: {
  searchParams: Promise<{ devam?: string; hata?: string }>;
}) {
  const params = await searchParams;
  if (await getSession()) redirect(params.devam || '/');

  async function girisYap(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '')
      .trim()
      .toLowerCase();
    const password = String(formData.get('password') ?? '');
    const devam = String(formData.get('devam') ?? '/');

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      redirect(`/giris?hata=1${devam ? `&devam=${encodeURIComponent(devam)}` : ''}`);
    }
    await createSession(user.id, user.email);
    redirect(devam && devam !== '/giris' ? devam : '/');
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex items-center gap-3">
          <span
            className="flex size-10 items-center justify-center rounded-xl text-base font-bold"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            D
          </span>
          <div>
            <div className="text-base font-semibold">DPDAI</div>
            <div className="text-xs" style={{ color: 'var(--ink-3)' }}>
              Blog Otomasyon Paneli
            </div>
          </div>
        </div>

        <form action={girisYap} className="card-pad">
          {params.hata && (
            <div
              className="mb-4 rounded-lg px-3 py-2 text-sm"
              style={{
                background: 'var(--err-soft)',
                color: 'var(--err)',
                border: '1px solid var(--err-line)',
              }}
            >
              E-posta veya şifre hatalı.
            </div>
          )}

          <input type="hidden" name="devam" value={params.devam ?? '/'} />

          <label className="label">E-posta</label>
          <input name="email" type="email" required autoFocus className="input mb-4" />

          <label className="label">Şifre</label>
          <input name="password" type="password" required className="input mb-6" />

          <button type="submit" className="btn-primary w-full">
            Giriş yap
          </button>
        </form>
      </div>
    </div>
  );
}

import 'dotenv/config';
import { hashPassword } from '../src/lib/auth';
import { prisma } from '../src/lib/db';

async function main() {
  const email = (process.env.ADMIN_EMAIL || 'admin@local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';

  if ((await prisma.user.count()) > 0) {
    console.log('Kullanici zaten var, seed atlandi.');
    return;
  }
  if (!password) {
    console.log('ADMIN_PASSWORD bos, kullanici olusturulmadi.');
    return;
  }

  await prisma.user.create({
    data: { email, passwordHash: hashPassword(password), name: 'Yonetici' },
  });
  console.log(`Panel kullanicisi olusturuldu: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

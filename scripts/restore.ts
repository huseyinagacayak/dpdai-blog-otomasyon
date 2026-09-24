import 'dotenv/config';
import { restoreBackup } from '../src/lib/backup';

const file = process.argv[2];
if (!file) {
  console.error('Kullanım: npm run restore -- storage/backups/<dosya>.dump');
  process.exit(1);
}

console.log('⚠  Bu işlem mevcut veritabanının ÜZERİNE yazar:', file);
restoreBackup(file)
  .then(() => {
    console.log('✓ Geri yükleme tamamlandı.');
    process.exit(0);
  })
  .catch((e) => {
    console.error('✗ Geri yükleme başarısız:', (e as Error).message);
    process.exit(1);
  });

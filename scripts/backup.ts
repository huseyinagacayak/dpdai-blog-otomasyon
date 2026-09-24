import 'dotenv/config';
import { formatBytes, runBackup } from '../src/lib/backup';

runBackup({ trigger: 'manual' })
  .then((s) => {
    if (s.ok) {
      console.log(`✓ Yedek alındı: ${s.file} (${formatBytes(s.bytes ?? 0)})`);
      process.exit(0);
    }
    console.error('✗ Yedek alınamadı:', s.error);
    process.exit(1);
  })
  .catch((e) => {
    console.error('✗', (e as Error).message);
    process.exit(1);
  });

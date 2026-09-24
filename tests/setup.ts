// Testler saf mantık test eder ama bazı modüller import anında DATABASE_URL bekler
// (db.ts). Gerçek bağlantı kurulmaz; yalnızca import'un patlamaması için dummy verilir.
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test?schema=public';
process.env.ENCRYPTION_KEY ||= '0'.repeat(64);
process.env.AUTH_SECRET ||= 'test-secret-yeterince-uzun-bir-metin-olsun-32';

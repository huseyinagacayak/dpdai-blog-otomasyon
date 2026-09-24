import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getRedis } from '@/lib/queue';

/**
 * Saglik kontrolu. Oturum aramaz; uptime izleme / load balancer / Docker
 * healthcheck icin. DB ve Redis erisilebilir mi bakar.
 *   200 -> her sey iyi   ·   503 -> bir bagimlilik down
 */
export async function GET() {
  const out: { ok: boolean; db: boolean; redis: boolean; time: string } = {
    ok: false,
    db: false,
    redis: false,
    time: new Date().toISOString(),
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    out.db = true;
  } catch {
    out.db = false;
  }

  try {
    const pong = await getRedis().ping();
    out.redis = pong === 'PONG';
  } catch {
    out.redis = false;
  }

  out.ok = out.db && out.redis;
  return NextResponse.json(out, { status: out.ok ? 200 : 503 });
}

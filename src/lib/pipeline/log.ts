import { prisma } from '@/lib/db';

export type JobKind =
  | 'plan'
  | 'outline'
  | 'draft'
  | 'seo'
  | 'critique'
  | 'revise'
  | 'image'
  | 'imageCheck'
  | 'interlink'
  | 'translate'
  | 'publish'
  | 'discover'
  | 'audit';

/** Adim ilerlemesini konsola (worker.log) yazar: baslangic, bitis, sure. */
function stepLog(...args: unknown[]) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

/** Bir adimi calistirir, sure/token/maliyet ile birlikte JobRun'a yazar. */
export async function runStep<T>(
  ctx: { articleId?: string | null; siteId?: string | null; kind: JobKind; step?: string },
  fn: () => Promise<{ result: T; tokensIn?: number; tokensOut?: number; costUsd?: number; message?: string }>,
): Promise<T> {
  const started = Date.now();
  const label = `${ctx.kind}${ctx.step ? '/' + ctx.step : ''}`;
  stepLog('   ⏳', label, 'başladı', ctx.articleId ? `(${ctx.articleId})` : '');

  const job = await prisma.jobRun.create({
    data: {
      articleId: ctx.articleId ?? null,
      siteId: ctx.siteId ?? null,
      kind: ctx.kind,
      step: ctx.step ?? null,
      status: 'RUNNING',
    },
  });

  try {
    const out = await fn();
    const ms = Date.now() - started;
    await prisma.jobRun.update({
      where: { id: job.id },
      data: {
        status: 'SUCCESS',
        message: out.message ?? null,
        tokensIn: out.tokensIn ?? 0,
        tokensOut: out.tokensOut ?? 0,
        costUsd: out.costUsd ?? 0,
        durationMs: ms,
        finishedAt: new Date(),
      },
    });
    stepLog('   ✓', label, `${(ms / 1000).toFixed(1)}s`, out.message ? `· ${out.message}` : '');
    return out.result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const ms = Date.now() - started;
    await prisma.jobRun.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        message: message.slice(0, 2000),
        durationMs: ms,
        finishedAt: new Date(),
      },
    });
    stepLog('   ✗', label, `${(ms / 1000).toFixed(1)}s`, `· HATA: ${message.slice(0, 160)}`);
    throw e;
  }
}

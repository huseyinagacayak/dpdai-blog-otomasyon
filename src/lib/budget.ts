import { prisma } from './db';
import { notify } from './notify';

const KEY = 'budget';

export type BudgetSettings = {
  /** Aylik ust sinir (USD). 0 = sinirsiz */
  monthlyUsd: number;
  /** Sinir asilinca ne yapilsin */
  action: 'warn' | 'pause';
  /** Bu orana ulasinca uyari bildirimi gonder (0-1) */
  warnAt: number;
};

const DEFAULTS: BudgetSettings = { monthlyUsd: 0, action: 'pause', warnAt: 0.8 };

export async function getBudgetSettings(): Promise<BudgetSettings> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const v = (row?.value as Partial<BudgetSettings> | undefined) ?? {};
  return {
    monthlyUsd: Number(v.monthlyUsd ?? process.env.MONTHLY_BUDGET_USD ?? DEFAULTS.monthlyUsd),
    action: (v.action as BudgetSettings['action']) ?? DEFAULTS.action,
    warnAt: Number(v.warnAt ?? DEFAULTS.warnAt),
  };
}

export async function saveBudgetSettings(input: Partial<BudgetSettings>): Promise<void> {
  const current = await getBudgetSettings();
  const value: BudgetSettings = {
    monthlyUsd: input.monthlyUsd ?? current.monthlyUsd,
    action: input.action ?? current.action,
    warnAt: input.warnAt ?? current.warnAt,
  };
  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value },
    update: { value },
  });
}

/* ------------------------------------------------------------------ durum */

export function monthStart(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export type BudgetStatus = {
  limit: number;
  spent: number;
  remaining: number;
  ratio: number;
  /** Yeni ucretli is baslatilabilir mi */
  allowed: boolean;
  /** Uyari esigi asildi mi */
  warning: boolean;
  action: BudgetSettings['action'];
};

/**
 * Bu ayki toplam harcamayi hesaplar.
 * JobRun.costUsd tum adimlarda (metin, gorsel, ceviri, denetim) yazildigi icin
 * tek kaynak olarak burasi kullanilir.
 */
export async function getBudgetStatus(): Promise<BudgetStatus> {
  const s = await getBudgetSettings();
  const agg = await prisma.jobRun.aggregate({
    _sum: { costUsd: true },
    where: { startedAt: { gte: monthStart() } },
  });
  const spent = agg._sum.costUsd ?? 0;

  if (s.monthlyUsd <= 0) {
    return {
      limit: 0,
      spent,
      remaining: Infinity,
      ratio: 0,
      allowed: true,
      warning: false,
      action: s.action,
    };
  }

  const ratio = spent / s.monthlyUsd;
  return {
    limit: s.monthlyUsd,
    spent,
    remaining: Math.max(0, s.monthlyUsd - spent),
    ratio,
    allowed: s.action === 'warn' || ratio < 1,
    warning: ratio >= s.warnAt,
    action: s.action,
  };
}

/**
 * Ucretli bir is baslamadan once cagrilir.
 * Sinir asildiysa ve mod "pause" ise false doner; cagiran is atlanir.
 * Esik/asim bildirimleri burada tetiklenir (ayda bir kez, notify kisitlamasiyla).
 */
export async function checkBudget(context: string): Promise<BudgetStatus> {
  const status = await getBudgetStatus();
  if (status.limit <= 0) return status;

  const ay = `${new Date().getFullYear()}-${new Date().getMonth() + 1}`;

  if (!status.allowed) {
    await notify({
      level: 'error',
      title: 'Aylık bütçe doldu',
      message:
        `Bu ay ${status.spent.toFixed(2)} USD harcandı (sınır ${status.limit} USD). ` +
        `Yeni üretim durduruldu. Son atlanan iş: ${context}.`,
      path: '/kayitlar',
      dedupeKey: `budget-exceeded-${ay}`,
    });
  } else if (status.warning) {
    await notify({
      level: 'warn',
      title: 'Bütçenin sonuna yaklaşıldı',
      message:
        `Bu ay ${status.spent.toFixed(2)} / ${status.limit} USD harcandı ` +
        `(%${Math.round(status.ratio * 100)}).`,
      path: '/kayitlar',
      dedupeKey: `budget-warn-${ay}`,
    });
  }

  return status;
}

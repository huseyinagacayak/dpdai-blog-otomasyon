/**
 * Saf SVG grafikler.
 *
 * Harici kutuphane yok: renkler tema degiskenlerinden (var(--...)) geldigi
 * icin acik/koyu temada kendiliginden dogru cizilir ve paket boyutu artmaz.
 */

export type Point = { label: string; value: number; value2?: number };

const PALETTE = [
  'var(--accent)',
  'var(--ok)',
  'var(--warn)',
  'var(--info)',
  'var(--err)',
  'var(--ink-3)',
];

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / mag) * mag;
}

/* ------------------------------------------------------------------ alan */

/**
 * Zaman serisi alan grafigi. Iki seri destekler (ornek: uretilen / yayinlanan).
 */
export function AreaChart({
  data,
  height = 180,
  labels,
  format = (v) => String(v),
}: {
  data: Point[];
  height?: number;
  /** Seri adlari - gosterge icin */
  labels?: [string, string?];
  format?: (v: number) => string;
}) {
  if (data.length === 0) return <Empty />;

  const W = 100; // yuzde tabanli viewBox: kapsayiciya uyar
  const H = height;
  const padTop = 8;
  const padBottom = 20;
  const plotH = H - padTop - padBottom;

  const max = niceMax(Math.max(1, ...data.flatMap((d) => [d.value, d.value2 ?? 0])));
  const step = data.length > 1 ? W / (data.length - 1) : 0;

  const toPath = (key: 'value' | 'value2') => {
    const pts = data.map((d, i) => {
      const v = (key === 'value' ? d.value : (d.value2 ?? 0)) / max;
      return [i * step, padTop + plotH - v * plotH] as const;
    });
    const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    const area = `${line} L${W},${padTop + plotH} L0,${padTop + plotH} Z`;
    return { line, area };
  };

  const s1 = toPath('value');
  const s2 = data.some((d) => d.value2 !== undefined) ? toPath('value2') : null;

  // Eksen etiketleri: bas, orta, son
  const ticks = [0, Math.floor(data.length / 2), data.length - 1].filter(
    (v, i, a) => a.indexOf(v) === i,
  );

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {/* yatay kilavuzlar */}
        {[0, 0.5, 1].map((r) => (
          <line
            key={r}
            x1="0"
            x2={W}
            y1={padTop + plotH - r * plotH}
            y2={padTop + plotH - r * plotH}
            stroke="var(--line)"
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <path d={s1.area} fill="url(#areaFill)" />
        <path
          d={s1.line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />

        {s2 && (
          <path
            d={s2.line}
            fill="none"
            stroke="var(--ok)"
            strokeWidth="2"
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        )}
      </svg>

      <div className="mt-1 flex justify-between text-[10px]" style={{ color: 'var(--ink-3)' }}>
        {ticks.map((i) => (
          <span key={i}>{data[i]?.label}</span>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--ink-2)' }}>
        <Legend color="var(--accent)" label={labels?.[0] ?? 'seri 1'} />
        {s2 && <Legend color="var(--ok)" label={labels?.[1] ?? 'seri 2'} dashed />}
        <span className="ml-auto tabular-nums" style={{ color: 'var(--ink-3)' }}>
          en yüksek {format(max)}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ bar */

/** Yatay cubuk grafik - site basina uretim gibi kategorik veriler icin. */
export function BarList({
  data,
  format = (v) => String(v),
  colorBy,
  max: maxOverride,
}: {
  data: Point[];
  format?: (v: number) => string;
  /** Deger bazli renk (ornek: kalite puani) */
  colorBy?: (p: Point) => string;
  max?: number;
}) {
  if (data.length === 0) return <Empty />;
  const max = maxOverride ?? Math.max(1, ...data.map((d) => d.value));

  return (
    <ul className="space-y-2.5">
      {data.map((d, i) => (
        <li key={`${d.label}-${i}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate" style={{ color: 'var(--ink-2)' }}>
              {d.label}
            </span>
            <span className="shrink-0 tabular-nums font-medium">{format(d.value)}</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full"
            style={{ background: 'var(--surface-3)' }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(2, (d.value / max) * 100)}%`,
                background: colorBy ? colorBy(d) : PALETTE[i % PALETTE.length],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- sutun */

/** Dikey sutun grafik - dagilim (ornek: kalite puani histogrami) icin. */
export function ColumnChart({
  data,
  height = 140,
  colorBy,
  format = (v) => String(v),
}: {
  data: Point[];
  height?: number;
  colorBy?: (p: Point, i: number) => string;
  format?: (v: number) => string;
}) {
  if (data.length === 0) return <Empty />;
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((d, i) => (
          <div key={`${d.label}-${i}`} className="group flex flex-1 flex-col items-center gap-1">
            <span
              className="text-[10px] tabular-nums opacity-0 transition-opacity group-hover:opacity-100"
              style={{ color: 'var(--ink-2)' }}
            >
              {format(d.value)}
            </span>
            <div
              className="w-full rounded-t transition-all"
              style={{
                height: `${Math.max(2, (d.value / max) * (height - 20))}px`,
                background: colorBy ? colorBy(d, i) : 'var(--accent)',
              }}
              title={`${d.label}: ${format(d.value)}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {data.map((d, i) => (
          <span
            key={`${d.label}-${i}`}
            className="flex-1 truncate text-center text-[10px]"
            style={{ color: 'var(--ink-3)' }}
          >
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- halka */

/** Halka grafik - durum dagilimi gibi parca-butun iliskileri icin. */
export function Donut({
  data,
  size = 150,
  thickness = 18,
  centerLabel,
  centerValue,
}: {
  data: { label: string; value: number; color?: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string | number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <Empty />;

  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={thickness}
            stroke="var(--surface-3)"
          />
          {data.map((d, i) => {
            const len = (d.value / total) * circumference;
            const el = (
              <circle
                key={d.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                strokeWidth={thickness}
                stroke={d.color ?? PALETTE[i % PALETTE.length]}
                strokeDasharray={`${len} ${circumference - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold tabular-nums">{centerValue ?? total}</span>
          {centerLabel && (
            <span className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
              {centerLabel}
            </span>
          )}
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2 text-xs">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: d.color ?? PALETTE[i % PALETTE.length] }}
            />
            <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--ink-2)' }}>
              {d.label}
            </span>
            <span className="tabular-nums font-medium">{d.value}</span>
            <span className="w-9 text-right tabular-nums" style={{ color: 'var(--ink-3)' }}>
              %{Math.round((d.value / total) * 100)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- takvim */

/**
 * Yayin yogunlugu isi haritasi (son ~12 hafta).
 * data: { 'YYYY-MM-DD': adet }
 */
export function CalendarHeatmap({
  data,
  weeks = 13,
  end = new Date(),
}: {
  data: Record<string, number>;
  weeks?: number;
  end?: Date;
}) {
  const max = Math.max(1, ...Object.values(data));

  // Haftanin pazartesi ile baslamasi icin geriye dogru hizala
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);
  const dow = (last.getDay() + 6) % 7; // 0 = Pazartesi
  const gridEnd = new Date(last);
  gridEnd.setDate(gridEnd.getDate() + (6 - dow));

  const days: { key: string; date: Date; count: number }[] = [];
  for (let i = weeks * 7 - 1; i >= 0; i--) {
    const d = new Date(gridEnd);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days.push({ key, date: d, count: data[key] ?? 0 });
  }

  const columns: (typeof days)[] = [];
  for (let i = 0; i < days.length; i += 7) columns.push(days.slice(i, i + 7));

  const shade = (n: number) => {
    if (n === 0) return 'var(--surface-3)';
    const t = n / max;
    const opacity = 0.25 + t * 0.75;
    return `color-mix(in srgb, var(--accent) ${Math.round(opacity * 100)}%, transparent)`;
  };

  const GUNLER = ['Pzt', '', 'Çar', '', 'Cum', '', 'Paz'];

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1">
        <div className="flex shrink-0 flex-col gap-1 pr-1">
          {GUNLER.map((g, i) => (
            <span
              key={i}
              className="flex h-3 items-center text-[9px] leading-none"
              style={{ color: 'var(--ink-3)' }}
            >
              {g}
            </span>
          ))}
        </div>

        {columns.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-1">
            {col.map((d) => (
              <span
                key={d.key}
                className="size-3 rounded-[3px]"
                style={{ background: shade(d.count) }}
                title={`${d.date.toLocaleDateString('tr-TR')}: ${d.count} yazı`}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--ink-3)' }}>
        <span>az</span>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <span
            key={t}
            className="size-3 rounded-[3px]"
            style={{ background: shade(t * max) }}
          />
        ))}
        <span>çok</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- yardim */

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-0.5 w-4 rounded-full"
        style={{
          background: dashed
            ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)`
            : color,
        }}
      />
      {label}
    </span>
  );
}

function Empty() {
  return (
    <div
      className="flex items-center justify-center rounded-lg py-10 text-xs"
      style={{ background: 'var(--surface-2)', color: 'var(--ink-3)' }}
    >
      Gösterilecek veri yok
    </div>
  );
}
